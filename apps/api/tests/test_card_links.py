"""Every card offers somewhere to go, on every board and from every source.

The source link answers "where did this come from". These answer "what is it actually
about" — which for a LinkedIn post whose subject is a paper on another domain is the
question the user came with, and was one hop out of reach.

The five real `lnkd.in` links in the collection are what shaped the rules: every one of
them wraps a destination that is the actual subject of the post, and showing both the
wrapper and the destination would offer the same click twice.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.cards import to_ai_card, to_music_card, to_style_card
from taste_inbox.db.models import Base, Evidence, Item
from taste_inbox.ingest import ingest_all


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as active:
        yield active


def capture(tmp_path: Path, **overrides: Any) -> None:
    item: dict[str, Any] = {
        "platform": "linkedin",
        "platform_item_id": "post-1",
        "canonical_url": "https://www.linkedin.com/feed/update/post-1",
        "kind": "post",
        "title": None,
        "body_text": "좋은 논문",
        "owner": "someone",
        "source_published_at": None,
        "action_at": None,
        "observed_age": None,
        "tags": [],
        "outbound_urls": [],
    }
    item.update(overrides)
    payload = {
        "run": {
            "surface": "linkedin_reactions",
            "outcome": "ok",
            "started_at": "2026-08-09T00:00:00+00:00",
            "scroll_passes": 0,
            "exhausted": False,
            "checkpoint": "post-1",
            "advanced_checkpoint": True,
            "stopped_because": "done",
            "notes": [],
            "raw": [],
        },
        "items": [item],
    }
    (tmp_path / "linkedin_reactions.json").write_text(
        json.dumps(payload, ensure_ascii=False), "utf-8"
    )


def ingest(session: Session, tmp_path: Path, **overrides: Any) -> Item:
    capture(tmp_path, **overrides)
    ingest_all(session, tmp_path)
    item = session.scalar(select(Item))
    assert item is not None
    return item


class TestLinks:
    def test_a_repository_link_in_a_post_reaches_the_card(
        self, session: Session, tmp_path: Path
    ) -> None:
        item = ingest(session, tmp_path, outbound_urls=["https://github.com/a/b"])
        links = to_ai_card(session, item)["links"]

        assert [link["kind"] for link in links] == ["artifact"]
        assert links[0]["url"] == "https://github.com/a/b"
        # The host, not a page title: a title would have to be fetched, and rendering a
        # card never causes a request.
        assert links[0]["label"] == "github.com"
        assert links[0]["via"] is None

    def test_a_commenter_s_link_is_marked_as_theirs(self, session: Session, tmp_path: Path) -> None:
        item = ingest(session, tmp_path, comment_urls=["https://github.com/a/b"])
        links = to_ai_card(session, item)["links"]

        assert [link["origin"] for link in links] == ["comment"]

    def test_a_followed_shortener_appears_once_as_its_destination(
        self, session: Session, tmp_path: Path
    ) -> None:
        item = ingest(session, tmp_path, outbound_urls=["https://lnkd.in/abc"])
        session.add(
            Evidence(
                item_id=item.id,
                type="outbound_link",
                label="resolved::https://lnkd.in/abc",
                value="https://www.olaresearch.org/MaLA/",
                provenance="external",
            )
        )
        session.commit()

        links = to_ai_card(session, item)["links"]

        # One click, to the page — not two, one of which only redirects.
        assert [link["url"] for link in links] == ["https://www.olaresearch.org/MaLA/"]
        assert links[0]["kind"] == "resolved"
        # The wrapper survives, so which one was unwrapped is still visible.
        assert links[0]["via"] == "https://lnkd.in/abc"

    def test_an_unfollowed_shortener_is_still_offered(
        self, session: Session, tmp_path: Path
    ) -> None:
        # The resolver failing is not a reason to take away a working click. It is labelled
        # as an unknown destination rather than hidden.
        item = ingest(session, tmp_path, outbound_urls=["https://lnkd.in/abc"])
        links = to_ai_card(session, item)["links"]

        assert [link["kind"] for link in links] == ["unresolved"]
        assert links[0]["url"] == "https://lnkd.in/abc"

    def test_a_repository_found_behind_a_shortener_is_still_a_repository(
        self, session: Session, tmp_path: Path
    ) -> None:
        item = ingest(session, tmp_path, outbound_urls=["https://lnkd.in/abc"])
        session.add(
            Evidence(
                item_id=item.id,
                type="artifact_link",
                label="resolved::https://lnkd.in/abc",
                value="https://github.com/open-metadata/OpenMetadata",
                provenance="external",
            )
        )
        session.commit()

        link = to_ai_card(session, item)["links"][0]
        # `artifact` over `resolved`: which board can act on it matters more than how it
        # was reached, and `via` records the route either way.
        assert link["kind"] == "artifact"
        assert link["via"] == "https://lnkd.in/abc"

    def test_the_most_actionable_destination_comes_first(
        self, session: Session, tmp_path: Path
    ) -> None:
        item = ingest(
            session,
            tmp_path,
            outbound_urls=["https://example.com/blog", "https://github.com/a/b"],
        )
        kinds = [link["kind"] for link in to_ai_card(session, item)["links"]]
        assert kinds == ["artifact", "outbound"]

    def test_the_same_url_is_never_offered_twice(self, session: Session, tmp_path: Path) -> None:
        item = ingest(session, tmp_path, outbound_urls=["https://github.com/a/b"])
        session.add(
            Evidence(
                item_id=item.id,
                type="comment_artifact_link",
                label="댓글에 포함된 저장소·모델 링크",
                value="https://github.com/a/b",
                provenance="fact",
            )
        )
        session.commit()

        assert len(to_ai_card(session, item)["links"]) == 1

    def test_a_url_written_twice_keeps_the_better_description(
        self, session: Session, tmp_path: Path
    ) -> None:
        # A real LinkedIn post links a page *and* a shortener to the same page. Keeping
        # whichever row happened to be stored first threw away the route, and which one
        # that was depended on insertion order.
        item = ingest(session, tmp_path, outbound_urls=["https://claude.com/blog/x"])
        session.add(
            Evidence(
                item_id=item.id,
                type="outbound_link",
                label="resolved::https://lnkd.in/abc",
                value="https://claude.com/blog/x",
                provenance="external",
            )
        )
        session.commit()

        links = to_ai_card(session, item)["links"]
        assert len(links) == 1
        assert links[0]["kind"] == "resolved"
        assert links[0]["via"] == "https://lnkd.in/abc"

    def test_a_link_back_into_the_same_platform_sorts_last(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Four collected posts link LinkedIn company pages and one links a
        # newsletter-follow button. The card already links LinkedIn; these are lateral
        # moves. Sorted down rather than dropped — a working click is never taken away.
        item = ingest(
            session,
            tmp_path,
            outbound_urls=[
                "https://www.linkedin.com/company/helsinki-nlp/",
                "https://www.olaresearch.org/MaLA/",
            ],
        )
        labels = [link["label"] for link in to_ai_card(session, item)["links"]]
        assert labels == ["olaresearch.org", "linkedin.com"]

    def test_an_item_that_links_nothing_says_so_with_an_empty_list(
        self, session: Session, tmp_path: Path
    ) -> None:
        # Most items link nothing. Empty is a value, not a missing field — the card renders
        # nothing rather than an empty heading.
        item = ingest(session, tmp_path)
        assert to_ai_card(session, item)["links"] == []

    @pytest.mark.parametrize("build", [to_ai_card, to_style_card, to_music_card])
    def test_every_board_carries_the_same_affordance(
        self, session: Session, tmp_path: Path, build: Any
    ) -> None:
        # "소스·보드 상관없이" — the same list on all three, built the same way, so a link
        # is never visible on one board and invisible on another.
        item = ingest(session, tmp_path, outbound_urls=["https://github.com/a/b"])
        card = build(session, item)
        assert [link["url"] for link in card["links"]] == ["https://github.com/a/b"]

    @pytest.mark.parametrize("build", [to_ai_card, to_style_card, to_music_card])
    def test_every_card_always_links_back_to_where_it_came_from(
        self, session: Session, tmp_path: Path, build: Any
    ) -> None:
        # The floor: whatever else is or is not known, every card on every board has one
        # link that works.
        item = ingest(session, tmp_path)
        card = build(session, item)
        assert card["source"]["originalUrl"].startswith("http")
