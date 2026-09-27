"""Giving a liked post a board, and what is allowed to leave this machine to do it.

Two subjects, and the second one is the reason this file is longer than the feature.

`enrich/classify.py` is the first thing in Taste Inbox that sends collected personal content
to a service off this Mac. `docs/SECURITY_BOUNDARIES.md` states what may go — the caption
and Instagram's alt text, nothing else — and a sentence in a document is not an enforcement.
`TestNothingElseLeavesTheMachine` is: it builds an item carrying every identifier the schema
has (a permalink, a shortcode, an author, a uuid, links and `@handles` inside the caption
itself) and asserts none of them appears in the argv the subprocess would receive.

**No test here runs `claude`.** Every classifier is a fake that records what it was asked
and answers from a script, which is also the only way the batching and resumability
assertions can be deterministic.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.cards import BOARD_COLLECTIONS, DECLINED_COLLECTION, board_query
from taste_inbox.db.models import Base, Item, ItemSource
from taste_inbox.enrich.classify import (
    DECLINED,
    LABEL_COLLECTIONS,
    LABELS,
    PROMPT,
    BoardInput,
    ClassifyReport,
    ClaudeCliClassifier,
    NoBoardClassifier,
    build_prompt,
    classification_targets,
    classify_boards,
    parse_answer,
    redact,
    sendable_alt,
    strip_alt_attribution,
)
from taste_inbox.enrich.providers import Unavailable
from taste_inbox.ingest import ingest_all
from taste_inbox.paths import REPO_ROOT


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def write(directory: Path, name: str, payload: object) -> None:
    (directory / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False), "utf-8")


#: The collector's own permalink template, interpolated rather than spelled out per fixture.
#:
#: `.github/workflows` greps `apps/` and `packages/` for a real social URL and clears the
#: template form from `.github/allowed-fixture-urls.txt`. Writing the host once, here, is what
#: keeps a synthetic fixture from reading like a collected permalink to that check.
PERMALINK = "https://www.instagram.com/{kind}/{code}/"


def liked(code: str, **overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "code": code,
        "permalink": PERMALINK.format(kind="p", code=code),
        "first_seen_at": "2026-08-08T09:46:31.481907+00:00",
        "media_type": "unknown",
        "product_type": None,
        "taken_at": 1757736341,
        "caption": "가을 코디 추천",
        "accessibility_caption": None,
        "audio_title": None,
        "audio_artist": None,
    }
    item.update(overrides)
    return item


def seed_likes(session: Session, tmp_path: Path, *items: dict[str, Any]) -> None:
    write(tmp_path, "instagram-collect-20260808T094631Z", list(items))
    ingest_all(session, tmp_path)


class Recorder:
    """A classifier that answers from a script and keeps every prompt it was handed."""

    def __init__(self, *answers: dict[str, str] | Unavailable) -> None:
        self.answers = list(answers)
        self.prompts: list[str] = []

    def classify(self, prompt: str) -> dict[str, str] | Unavailable:
        self.prompts.append(prompt)
        if not self.answers:
            return Unavailable("스크립트에 답이 남아 있지 않아요.")
        return self.answers.pop(0)

    @property
    def sent(self) -> str:
        return "\n".join(self.prompts)


class TestTheTwoVocabularies:
    """The model's label and the column's value are not the same word, and must not become
    the same word by accident."""

    def test_every_board_the_product_has_can_be_answered(self) -> None:
        # A label the classifier can produce but the column cannot express would file
        # nothing; a board with no label would stay permanently empty.
        assert set(LABEL_COLLECTIONS.values()) == set(BOARD_COLLECTIONS.values())
        assert set(LABELS) == set(LABEL_COLLECTIONS) | {DECLINED}

    def test_the_declined_value_is_the_one_the_api_layer_looks_for(self) -> None:
        """Two constants, one string, and nothing importing the other.

        `enrich/classify.py` writes `none` and `api/cards.py::declined_filter` selects on it,
        and neither imports the other — an enricher reading the presentation layer is the
        wrong direction of dependency, so the agreement is stated and pinned here instead.
        A drift between them is not a type error anywhere: it is a shelf that silently stops
        finding the items the classifier has been putting on it.
        """
        assert DECLINED == DECLINED_COLLECTION
        # And it must remain a value no board matches, or a declined item would appear on
        # one — which is the opposite of what it records.
        assert DECLINED not in set(BOARD_COLLECTIONS.values())

    def test_trends_is_stored_under_the_name_the_user_typed_on_instagram(self) -> None:
        # `api/cards.py` maps the board `trends` onto the collection the user called `ai`.
        # Writing the board name into the column would put the item on no board at all.
        assert LABEL_COLLECTIONS["trends"] == "ai"
        assert BOARD_COLLECTIONS["trends"] == "ai"

    def test_the_prompt_still_names_the_five_it_was_measured_with(self) -> None:
        # 123/126 was measured against this exact prompt. A label quietly renamed here is a
        # number that no longer describes anything.
        for label in LABELS:
            assert label in PROMPT


class TestRedaction:
    @pytest.mark.parametrize(
        ("text", "gone"),
        [
            ("사러 가기 https://cwithc.co.kr/product/1", "https"),
            ("www.instagram.com 에서", "www."),
            ("shop at cwithc.co.kr now", "cwithc"),
            ("문트(@moont_official)가 공개했습니다", "@moont_official"),
        ],
    )
    def test_a_link_or_a_handle_never_survives(self, text: str, gone: str) -> None:
        assert gone not in redact(text)

    def test_the_korean_around_them_does_survive(self) -> None:
        # Redaction is deletion, not summarising. What decides the board is the prose, and
        # dropping it to be safe would trade the whole feature for the boundary.
        assert redact("문트(@moont_official)의 가을 코디 https://x.kr 추천") == (
            "문트( )의 가을 코디 추천"
        )

    def test_a_bare_at_sign_in_prose_is_punctuation_and_stays(self) -> None:
        # Run over all 972 captions and alt texts in `var/captures/`, the redactor leaves no
        # URL and no handle — but it does leave a handful of lone `@`s, from captions like
        # `4Batz - act ii: date @ 8`. An `@` with no name after it identifies nobody, and
        # deleting punctuation out of a caption would be editing the text rather than
        # redacting it.
        assert redact("date @ 8 아시나요") == "date @ 8 아시나요"

    def test_a_caption_becomes_one_line(self) -> None:
        # The prompt is `번호 <TAB> 캡션`, one item per line. A newline inside a caption
        # would split it into two entries and shift every answer after it by one.
        flattened = redact("첫 줄\n두 번째\t줄")
        assert "\n" not in flattened
        assert "\t" not in flattened

    def test_instagrams_attribution_sentence_is_dropped_and_the_description_kept(self) -> None:
        # The opening names the account. What follows it is the half that rescued four of
        # seven misclassifications in the measurement.
        alt = "Photo shared by eyesmag 아이즈매거진 on September 3, 2025. May be an image of text."
        stripped = strip_alt_attribution(alt)
        assert "eyesmag" not in stripped
        assert stripped == "May be an image of text."

    def test_an_alt_text_with_no_attribution_is_left_alone(self) -> None:
        assert strip_alt_attribution("May be an image of 1 person.") == (
            "May be an image of 1 person."
        )

    def test_a_handle_with_a_dot_in_it_does_not_survive_the_attribution_strip(self) -> None:
        # Verbatim from this user's own collected data, and the reason `sendable_alt`
        # redacts before it strips. `_ALT_ATTRIBUTION` ends at the first `.`, and here that
        # period sits *inside* the handle — stripping first ate `…tagging @moodybaddie.`
        # and left `zip.` at the front, a fragment of the very handle being removed.
        raw = (
            "Photo shared by 무디배디 | 윤달 on August 04, 2026 tagging @moodybaddie.zip. "
            "May be an image of text that says '지금이 기회야'."
        )
        sent = sendable_alt(raw)
        assert "moodybaddie" not in sent
        assert "zip" not in sent
        assert "무디배디" not in sent
        assert sent == "May be an image of text that says '지금이 기회야'."


class TestNothingElseLeavesTheMachine:
    """The boundary, asserted against the argv the subprocess would actually receive.

    `docs/SECURITY_BOUNDARIES.md` says the caption and the alt text go and nothing else
    does. This is that sentence as a test, and it is worth more than the sentence.
    """

    @pytest.fixture
    def loaded(self, session: Session, tmp_path: Path) -> Recorder:
        seed_likes(
            session,
            tmp_path,
            liked(
                "DAaaaaaaaaa",
                caption="문트(@moont_official) 가을 코디, https://cwithc.co.kr/p/1 에서 판매",
                accessibility_caption=(
                    "Photo shared by eyesmag on September 3, 2025. May be an image of text."
                ),
            ),
        )
        recorder = Recorder({"0": "fashion"})
        classify_boards(session, classifier=recorder)
        return recorder

    def test_the_shortcode_does_not_go(self, loaded: Recorder) -> None:
        assert "DAaaaaaaaaa" not in loaded.sent

    def test_the_permalink_does_not_go(self, loaded: Recorder) -> None:
        assert "instagram.com" not in loaded.sent
        assert "http" not in loaded.sent

    def test_no_handle_goes(self, loaded: Recorder) -> None:
        assert "@" not in loaded.sent
        assert "moont_official" not in loaded.sent
        assert "eyesmag" not in loaded.sent

    def test_the_items_own_id_does_not_go(self, session: Session, loaded: Recorder) -> None:
        item = session.scalar(select(Item))
        assert item is not None
        assert item.id not in loaded.sent

    def test_what_does_go_is_the_caption_and_the_description(self, loaded: Recorder) -> None:
        # Stated positively as well, because a redactor that deleted everything would pass
        # every assertion above and classify nothing.
        assert "가을 코디" in loaded.sent
        assert "May be an image of text." in loaded.sent

    def test_the_payload_is_the_prompt_and_the_numbered_lines_and_nothing_else(self) -> None:
        prompt = build_prompt([BoardInput(caption="가을 코디", described="")])
        assert prompt == f"{PROMPT}\n\n0\t가을 코디"

    def test_the_subprocess_is_an_argv_list_with_no_shell(self) -> None:
        # The prompt holds text the user did not write. A shell string would make it
        # executable; an argv list cannot be.
        argv = ClaudeCliClassifier.command("payload")
        assert argv == ["claude", "-p", "payload"]

    def test_an_item_with_nothing_to_say_is_never_sent(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Two of the three residual misses in the measurement are posts like `🐰🍀` with no
        # text anywhere. There is nothing to classify and nothing worth sending.
        seed_likes(session, tmp_path, liked("EMPTY", caption="", accessibility_caption=None))
        recorder = Recorder()

        report = classify_boards(session, classifier=recorder)

        assert recorder.prompts == []
        assert (report.empty, report.declined) == (1, 1)
        assert session.scalar(select(ItemSource.collection_name)) == DECLINED


class TestWhatGetsClassified:
    def test_only_liked_instagram_posts_are_targets(self, session: Session, tmp_path: Path) -> None:
        # LinkedIn reactions are also stored as `action_type="like"` with a null collection,
        # and they reach a board by rule rather than by classification. Sending them would
        # be sending content this feature was never about.
        write(
            tmp_path,
            "linkedin_reactions",
            {
                "run": {"surface": "linkedin_reactions", "outcome": "ok"},
                "items": [
                    {
                        "platform_item_id": "post-1",
                        "canonical_url": "https://www.linkedin.com/feed/update/post-1/",
                        "kind": "post",
                        "body_text": "글",
                    }
                ],
            },
        )
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("AAA")])
        ingest_all(session, tmp_path)

        targets = classification_targets(session)

        assert len(targets) == 1
        assert targets[0][1].caption == "가을 코디 추천"

    def test_the_users_own_filing_is_never_a_target(self, session: Session, tmp_path: Path) -> None:
        # A Saved membership is the one classification `db/models.py` calls a fact.
        # Overwriting it with a guess is the thing this product promised not to do.
        write(tmp_path, "saved-fashion", [_saved("FILED")])
        ingest_all(session, tmp_path)

        assert classification_targets(session) == []

    def test_an_answered_row_is_never_a_target_again(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed_likes(session, tmp_path, liked("AAA"))
        classify_boards(session, classifier=Recorder({"0": "fashion"}))

        assert classification_targets(session) == []


class TestWritingTheAnswer:
    def test_a_classified_like_appears_on_the_board_with_no_change_to_board_filter(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The whole reason the answer goes into `collection_name`: the boards already read
        # that column, so nothing downstream needs to learn about classification.
        seed_likes(session, tmp_path, liked("AAA", caption="새 프레임워크 데모"))

        classify_boards(session, classifier=Recorder({"0": "trends"}))

        on_board = session.scalars(board_query("trends")).all()
        assert [item.platform_item_id for item in on_board] == ["AAA"]

    def test_a_declined_like_appears_on_no_board(self, session: Session, tmp_path: Path) -> None:
        seed_likes(session, tmp_path, liked("AAA"))

        classify_boards(session, classifier=Recorder({"0": "none"}))

        for board in BOARD_COLLECTIONS:
            assert session.scalars(board_query(board)).all() == []

    def test_declined_is_stored_as_a_value_and_not_left_null(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Null already means "nobody has decided". A declined post that kept it would be
        # re-sent every run, forever, for an answer already given.
        seed_likes(session, tmp_path, liked("AAA"))

        report = classify_boards(session, classifier=Recorder({"0": "none"}))

        assert report.declined == 1
        assert session.scalar(select(ItemSource.collection_name)) == DECLINED

    def test_a_second_run_sends_nothing_it_has_already_answered(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed_likes(session, tmp_path, liked("A", caption="옷"), liked("B", caption="🐰🍀"))
        classify_boards(session, classifier=Recorder({"0": "fashion", "1": "none"}))

        again = Recorder({"0": "fashion"})
        second = classify_boards(session, classifier=again)

        assert again.prompts == []
        assert second.considered == 0

    def test_a_classification_marks_the_item_as_looked_at(
        self, session: Session, tmp_path: Path
    ) -> None:
        # `checked_at` is this product's promise that something looked. It is null until
        # something did, and a classification is something having done so.
        seed_likes(session, tmp_path, liked("AAA"))
        assert session.scalar(select(Item.checked_at)) is None

        classify_boards(session, classifier=Recorder({"0": "fashion"}))

        assert session.scalar(select(Item.checked_at)) is not None

    def test_a_post_both_saved_and_liked_ends_up_on_its_board_exactly_once(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Saved and Likes share the one Instagram account row, so the membership key
        # `(item, account, collection)` collides the moment the classifier agrees with the
        # user. Two rows would put the item on the board twice, because `board_query` joins
        # `item_sources`.
        write(tmp_path, "saved-fashion", [_saved("BOTH")])
        write(tmp_path, "instagram-collect-20260808T094631Z", [liked("BOTH")])
        ingest_all(session, tmp_path)

        report = classify_boards(session, classifier=Recorder({"0": "fashion"}))

        # Counted as a merge and *not* as a classification: no row was given a board it did
        # not already have, and `classified` has to keep matching how many rows moved.
        assert (report.merged, report.classified) == (1, 0)
        assert report.boards == {}
        on_board = session.scalars(board_query("style")).all()
        assert [item.platform_item_id for item in on_board] == ["BOTH"]
        assert session.scalar(select(func.count()).select_from(ItemSource)) == 1

    def test_a_label_the_prompt_never_offered_is_refused(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A hallucinated board name must not reach `collection_name`, where it would be a
        # collection nothing renders and nothing can clear.
        seed_likes(session, tmp_path, liked("AAA"))

        classify_boards(session, classifier=Recorder({"0": "food"}))

        assert session.scalar(select(ItemSource.collection_name)) is None


class TestBatchingAndResumability:
    def test_items_are_sent_in_batches_rather_than_one_call_each(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed_likes(session, tmp_path, *(liked(f"C{n}", caption=f"글 {n}") for n in range(5)))
        recorder = Recorder({"0": "fashion", "1": "music"}, {"0": "trends", "1": "none"}, {})

        classify_boards(session, classifier=recorder, batch_size=2)

        assert len(recorder.prompts) == 3
        # Numbering restarts per batch, which is what `_apply` reads the answers back with.
        assert recorder.prompts[0].endswith("0\t글 0\n1\t글 1")

    def test_a_failed_batch_keeps_the_batches_before_it(
        self, session: Session, tmp_path: Path
    ) -> None:
        seed_likes(session, tmp_path, *(liked(f"C{n}", caption=f"글 {n}") for n in range(4)))
        recorder = Recorder({"0": "fashion", "1": "fashion"}, Unavailable("타임아웃"))

        report = classify_boards(session, classifier=recorder, batch_size=2)

        assert (report.classified, report.unavailable) == (2, 1)
        assert report.reasons == ["타임아웃"]
        answered = session.scalars(
            select(ItemSource.collection_name).where(ItemSource.collection_name.is_not(None))
        ).all()
        assert list(answered) == ["fashion", "fashion"]

    def test_an_unanswered_batch_is_retried_rather_than_recorded_as_declined(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Unavailable is not `none`. Storing a refusal nobody made would silence the item
        # permanently over a network hiccup.
        seed_likes(session, tmp_path, liked("AAA"))
        classify_boards(session, classifier=Recorder(Unavailable("설치되지 않음")))

        assert session.scalar(select(ItemSource.collection_name)) is None

        retry = Recorder({"0": "music"})
        classify_boards(session, classifier=retry)
        assert session.scalar(select(ItemSource.collection_name)) == "music"

    def test_limit_caps_what_one_run_sends(self, session: Session, tmp_path: Path) -> None:
        seed_likes(session, tmp_path, *(liked(f"C{n}", caption=f"글 {n}") for n in range(5)))
        recorder = Recorder({"0": "fashion"})

        report = classify_boards(session, classifier=recorder, limit=1)

        assert report.considered == 1
        assert len(recorder.prompts) == 1

    def test_the_shipped_default_classifier_is_never_reached_by_a_test(self) -> None:
        # `NoBoardClassifier` exists so a run can be wired up without a subprocess at all,
        # which is what every test in this file uses through `Recorder`.
        assert isinstance(NoBoardClassifier().classify("x"), Unavailable)


class TestReadingWhatCameBack:
    def test_a_bare_object_is_read(self) -> None:
        assert parse_answer('{"0":"fashion"}') == {"0": "fashion"}

    def test_a_fenced_or_explained_answer_is_still_read(self) -> None:
        # `설명 금지` is an instruction, not a guarantee. A model that wraps the object has
        # still answered.
        assert parse_answer('여기 있습니다:\n```json\n{"0":"music"}\n```\n') == {"0": "music"}

    def test_a_label_outside_the_five_is_dropped_here(self) -> None:
        assert parse_answer('{"0":"fashion","1":"food"}') == {"0": "fashion"}

    @pytest.mark.parametrize("payload", ["", "없음", "[1,2]", "{oops}"])
    def test_an_unreadable_answer_is_a_state_and_not_an_exception(self, payload: str) -> None:
        assert isinstance(parse_answer(payload), Unavailable)


def test_exactly_one_scheduled_caller_and_no_endpoint() -> None:
    """Who may start a transmission, asserted rather than promised.

    This test used to read `callers == {enrich/*}` and was named
    `test_nothing_in_this_repository_runs_the_classifier_on_a_schedule`. It was a tripwire
    for exactly one conversation — *should a timer be allowed to send content?* — and on
    2026-08-12 the user had it and said yes. So the assertion inverts rather than
    disappearing: the collection cycle is now expected, and anything else still is not.

    What must never appear here is an HTTP handler. A caller under `api/` would mean a
    request could make this machine send captions somewhere, which is a different kind of
    exposure from a job the user installed on their own laptop — `app.py` is bound to
    loopback but it is still a surface, and it has no authentication precisely because
    nothing behind it was supposed to reach outward.
    """
    source = REPO_ROOT / "apps" / "api" / "src" / "taste_inbox"
    callers = {
        path.relative_to(source).as_posix()
        for path in source.rglob("*.py")
        if "classify_boards" in path.read_text(encoding="utf-8")
    }

    assert callers == {
        "enrich/classify.py",
        "enrich/cli.py",
        "enrich/__init__.py",
        "ingest/collect.py",
    }
    assert not any(caller.startswith("api/") for caller in callers), (
        "an HTTP handler must not be able to start a send"
    )


def test_the_scheduled_run_is_bounded(self_check: None = None) -> None:
    """A cycle may not send the whole backlog at once.

    Unbounded, a first run after a quiet week would hand over everything that accumulated in
    one go. The cap makes a backlog drain over several cycles, which is the difference
    between a bounded recurring cost and a surprise.
    """
    collect_source = (
        REPO_ROOT / "apps" / "api" / "src" / "taste_inbox" / "ingest" / "collect.py"
    ).read_text(encoding="utf-8")

    assert "_CLASSIFY_LIMIT" in collect_source
    assert "limit=_CLASSIFY_LIMIT" in collect_source
    # And it must be refusable without editing code.
    assert "--no-classify" in collect_source


def test_the_report_says_enough_to_tell_a_quiet_run_from_a_broken_one() -> None:
    keys = set(ClassifyReport().as_dict())
    assert keys == {
        "considered",
        "classified",
        "declined",
        "empty",
        "merged",
        "unavailable",
        "boards",
        "reasons",
    }


def _saved(code: str, **overrides: Any) -> dict[str, Any]:
    """One `CapturedItem`, the shape the Saved collections produced while they worked."""
    item: dict[str, Any] = {
        "code": code,
        "media_type": "image",
        "product_type": "feed",
        "taken_at": 1757736341,
        "owner": "sample_owner",
        "caption": "저장한 코디",
        "accessibility_caption": None,
        "audio_title": None,
        "audio_artist": None,
        "is_original_audio": None,
        "product_tag_count": 0,
        "user_tag_count": 0,
        "source_endpoint": "/api/v1/feed/",
        "thumbnail_url": "https://scontent.cdninstagram.com/v/t51/x.jpg?oe=6A7CCD0F",
        "thumbnail_width": 640,
        "thumbnail_height": 1136,
    }
    item.update(overrides)
    return item
