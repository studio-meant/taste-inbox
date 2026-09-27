"""Reading a cover, and refusing to over-claim what was read.

Every case here comes from the forty-one real saved Reels. The recogniser's own output was
captured first and the rules were written against it — including the two ways it fails,
which are what most of these assertions are about.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.cards import _caption_tracks, to_music_card
from taste_inbox.db.models import Base, Evidence, Item, MediaAsset
from taste_inbox.enrich.ocr import OcrLine, OcrRead, parse
from taste_inbox.enrich.providers import Unavailable
from taste_inbox.enrich.thumbnails import read_thumbnails, thumbnail_targets, track_split
from taste_inbox.ingest import ingest_all


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def seed(session: Session, tmp_path: Path, *, collection: str = "music") -> None:
    """One saved Reel with its cover already on disk.

    `local_path` is set by hand because the caching job is a separate step and this suite
    is about what happens *after* a cover is cached — reading a cover means reading a file,
    never fetching one.
    """
    item = {
        "code": "ABC",
        "media_type": "video",
        "product_type": "clips",
        "taken_at": 1757736341,
        "owner": "somebody",
        "caption": "여름밤 플리",
        "accessibility_caption": None,
        "audio_title": None,
        "audio_artist": None,
        "is_original_audio": True,
        "product_tag_count": 0,
        "user_tag_count": 0,
        "source_endpoint": "/api/v1/feed/",
        "thumbnail_url": "https://scontent.cdninstagram.com/v/t51/x.jpg?oe=68AB1234",
        "thumbnail_width": 640,
        "thumbnail_height": 1136,
    }
    (tmp_path / f"saved-{collection}.json").write_text(
        json.dumps([item], ensure_ascii=False), "utf-8"
    )
    ingest_all(session, tmp_path)

    asset = session.scalar(select(MediaAsset))
    assert asset is not None
    asset.local_path = "var/media/ab/cover.jpg"
    session.commit()


class FakeOcr:
    """Returns a fixed read, and counts how often it was asked."""

    def __init__(self, result: OcrRead | Unavailable) -> None:
        self._result = result
        self.calls: list[str] = []

    def read(self, image_path: str) -> OcrRead | Unavailable:
        self.calls.append(image_path)
        return self._result


class ExplodingOcr:
    def read(self, image_path: str) -> OcrRead | Unavailable:
        del image_path
        raise RuntimeError("the recogniser crashed")


class TestTrackSplit:
    """The one rule that decides whether a line becomes a clickable candidate.

    Measured over the twenty covers with no audio attribution: every line containing a
    spaced dash was a real track reference and every line without one was not — nine for
    nine once the full forty-one were run, with no false positives.
    """

    @pytest.mark.parametrize(
        "line",
        [
            "Myles Lloyd - Drive Me Crazy",
            "phone numbers - Dominic fike",
            # Numbers count as a word. This is a real artist, and dropping it because the
            # right half is two digits would lose a track for a tidier rule.
            "chanel - 40",
            "say so - byjaye",
            # No space before the dash. Real, and the reason only one side is required.
            "i kept the light on- Don kai",
            "Different Speed - afterandafter",
            "2BYG - Karma",
        ],
    )
    def test_recognises_the_lines_that_really_were_tracks(self, line: str) -> None:
        assert track_split(line) is not None

    @pytest.mark.parametrize(
        "line",
        [
            # Playlist chrome, all from real covers.
            "오늘의 추천곡",
            "ORDINARY DIGGING SESSION #3",
            "국내 R&B / Soul / 인디",
            "3곡 가져왔습니다",
            "1:25",
            # Recogniser noise.
            "DO",
            "~",
            "aaat",
            # A hyphenated word is not a separator; without the space rule this passes.
            "well-known playlist",
        ],
    )
    def test_leaves_everything_that_was_not(self, line: str) -> None:
        assert track_split(line) is None

    def test_does_not_decide_which_half_is_the_artist(self) -> None:
        # `Myles Lloyd - Drive Me Crazy` is artist first; `i kept the light on- Don kai` is
        # title first. Both are real, from the same collection, so any assignment is wrong
        # half the time — the halves exist only to validate the shape.
        assert track_split("Myles Lloyd - Drive Me Crazy") == ("Myles Lloyd", "Drive Me Crazy")
        assert track_split("i kept the light on- Don kai") == ("i kept the light on", "Don kai")


class TestCaptionTracks:
    """Measured caption forms that the old audio-and-cover-only path left empty."""

    @pytest.mark.parametrize(
        ("caption", "artist", "title"),
        [
            ("Marldn의 \u2018Muse\u2019. 새벽에 듣기 좋은 곡", "Marldn", "Muse"),
            ("잠들지 못하는 밤 · Arin Ray · ZZZ · 몽환적인 비트", "Arin Ray", "ZZZ"),
            (
                "싱어송라이터 스텔라 레프티 \u2018Boston\u2019은 2026년 공개된 곡",
                "스텔라 레프티",
                "Boston",
            ),
            ("[1m 직캠📸] 민지운 - Myspace", "민지운", "Myspace"),
            ("Lullaby - @jaydon", "jaydon", "Lullaby"),
            ("JM Less Than a Lover", "JM", "Less Than a Lover"),
        ],
    )
    def test_reads_explicit_artist_and_title_forms(
        self, caption: str, artist: str, title: str
    ) -> None:
        track = _caption_tracks(caption)[0]
        assert track.artist == artist
        assert track.title == title
        assert track.match_grade == "likely"

    def test_reads_every_line_in_an_explicit_song_list(self) -> None:
        tracks = _caption_tracks(
            "<노래 목록>\n🎶Nali - <Hold Me Close>\n🎶Sammy Atlas - <Freud>\n"
            "🎶이강승 - <Your love is mine>"
        )
        assert [(track.artist, track.title) for track in tracks] == [
            ("Nali", "Hold Me Close"),
            ("Sammy Atlas", "Freud"),
            ("이강승", "Your love is mine"),
        ]

    def test_album_context_does_not_become_extra_candidates(self) -> None:
        tracks = _caption_tracks(
            "Marldn의 \u2018Muse\u2019. 같은 EP에는 \u2018Poor Skater\u2019와 다른 곡도 있습니다."
        )
        assert [(track.artist, track.title) for track in tracks] == [("Marldn", "Muse")]

    def test_a_title_only_release_is_searchable_without_inventing_an_artist(self) -> None:
        track = _caption_tracks("'North' is out now! Listen everywhere")[0]
        assert track.artist is None
        assert track.title == "North"
        assert track.match_grade == "unknown"

    @pytest.mark.parametrize(
        "caption",
        [
            "친구들 앞에서 꼭 틀어보세요 #노래추천",
            "act like a boy 이 부분 너무 좋다",
            "예린이가 라이브 방송으로 불러줬던 커버 🥹",
            "여름 밤공기 냄새나는 밤산책 감성 팝송 추천해주세요",
        ],
    )
    def test_does_not_turn_generic_praise_or_lyrics_into_tracks(self, caption: str) -> None:
        assert _caption_tracks(caption) == []


class TestParse:
    def test_reads_the_real_output_shape(self) -> None:
        result = parse(
            json.dumps(
                {
                    "line_count": 2,
                    "text": "a\nb",
                    "lines": [
                        {"text": "Myles Lloyd - Drive Me Crazy", "confidence": 1},
                        {"text": "  ", "confidence": 0.5},
                    ],
                }
            )
        )
        assert isinstance(result, OcrRead)
        # The blank line is dropped; a line of spaces is not something read.
        assert [line.text for line in result.lines] == ["Myles Lloyd - Drive Me Crazy"]

    def test_a_cover_with_no_text_is_a_read_not_a_failure(self) -> None:
        result = parse(json.dumps({"line_count": 0, "text": "", "lines": []}))
        assert isinstance(result, OcrRead)
        assert result.lines == ()
        assert result.mean_confidence is None

    def test_unreadable_output_is_reported_rather_than_raised(self) -> None:
        # A version bump that changes the format must degrade to "nothing read", not to a
        # traceback in the middle of a nightly run.
        assert isinstance(parse("not json"), Unavailable)
        assert isinstance(parse("[]"), Unavailable)

    def test_a_renamed_field_yields_an_empty_read(self) -> None:
        assert parse(json.dumps({"results": []})) == OcrRead()


class TestReadThumbnails:
    def test_stores_the_reading_and_the_tracks_separately(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        provider = FakeOcr(
            OcrRead(
                (
                    OcrLine("오늘의 추천곡", 1.0),
                    OcrLine("Myles Lloyd - Drive Me Crazy", 1.0),
                )
            )
        )

        report = read_thumbnails(session, provider=provider)

        assert report.read == 1
        assert report.tracks == 1
        rows = {row.type: row for row in session.scalars(select(Evidence))}
        assert rows["thumbnail_text"].value == "오늘의 추천곡\nMyles Lloyd - Drive Me Crazy"
        assert rows["thumbnail_track"].value == "Myles Lloyd - Drive Me Crazy"

    def test_a_reading_is_never_recorded_as_a_fact(self, session: Session, tmp_path: Path) -> None:
        # The text on the image is a fact; what the recogniser returned is a reading of it.
        # Measured: `Lullaby / JayDon, Paradise` came back as `ullaby / Jay pon, Paraoise`.
        seed(session, tmp_path)
        read_thumbnails(session, provider=FakeOcr(OcrRead((OcrLine("2BYG - Karma", 1.0),))))

        assert {row.provenance for row in session.scalars(select(Evidence))} == {"inference"}

    def test_an_empty_cover_is_recorded_so_it_is_not_read_again(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Eight of the twenty unattributed covers are pure photograph. Without a stored row
        # there is no way to tell those from "never looked", and every run redoes them.
        seed(session, tmp_path)
        provider = FakeOcr(OcrRead())

        first = read_thumbnails(session, provider=provider)
        second = read_thumbnails(session, provider=provider)

        assert first.empty == 1
        assert second.skipped == 1
        assert len(provider.calls) == 1

    def test_force_reads_again_and_replaces_only_its_own_rows(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None
        session.add(
            Evidence(
                item_id=item.id,
                type="audio_attribution",
                label="릴스 오디오 표기",
                value="Nujabes - Feather",
                provenance="fact",
            )
        )
        session.commit()

        read_thumbnails(
            session, provider=FakeOcr(OcrRead((OcrLine("Topaz Jones - Black Tame", 1.0),)))
        )
        read_thumbnails(
            session, provider=FakeOcr(OcrRead((OcrLine("2BYG - Karma", 1.0),))), force=True
        )

        tracks = [
            row.value
            for row in session.scalars(select(Evidence).where(Evidence.type == "thumbnail_track"))
        ]
        assert tracks == ["2BYG - Karma"]
        # The collector's own observation is untouched.
        assert (
            session.scalar(select(Evidence).where(Evidence.type == "audio_attribution")) is not None
        )

    def test_a_provider_that_throws_leaves_the_item_alone(
        self, session: Session, tmp_path: Path
    ) -> None:
        # CLAUDE.md §7: a failed enricher must not invalidate successful collection.
        seed(session, tmp_path)
        report = read_thumbnails(session, provider=ExplodingOcr())

        assert report.unavailable == 1
        assert session.scalar(select(Evidence)) is None

    def test_a_missing_binary_is_reported_with_its_reason(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        report = read_thumbnails(session, provider=FakeOcr(Unavailable("macvis가 없어요")))

        assert report.unavailable == 1
        assert any("macvis" in reason for reason in report.reasons)
        assert session.scalar(select(Evidence)) is None

    def test_only_covers_the_user_filed_under_music(self, session: Session, tmp_path: Path) -> None:
        # A fashion save has no printed song list, and reading every cached image would be
        # forty-one calls turning into a hundred and twenty-six.
        seed(session, tmp_path, collection="fashion")
        assert thumbnail_targets(session) == []


class TestCardOutput:
    def test_a_cover_track_becomes_a_similar_candidate_with_a_search(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        read_thumbnails(
            session, provider=FakeOcr(OcrRead((OcrLine("Myles Lloyd - Drive Me Crazy", 1.0),)))
        )
        item = session.scalar(select(Item))
        assert item is not None

        card = to_music_card(session, item)
        candidate = card["candidates"][0]

        assert candidate["origin"] == "on_screen_text"
        # Never higher. The recogniser misreads, and a wrong track handed over as `exact`
        # is worse than no track at all.
        assert candidate["matchGrade"] == "similar"
        # Never split: the halves have no fixed order across the real collection.
        assert candidate["artist"] is None
        assert candidate["title"] is None
        assert candidate["rawText"] == "Myles Lloyd - Drive Me Crazy"
        assert candidate["searchUrl"].startswith("https://music.youtube.com/search?q=")

    def test_the_platform_attribution_still_comes_first(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None
        session.add(
            Evidence(
                item_id=item.id,
                type="audio_attribution",
                label="릴스 오디오 표기",
                value="Nujabes - Feather",
                provenance="fact",
            )
        )
        session.commit()
        read_thumbnails(
            session, provider=FakeOcr(OcrRead((OcrLine("Topaz Jones - Black Tame", 1.0),)))
        )

        grades = [c["matchGrade"] for c in to_music_card(session, item)["candidates"]]
        # A string the platform published outranks a machine's reading of a picture.
        assert grades == ["likely", "similar"]

    def test_read_and_blank_is_a_different_state_from_never_read(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed(session, tmp_path)
        item = session.scalar(select(Item))
        assert item is not None

        before = to_music_card(session, item)
        assert before["coverText"] is None
        assert before["coverCheckedAt"] is None

        read_thumbnails(session, provider=FakeOcr(OcrRead()))

        after = to_music_card(session, item)
        assert after["coverText"] is None
        # The timestamp is what makes "looked, nothing there" sayable.
        assert after["coverCheckedAt"] is not None
