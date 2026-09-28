"""Configuration and environment validation."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from taste_inbox.config.loader import (
    ConfigError,
    load_app_document,
    load_environment,
    load_resource_policy_document,
)
from taste_inbox.paths import CONFIG_DIR, REPO_ROOT


def test_example_resource_policy_is_valid() -> None:
    document = load_resource_policy_document()

    assert document.resource_policy.mode == "adaptive"
    assert document.host.detection == "auto"
    assert document.host.architecture == "arm64"
    # Nothing about a specific device is baked into the shipped example.
    assert document.host.manual_override.device is None
    assert document.host.manual_override.unified_memory_gb is None


def test_example_app_config_is_valid() -> None:
    document = load_app_document()

    assert document.app.locale == "ko-KR"
    # Locked decision: DECISIONS.md → Default theme.
    assert document.app.default_theme == "meadow-cream"
    assert document.app.default_motion == "cinematic"
    # Collection is an interval, not a clock time: likes arrive at 02:00 as readily as at
    # 19:00, and a single evening run made the 02:00 one wait eighteen hours.
    assert document.collection.interval_hours == 4
    assert document.collection.allow_manual_refresh is True
    # The flags for collectors this product never built went on 2026-09-28.
    assert not hasattr(document, "features")


@pytest.mark.parametrize("hours", [0, -4, 25, 8760])
def test_an_absurd_interval_is_refused_at_load_time(tmp_path: Path, hours: int) -> None:
    """Not at the first run, hours later, with a launchd job already installed.

    Zero is a busy loop against the platforms' APIs, and anything past a day is no longer
    the daily Inbox this product is.
    """
    raw = yaml.safe_load((CONFIG_DIR / "app.example.yaml").read_text(encoding="utf-8"))
    raw["collection"]["interval_hours"] = hours
    broken = tmp_path / "app.yaml"
    broken.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(ConfigError, match="interval_hours"):
        load_app_document(broken)


def test_a_stagger_that_outruns_the_interval_is_refused(tmp_path: Path) -> None:
    # 30 minutes across three sources spans an hour, so with a one-hour interval the printed
    # install block asks a person to wait a whole collection cycle before the last job is
    # loaded. Not starvation — `StartInterval` counts from load — but a config whose install
    # reads as a hang is worth refusing. Both values are individually inside their bounds.
    raw = yaml.safe_load((CONFIG_DIR / "app.example.yaml").read_text(encoding="utf-8"))
    raw["collection"]["interval_hours"] = 1
    raw["collection"]["stagger_minutes"] = 30
    broken = tmp_path / "app.yaml"
    broken.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(ConfigError, match="takes longer than the 1-hour interval"):
        load_app_document(broken)


def test_default_theme_must_be_a_known_theme(tmp_path: Path) -> None:
    raw = yaml.safe_load((CONFIG_DIR / "app.example.yaml").read_text(encoding="utf-8"))
    raw["app"]["default_theme"] = "no-such-theme"
    broken = tmp_path / "app.yaml"
    broken.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(ConfigError, match="no-such-theme"):
        load_app_document(broken)


def test_theme_ids_file_matches_the_documented_six() -> None:
    payload = json.loads(
        (REPO_ROOT / "packages" / "ui" / "theme-ids.json").read_text(encoding="utf-8")
    )

    assert payload["themeIds"] == [
        "meadow-cream",
        "moss-cream",
        "spring-sage",
        "bright-forest",
        "ivory-sage",
        "oatwood-cream",
    ]
    assert payload["defaultThemeId"] == "meadow-cream"
    assert payload["storageKey"] == "taste-inbox-component-theme-v4"


def test_cache_shares_cannot_exceed_the_budget(tmp_path: Path) -> None:
    raw = yaml.safe_load((CONFIG_DIR / "resource-policy.example.yaml").read_text("utf-8"))
    raw["resource_policy"]["storage"]["cache_budget"]["shares"] = {
        "model": 0.7,
        "container": 0.5,
        "media": 0.3,
    }
    broken = tmp_path / "resource-policy.yaml"
    broken.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(ConfigError, match="exceeds the cache budget"):
        load_resource_policy_document(broken)


def test_unknown_config_key_is_rejected(tmp_path: Path) -> None:
    raw = yaml.safe_load((CONFIG_DIR / "resource-policy.example.yaml").read_text("utf-8"))
    raw["resource_policy"]["memory"]["unified_memory_gb"] = 16
    broken = tmp_path / "resource-policy.yaml"
    broken.write_text(yaml.safe_dump(raw), encoding="utf-8")

    with pytest.raises(ConfigError):
        load_resource_policy_document(broken)


def test_missing_file_reports_the_path(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="not found"):
        load_app_document(tmp_path / "absent.yaml")


def test_malformed_yaml_is_reported_as_config_error(tmp_path: Path) -> None:
    broken = tmp_path / "app.yaml"
    broken.write_text("app: [unclosed", encoding="utf-8")

    with pytest.raises(ConfigError, match="not valid YAML"):
        load_app_document(broken)


# ------------------------------------------------------------------- environment


def test_mock_mode_requires_no_secrets() -> None:
    """Phase 0 exit criterion: a clean checkout runs with no secrets at all."""
    environment = load_environment({})

    assert environment.is_mock is True
    assert environment.data_source == "mock"
    assert environment.configured_secrets == frozenset()
    assert environment.app_timezone == "Asia/Seoul"


def test_live_mode_requires_a_credential() -> None:
    with pytest.raises(ConfigError, match="requires at least one configured credential"):
        load_environment({"NEXT_PUBLIC_DATA_SOURCE": "live"})


def test_live_mode_reports_presence_but_never_the_value() -> None:
    environment = load_environment(
        {"NEXT_PUBLIC_DATA_SOURCE": "live", "GITHUB_TOKEN": "a-real-looking-value"}
    )

    assert environment.configured_secrets == frozenset({"GITHUB_TOKEN"})
    # Secret values must not be reachable through the validated environment object.
    assert "a-real-looking-value" not in repr(environment)


def test_blank_secret_counts_as_unset() -> None:
    with pytest.raises(ConfigError):
        load_environment({"NEXT_PUBLIC_DATA_SOURCE": "live", "GITHUB_TOKEN": "   "})


def test_invalid_data_source_is_rejected() -> None:
    with pytest.raises(ConfigError, match="must be 'mock' or 'live'"):
        load_environment({"NEXT_PUBLIC_DATA_SOURCE": "production"})


def test_fixture_path_must_exist() -> None:
    with pytest.raises(ConfigError, match="does not point at a file"):
        load_environment({"TASTE_INBOX_HOST_PROFILE_FIXTURE": "/nonexistent/profile.json"})
