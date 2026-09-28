"""The settings document, exercised against the config the repository actually ships.

Every assertion about a *value* here is really an assertion about a *layer*: this screen
exists to say whether 4 came from the schema, from the file or from the user, and the three
are indistinguishable once the document is validated. So the tests read the shipped
`config/app.example.yaml` for the file layer, write nothing to `config/`, and point the
loader at `tmp_path` through `TASTE_INBOX_APP_CONFIG` — the same env var `.env.example`
advertises — whenever a different file is needed.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from taste_inbox.api.app import app, get_session
from taste_inbox.db.models import Base, Setting
from taste_inbox.paths import CONFIG_DIR

#: Copied from `packages/shared/src/domain/settings.ts`. A name that drifts here is a
#: payload the frontend refuses whole, so the keys are asserted rather than trusted.
SETTING_KEYS = {
    "collection.intervalHours",
    "collection.staggerMinutes",
    "collection.allowManualRefresh",
    "appearance.defaultTheme",
    "appearance.defaultMotion",
    "general.timezone",
    "general.locale",
    "general.ceremonialEntry",
}
GROUPS = ("collection", "appearance", "general")
SETTING_BASE = {"value", "origin", "effect", "editable"}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    # One shared connection, as in `test_api.py`: `TestClient` runs the app on another
    # thread and the default in-memory pool would hand that thread an empty database.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)

    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def config_with(tmp_path: Path, *, app: dict[str, Any] | None = None, **collection: Any) -> Path:
    """The shipped example with a section overridden, written to `tmp_path`.

    Never to `config/`: the suite must not depend on, or leave behind, a local
    `config/app.yaml` — the file's mere existence changes which config the whole app reads.

    An `app` entry whose value is `None` *removes* the key instead of setting it. That is the
    only way to exercise the `default` layer without the assertion depending on what the
    shipped example happens to omit today — and the example's omissions are exactly the sort
    of thing that changes without this suite being consulted.
    """
    raw = yaml.safe_load((CONFIG_DIR / "app.example.yaml").read_text(encoding="utf-8"))
    raw["collection"].update(collection)
    for key, value in (app or {}).items():
        if value is None:
            raw["app"].pop(key, None)
        else:
            raw["app"][key] = value
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def patch(client: TestClient, **changes: Any) -> Any:
    return client.patch("/api/settings", json={"changes": changes})


def stored(key: str) -> Setting | None:
    """The override row itself, read through the same session the app was given.

    Asserting on the table and not only on the response, because "the value came back" and
    "the value was written" are the two halves this endpoint has to keep together.
    """
    session: Session = next(app.dependency_overrides[get_session]())
    return session.get(Setting, key)


class TestOrigin:
    """Which of the three layers produced this value — the question the screen exists for.

    A validated `AppDocument` answers none of them: `ceremonial_entry` reads `full` whether
    the file said `full` or said nothing at all, and those are different sentences on screen.
    """

    def test_a_value_the_file_never_mentions_reports_the_schema_default(
        self, client: TestClient
    ) -> None:
        # `config/app.example.yaml` omits `ceremonial_entry` on purpose; `full` is the schema's.
        setting = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]

        assert setting["origin"] == "default"
        assert setting["value"] == "full"

    def test_a_value_the_yaml_sets_reports_the_file_it_came_from(self, client: TestClient) -> None:
        # Same number the schema would have defaulted to. Only the raw mapping can tell the
        # two apart, which is why `_origin` reads it instead of the validated document.
        setting = client.get("/api/settings").json()["data"]["collection"]["intervalHours"]

        assert setting["origin"] == "file"
        assert setting["value"] == 4

    def test_a_value_the_user_changed_reports_user_and_survives_a_reload(
        self, client: TestClient
    ) -> None:
        assert patch(client, **{"collection.intervalHours": 6}).status_code == 200

        # A second GET is a genuine reload: the fixture hands every request its own session,
        # so this reads the row back out of the database rather than out of memory.
        setting = client.get("/api/settings").json()["data"]["collection"]["intervalHours"]

        assert setting["origin"] == "user"
        assert setting["value"] == 6
        row = stored("collection.intervalHours")
        assert row is not None and json.loads(row.value) == 6

    def test_the_entry_sequence_reports_each_of_the_three_layers_in_turn(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`full` as a schema default, `skip` from a file, `brief` from the user.

        The one leaf whose `default` layer is deliberate rather than forgotten:
        `config/app.example.yaml` does not name `ceremonial_entry`, because this screen is
        where it is meant to be written and a line in the example would make every fresh
        checkout report a file edit for a choice nobody has made. Both other layers are built
        here instead of assumed, so nothing in this test rests on what the example omits.
        """
        monkeypatch.setenv(
            "TASTE_INBOX_APP_CONFIG", str(config_with(tmp_path, app={"ceremonial_entry": None}))
        )
        default = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]
        assert default["origin"] == "default"
        assert default["value"] == "full"

        monkeypatch.setenv(
            "TASTE_INBOX_APP_CONFIG", str(config_with(tmp_path, app={"ceremonial_entry": "skip"}))
        )
        from_file = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]
        assert from_file["origin"] == "file"
        assert from_file["value"] == "skip"

        assert patch(client, **{"general.ceremonialEntry": "brief"}).status_code == 200
        from_user = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]

        assert from_user["origin"] == "user"
        # Over a file that says `skip`. A stored choice losing to the shipped example would
        # make every entry the user turned off come back on the next read.
        assert from_user["value"] == "brief"
        row = stored("general.ceremonialEntry")
        assert row is not None and json.loads(row.value) == "brief"

    def test_an_override_is_stored_as_the_value_pydantic_produced(self, client: TestClient) -> None:
        # JSON has one number type, so a slider sending 6.0 must not leave a float in a
        # column the loader will later validate as an int.
        patch(client, **{"collection.intervalHours": 6.0})

        row = stored("collection.intervalHours")
        assert row is not None and row.value == "6"


class TestWrites:
    """What a patch is allowed to do, and what it must leave exactly as it found it."""

    def test_a_rejected_change_leaves_the_stored_value_untouched(self, client: TestClient) -> None:
        patch(client, **{"collection.intervalHours": 6})

        response = patch(client, **{"collection.intervalHours": 99})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "setting_rejected"
        assert "collection.intervalHours" in response.json()["error"]["message"]
        row = stored("collection.intervalHours")
        assert row is not None and json.loads(row.value) == 6

    def test_the_stagger_and_the_interval_are_still_validated_as_a_pair(
        self, client: TestClient
    ) -> None:
        """One hour and 30 minutes are each inside their own bounds; the pair is not.

        `_stagger_must_fit_inside_one_interval` rejects it because 30 x 2 = 60 minutes of
        printed `sleep` fills the whole 60-minute interval. A patch path that validated field
        by field would accept what `config/loader.py` refuses to load, and the screen would
        have written a config the app cannot start on.
        """
        response = patch(client, **{"collection.intervalHours": 1, "collection.staggerMinutes": 30})

        assert response.status_code == 422
        message = response.json()["error"]["message"]
        assert "collection." in message
        # The ceiling is stated, not just the refusal: one hour across three sources leaves
        # 29 — `ceil(60 / 2) - 1`.
        assert "29" in message
        assert stored("collection.staggerMinutes") is None

    def test_resetting_a_key_hands_it_back_to_the_file(self, client: TestClient) -> None:
        # Without this the override layer is a one-way door: every value the user ever
        # touched would report `user` forever and the file could never win again.
        patch(client, **{"collection.intervalHours": 6})

        patch(client, **{"collection.intervalHours": None})

        setting = client.get("/api/settings").json()["data"]["collection"]["intervalHours"]
        assert setting["origin"] == "file"
        assert setting["value"] == 4
        assert stored("collection.intervalHours") is None

    def test_an_entry_sequence_outside_the_three_modes_is_refused(self, client: TestClient) -> None:
        """`cinematic` belongs to the choice one row up and means nothing to this one.

        The startup route branches on this string, and a fourth value would leave it with no
        matching branch — a screen the user did not ask for, chosen by a fallback. The
        refusal names both the key and the three modes because the response body is the whole
        document either way: without them the user is left guessing which of thirteen values
        was refused and what it would have taken.
        """
        response = patch(client, **{"general.ceremonialEntry": "cinematic"})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "setting_rejected"
        message = response.json()["error"]["message"]
        assert "general.ceremonialEntry" in message
        assert "full · brief · skip" in message
        assert stored("general.ceremonialEntry") is None

    def test_an_unknown_key_is_a_typed_error_rather_than_a_dropped_write(
        self, client: TestClient
    ) -> None:
        # The response is the full document either way, so a silently ignored key is
        # indistinguishable from a change that had no effect.
        response = patch(client, **{"collection.intervalHour": 6})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "setting_unknown"
        assert "collection.intervalHour" in response.json()["error"]["message"]

    def test_a_timezone_this_computer_cannot_read_is_refused(self, client: TestClient) -> None:
        """`Asia/Seuol` validates at every other layer and then moves the day by nine hours.

        `AppSection.timezone` is a bare `str` and `api/schedule.py:46-52` answers an
        unreadable zone with UTC instead of failing, so nothing downstream ever reports the
        typo — Today's boundary and every collection slot just shift, with the misspelling
        left on screen as the explanation.
        """
        response = patch(client, **{"general.timezone": "Asia/Seuol"})

        assert response.status_code == 422
        assert "Asia/Seuol" in response.json()["error"]["message"]
        assert stored("general.timezone") is None

        assert patch(client, **{"general.timezone": "Europe/Berlin"}).status_code == 200

    def test_a_patch_with_no_changes_key_is_a_typed_error(self, client: TestClient) -> None:
        response = client.patch("/api/settings", json={"collection.intervalHours": 6})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "setting_rejected"


class TestHonesty:
    """Nothing on this screen may claim an effect the code cannot produce.

    Written after the survey that found four of seventeen config fields have a reader at
    all, and that the `settings` table had zero readers and zero writers.
    """

    def test_an_editable_key_changes_a_screen_other_than_this_one(self, client: TestClient) -> None:
        """The rule that decides what may be edited, stated as a test.

        A control over a value nothing reads is a control that does nothing — the same shape
        `docs/DECISIONS.md` settled for the Style board's filters on 2026-08-09. The interval
        is offered here only because `/api/collection/schedule` resolves through
        `effective_document(session)`; before that it read the file and would have gone on
        answering 4 while this screen showed 6.
        """
        before = client.get("/api/collection/schedule").json()["data"]
        assert before["intervalHours"] == 4

        saved = client.patch("/api/settings", json={"changes": {"collection.intervalHours": 6}})
        assert saved.status_code == 200

        after = client.get("/api/collection/schedule").json()["data"]
        assert after["intervalHours"] == 6
        # The derived half too, not just the echoed number: six slots a day become four.
        assert len(after["dailySlots"]) == 4

    def test_an_override_reaches_the_jobs_the_installer_writes(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """`nextInstall` is a promise about the plists, so the plists have to carry it.

        Labelling the interval "다음 설치부터" and then generating a job from the file's
        value would be the same failure this screen exists to prevent, one layer down.
        """
        import plistlib

        from taste_inbox.api.launchd import generate

        assert patch(client, **{"collection.intervalHours": 6}).status_code == 200

        session: Session = next(app.dependency_overrides[get_session]())
        jobs = generate(tmp_path / "jobs", session=session)

        assert jobs
        for job in jobs:
            assert plistlib.loads(job.path.read_bytes())["StartInterval"] == 6 * 3600

    def test_the_entry_sequence_is_offered_because_this_payload_is_its_only_source(
        self, client: TestClient
    ) -> None:
        """The fifth editable key, and the only one whose reader is the web app.

        That is not the contradiction `appearance.defaultTheme` would be. The theme has a
        *competing* resolver — `components/theme/theme-bootstrap.ts` reads `localStorage` and
        never asks this service — so an override of it moves nothing, which is why it ships
        read-only. Nothing else anywhere decides whether the app opens on Splash, on Greeting
        or on Today; this value is read off this payload, so a control over it changes a
        screen other than this one.
        """
        setting = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]
        assert setting["editable"] is True
        assert setting["options"] == ["full", "brief", "skip"]
        # Not `nextInstall`: no plist carries a copy. Not `nextRun`: no collector reads it.
        assert setting["effect"] == "immediate"

        assert patch(client, **{"general.ceremonialEntry": "skip"}).status_code == 200

        # `immediate` as this document means it — the next request already answers with the
        # override, with nothing to reinstall and no run to wait for in between.
        after = client.get("/api/settings").json()["data"]["general"]["ceremonialEntry"]
        assert after["value"] == "skip"

    def test_a_key_with_no_reader_is_not_offered(self, client: TestClient) -> None:
        """The three that stay read-only: `appearance.*` is resolved by the web app's theme
        bootstrap, never by this service, and nothing reads the locale."""
        document = client.get("/api/settings").json()["data"]

        for group, name in (
            ("appearance", "defaultTheme"),
            ("appearance", "defaultMotion"),
            ("general", "locale"),
        ):
            assert document[group][name]["editable"] is False, f"{group}.{name}"

    def test_nothing_from_the_instagram_era_is_left_to_show(self, client: TestClient) -> None:
        """The feature flags for collectors this product never built ("아직 없는 설정"), the
        debug retention only a browser collector read, and the per-source switches that
        stopped nothing were removed on 2026-09-28."""
        document = client.get("/api/settings").json()["data"]

        for gone in ("features", "privacy", "sources"):
            assert gone not in document
        assert patch(client, **{"features.linkedinCollector": True}).status_code == 422

    def test_the_stagger_ceiling_follows_the_interval_it_has_to_fit_inside(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Static bounds would let the UI compose a pair the backend refuses.

        `interval=1, stagger=30` has both halves inside their declared 1-24 and 0-60 and is
        rejected as a pair. Sending the derived ceiling — the static 60 at four hours, 29 at
        one hour — makes the control unable to build one.
        """
        shipped = client.get("/api/settings").json()["data"]["collection"]
        assert shipped["staggerMinutes"]["max"] == 60
        assert shipped["intervalHours"]["min"] == 1

        monkeypatch.setenv("TASTE_INBOX_APP_CONFIG", str(config_with(tmp_path, interval_hours=1)))
        tightened = client.get("/api/settings").json()["data"]["collection"]

        assert tightened["staggerMinutes"]["max"] == 29
        assert tightened["staggerMinutes"]["value"] == 3

    def test_an_override_the_file_has_outgrown_is_dropped_rather_than_served(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A stored value can stop validating without anybody touching it.

        `stagger_minutes: 30` is legal against the shipped four-hour interval (30 x 2 = 60
        fits inside 240) and illegal the moment the file drops the interval to one hour
        (60 >= 60). Serving it would print a pair `config/loader.py` refuses to load, and
        raising on it would take down the only screen that can remove it.
        """
        assert patch(client, **{"collection.staggerMinutes": 30}).status_code == 200

        monkeypatch.setenv("TASTE_INBOX_APP_CONFIG", str(config_with(tmp_path, interval_hours=1)))
        setting = client.get("/api/settings").json()["data"]["collection"]["staggerMinutes"]

        assert setting["value"] == 3
        assert setting["origin"] == "file"
        # The row survives: the file may go back to four hours, and deleting the user's
        # choice because a different value moved would be losing it on their behalf.
        assert stored("collection.staggerMinutes") is not None


class TestContract:
    """Field names the frontend validates against, asserted so drift fails here first."""

    def test_every_settings_response_is_wrapped_in_data(self, client: TestClient) -> None:
        assert "data" in client.get("/api/settings").json()
        assert "data" in patch(client, **{"collection.allowManualRefresh": False}).json()

    def test_the_document_carries_exactly_the_shared_contract_field_names(
        self, client: TestClient
    ) -> None:
        document = client.get("/api/settings").json()["data"]

        assert set(document) == {"generatedAt", *GROUPS}
        keys = {f"{group}.{name}" for group in GROUPS for name in document[group]}
        assert keys == SETTING_KEYS

    def test_every_setting_carries_its_own_bounds(self, client: TestClient) -> None:
        # The bounds travel with the value so they have one home. The frontend refines on
        # `min <= value <= max`, so a producer that sends the pair wrong is a payload the
        # whole screen refuses rather than a slider whose thumb sits outside its track.
        document = client.get("/api/settings").json()["data"]

        for name in ("intervalHours", "staggerMinutes"):
            setting = document["collection"][name]
            assert set(setting) == SETTING_BASE | {"min", "max"}
            assert setting["min"] <= setting["value"] <= setting["max"]
        assert set(document["collection"]["allowManualRefresh"]) == SETTING_BASE
        assert set(document["general"]["timezone"]) == SETTING_BASE

        for name in ("defaultTheme", "defaultMotion"):
            setting = document["appearance"][name]
            assert set(setting) == SETTING_BASE | {"options"}
            assert setting["value"] in setting["options"]
        # Six themes from `packages/ui/theme-ids.json`, in its documented order.
        assert len(document["appearance"]["defaultTheme"]["options"]) == 6
        # Two, and the frontend has three: `ambient` is a real motion mode the config
        # cannot express (`config/schema.py:153`).
        assert document["appearance"]["defaultMotion"]["options"] == ["cinematic", "reduced"]

        entry = document["general"]["ceremonialEntry"]
        assert set(entry) == SETTING_BASE | {"options"}
        assert entry["value"] in entry["options"]
        # In `AppSection`'s declared order, which `CEREMONIAL_ENTRY_MODES` in
        # `packages/shared/src/domain/settings.ts` restates so the startup route can branch on
        # it. Two homes for one vocabulary, pinned at both ends rather than trusted.
        assert entry["options"] == ["full", "brief", "skip"]

    def test_every_effect_is_one_the_shared_union_can_represent(self, client: TestClient) -> None:
        # There is deliberately no member for "nothing reads this", which is the true answer
        # for three of the eight. Sending one anyway would fail the frontend's own zod
        # parse and cost the screen entirely, so `editable: false` carries it instead.
        document = client.get("/api/settings").json()["data"]

        for group in GROUPS:
            for setting in document[group].values():
                assert setting["effect"] in {"immediate", "nextRun", "nextInstall"}
                assert setting["origin"] in {"default", "file", "user"}
