"""Configuration and environment loading.

Two guarantees this module exists to provide, both from the Phase 0 exit criteria:

1. A clean checkout runs in **mock mode with no secrets at all**.
2. A malformed configuration file fails at startup with a precise message, not later
   inside a collector or a sandbox launch.

Secret *values* are never logged or echoed. Only their presence is reported.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast, get_args

import yaml
from pydantic import BaseModel, ValidationError

from taste_inbox.config.schema import AppDocument, ResourcePolicyDocument
from taste_inbox.paths import CONFIG_DIR

DataSource = Literal["mock", "live"]

#: Environment variables that hold a secret. Presence is reported; values never are.
SECRET_ENV_KEYS = (
    "GITHUB_TOKEN",
    "LLM_API_KEY",
    "VISION_API_KEY",
    "SEARCH_API_KEY",
    "NOTIFICATION_WEBHOOK_URL",
)


class ConfigError(RuntimeError):
    """Raised when configuration is missing or invalid."""


@dataclass(frozen=True, slots=True)
class Environment:
    """Validated process environment.

    Every field has a working default so that `mock` mode needs no `.env` file.
    """

    app_env: str
    app_timezone: str
    data_source: DataSource
    database_url: str
    host_profile_fixture: Path | None
    configured_secrets: frozenset[str]

    @property
    def is_mock(self) -> bool:
        return self.data_source == "mock"


def load_environment(env: dict[str, str] | None = None) -> Environment:
    """Read and validate the process environment."""
    source = dict(os.environ if env is None else env)

    raw_data_source = source.get("NEXT_PUBLIC_DATA_SOURCE", "mock").strip().lower()
    if raw_data_source not in get_args(DataSource):
        raise ConfigError(
            f"NEXT_PUBLIC_DATA_SOURCE must be 'mock' or 'live', got '{raw_data_source}'"
        )
    data_source = cast(DataSource, raw_data_source)

    fixture_raw = source.get("TASTE_INBOX_HOST_PROFILE_FIXTURE", "").strip()
    fixture = Path(fixture_raw) if fixture_raw else None
    if fixture is not None and not fixture.is_file():
        raise ConfigError(f"TASTE_INBOX_HOST_PROFILE_FIXTURE does not point at a file: {fixture}")

    configured = frozenset(key for key in SECRET_ENV_KEYS if source.get(key, "").strip())

    if data_source == "live" and not configured:
        raise ConfigError(
            "NEXT_PUBLIC_DATA_SOURCE=live requires at least one configured credential. "
            f"Set one of: {', '.join(SECRET_ENV_KEYS)}"
        )

    return Environment(
        app_env=source.get("APP_ENV", "development"),
        app_timezone=source.get("APP_TIMEZONE", "Asia/Seoul"),
        data_source=data_source,
        database_url=source.get("DATABASE_URL", "sqlite:///./var/data/taste-inbox.db"),
        host_profile_fixture=fixture,
        configured_secrets=configured,
    )


def _load_yaml_document[TDocument: BaseModel](path: Path, document: type[TDocument]) -> TDocument:
    if not path.is_file():
        raise ConfigError(f"Configuration file not found: {path}")
    try:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        raise ConfigError(f"{path.name} is not valid YAML: {error}") from error
    if not isinstance(raw, dict):
        raise ConfigError(f"{path.name} must contain a mapping at the top level")
    try:
        return document.model_validate(raw)
    except ValidationError as error:
        raise ConfigError(f"{path.name} failed validation:\n{error}") from error


def _resolve(path: Path | None, env_key: str, default_name: str, example_name: str) -> Path:
    """Pick the config file: explicit argument, then env var, then file, then example.

    Falling back to the committed `*.example.yaml` is what lets a clean checkout boot
    without any local configuration.
    """
    if path is not None:
        return path
    from_env = os.environ.get(env_key, "").strip()
    if from_env:
        return Path(from_env)
    local = CONFIG_DIR / default_name
    return local if local.is_file() else CONFIG_DIR / example_name


def load_resource_policy_document(path: Path | None = None) -> ResourcePolicyDocument:
    return _load_yaml_document(
        _resolve(
            path,
            "TASTE_INBOX_RESOURCE_POLICY_CONFIG",
            "resource-policy.yaml",
            "resource-policy.example.yaml",
        ),
        ResourcePolicyDocument,
    )


def load_app_document(path: Path | None = None) -> AppDocument:
    return _load_yaml_document(
        _resolve(path, "TASTE_INBOX_APP_CONFIG", "app.yaml", "app.example.yaml"),
        AppDocument,
    )
