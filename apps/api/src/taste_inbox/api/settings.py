"""Every configured value, and which of the three layers it came from.

This is the only endpoint whose subject is the configuration itself rather than what the
configuration produced, and it exists to answer one question: **where did this number come
from?** Every value arrives wrapped: `origin` names the layer, `effect` says when a change
would start being true, and `editable` decides whether the UI may draw a control at all.

**Three layers, resolved in this order.** A row in the `settings` table wins; otherwise
whatever the effective YAML says; otherwise the field default in `config/schema.py`.
Telling the last two apart needs the *raw* mapping and not the validated document: an
`AppDocument` cannot distinguish "the file said 4" from "the file was silent and the
default is 4", and that difference is the whole question this screen answers.
`general.ceremonialEntry` reports `default` on a fresh checkout on purpose: that value's
home is this screen, and a line in the example would make every fresh checkout report
somebody's file edit for a choice nobody has made yet.

**`origin: "file"` is not "somebody changed this".** There is no `config/app.yaml` on a
fresh checkout — `.gitignore` ignores `config/*.yaml` — so `config/loader.py` falls through
to the committed `app.example.yaml`. That is the shipped value living in a file rather than
in a field default, and the Korean copy on the screen has to say so.

**Five keys have a reader, and those five are editable.** Four resolve through
`schedule.effective_document(session)`, which is what carries a stored override into
`/api/collection/schedule`, the in-app scheduler, the generated launchd plists, the manual
refresh gate and the day boundary on Today. The fifth, `general.ceremonialEntry`, is read
off this endpoint's own payload by the web app's startup route. The other three —
`appearance.*` and `general.locale` — are shown read-only: the theme is resolved by the web
app's own bootstrap, and nothing reads the locale.

The feature flags that described collectors this product never built, the debug-retention
value only a browser collector read, and the per-source switches that stopped nothing were
removed on 2026-09-28 (docs/DECISIONS.md).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, get_args
from zoneinfo import available_timezones

import yaml
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

# `_resolve` rather than a second copy of the four-step fallback (explicit path, then
# `TASTE_INBOX_APP_CONFIG`, then `config/app.yaml`, then the committed example). Resolving
# once here and passing the path to `load_app_document` also guarantees the raw mapping and
# the validated document describe the same file, which two independent calls would not.
from ..config.loader import ConfigError, _resolve, load_app_document
from ..config.schema import (
    STAGGERED_SOURCES,
    THEME_IDS_PATH,
    AppDocument,
    AppSection,
    CollectionSection,
)
from ..db.models import Setting
from .app import ApiError
from .cards import generated_at

#: Which top-level key of `config/app.yaml` each pydantic section validates.
SECTION_MODELS: dict[str, type[BaseModel]] = {
    "app": AppSection,
    "collection": CollectionSection,
}


@dataclass(frozen=True, slots=True)
class _Leaf:
    """One settable value: where it lives in the file, and where it renders in the payload.

    `group`/`name` are the camelCase document path and therefore the dotted patch key;
    `section`/`field` are the snake_case pydantic path. The two differ deliberately —
    `general.timezone` renders under a heading the user thinks in while the value lives on
    `app.timezone`, and pretending they are the same name would force either the config
    file or the screen to be organised for the other one's convenience.
    """

    group: str
    name: str
    section: str
    field: str
    kind: str
    effect: str

    @property
    def key(self) -> str:
        return f"{self.group}.{self.name}"


#: The settable leaves, in the order the document renders them.
#:
#: Matches `SETTING_KEYS` in `packages/shared/src/domain/settings.ts` exactly; a leaf added
#: here without a key there is a value the frontend will refuse the whole payload over, so
#: `tests/test_settings.py` asserts the two lists rather than trusting them.
#:
#: The fields of `AppDocument` that are *not* here are absent on purpose: `data_dir` is a
#: path nothing reads, and both `briefing` times describe notifications that have no
#: delivery mechanism at all. Showing a path or a time the product ignores would be the same
#: lie in a read-only coat.
LEAVES: tuple[_Leaf, ...] = (
    # The only section whose values reach running code — through the YAML, not through the
    # override table. `nextInstall` is the honest half of a value with two clocks: the
    # schedule *display* recomputes per request because nothing caches the document, while
    # a loaded launchd job keeps the `StartInterval` baked into its plist until somebody
    # runs the printed `bootout`/`bootstrap` pair by hand (`api/launchd.py:11-30`).
    # `nextRun` since 2026-09-28: the in-app scheduler (`app._scheduler_loop`) reads this
    # every minute, so a changed interval applies from the next collection. A launchd job
    # installed earlier still holds its own copy until reinstalled; the System panel says so.
    _Leaf("collection", "intervalHours", "collection", "interval_hours", "number", "nextRun"),
    _Leaf("collection", "staggerMinutes", "collection", "stagger_minutes", "number", "nextInstall"),
    _Leaf(
        "collection",
        "allowManualRefresh",
        "collection",
        "allow_manual_refresh",
        "boolean",
        "immediate",
    ),
    # Read by nothing. The web app resolves its theme from `localStorage` falling back to
    # `packages/ui/theme-ids.json`, and its motion from `DEFAULT_MOTION_MODE` in
    # `components/theme/theme-bootstrap.ts:29` — never from this API. `immediate` is what
    # the contract specifies and it is not true of either field; the effect union has no
    # member for "nothing reads this", so `editable: false` carries that fact instead.
    _Leaf("appearance", "defaultTheme", "app", "default_theme", "choice", "immediate"),
    _Leaf("appearance", "defaultMotion", "app", "default_motion", "choice", "immediate"),
    # `timezone` is the one genuinely live field in the document: the day boundary on Today
    # and the slot boundary on the schedule are this single value, recomputed per request.
    _Leaf("general", "timezone", "app", "timezone", "text", "immediate"),
    _Leaf("general", "locale", "app", "locale", "text", "immediate"),
    # Which screens the app opens with, `PAGE_SPECIFICATIONS.md` §11.1: full (Splash →
    # Greeting → Today), brief (Greeting → Today), skip (Today). `immediate` because there is
    # no third clock anywhere on this path — no plist holds a copy, no long-running process
    # read it at start, and `config/loader.py` caches nothing — so the next request for this
    # document already carries an override. What that means for a person is the next time
    # they open the app, which is where the field's copy puts it.
    _Leaf("general", "ceremonialEntry", "app", "ceremonial_entry", "choice", "immediate"),
)

LEAF_BY_KEY: dict[str, _Leaf] = {leaf.key: leaf for leaf in LEAVES}
LEAF_BY_FIELD: dict[tuple[str, str], _Leaf] = {(leaf.section, leaf.field): leaf for leaf in LEAVES}

#: Which keys the UI may draw a control for.
#:
#: A key belongs here once an override of it changes something the user can observe
#: somewhere other than this screen — `docs/DECISIONS.md` settled the same shape for
#: filters on 2026-08-09: a control over a field nothing reads is a control that does
#: nothing.
#:
#: Four of these five earn it the same way. `schedule.describe()`, `launchd.generate()`, the
#: manual-refresh gate and `configured_zone()` all resolve through
#: `schedule.effective_document(session)`, so an override reaches `/api/collection/schedule`,
#: the generated plists, the Refresh button and the day boundary on Today. Before that they
#: each read the file directly, and a slider here would have moved a number nothing else
#: agreed with.
#:
#: `general.ceremonialEntry` earns it through the other half of the same path: the web app's
#: startup route reads `GET /api/settings`, which is `build_document` over
#: `resolve_effective`, and sends the user through Splash → Greeting → Today, Greeting →
#: Today, or straight to Today according to what it finds. That is not the contradiction
#: `appearance.defaultTheme` would be. The theme has a *competing* resolver — the web app's
#: `theme-bootstrap.ts` reads `localStorage` and never asks this service — so an override of
#: it moves nothing; the entry sequence has no second source to disagree with.
#:
#: The other three stay out, and not as a placeholder. `appearance.*` is read by the theme
#: bootstrap in the web app rather than by this service, and nothing reads the locale. Each
#: needs its own reader before it can move.
EDITABLE: frozenset[str] = frozenset(
    {
        "collection.intervalHours",
        "collection.staggerMinutes",
        "collection.allowManualRefresh",
        "general.timezone",
        "general.ceremonialEntry",
    }
)

# ------------------------------------------------------------------ effective value


@dataclass(frozen=True, slots=True)
class EffectiveConfig:
    """The three layers, already collapsed, plus what is needed to say which was which."""

    path: Path
    #: The file's own mapping. `file in raw[section]` is the only way to separate a value
    #: the YAML states from a value the schema defaulted, since both arrive identical on
    #: the validated document.
    raw: dict[str, Any]
    file_document: AppDocument
    document: AppDocument
    #: Dotted keys whose stored override actually survived validation and is in `document`.
    applied: frozenset[str]


def _config_path(path: Path | None) -> Path:
    if path is not None:
        return path
    return _resolve(None, "TASTE_INBOX_APP_CONFIG", "app.yaml", "app.example.yaml")


def _raw_mapping(path: Path) -> dict[str, Any]:
    loaded: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded if isinstance(loaded, dict) else {}


def _stored(session: Session) -> dict[str, Any]:
    """Every override this screen wrote, keyed by dotted path.

    A row whose key is not a leaf is skipped rather than reported: account names and the
    profile live in the same table (`api/accounts.py`, `api/profile.py`), and a key left
    behind by an older version of this screen must not become an unlabelled value on it. A
    row whose JSON no longer parses is skipped for the same reason it is not raised on — a
    corrupt override that took the settings screen down would be a corrupt override nobody
    could remove.
    """
    values: dict[str, Any] = {}
    for row in session.scalars(select(Setting).order_by(Setting.key)):
        if row.key not in LEAF_BY_KEY:
            continue
        try:
            values[row.key] = json.loads(row.value)
        except json.JSONDecodeError:
            continue
    return values


def _overlay(file_document: AppDocument, stored: dict[str, Any]) -> tuple[AppDocument, set[str]]:
    """Apply the overrides one at a time, dropping any the file has outgrown.

    Not a batch: a stored value can stop validating without anybody touching it. An override
    of `stagger_minutes: 30` is legal against the shipped four-hour interval (30 x 5 = 150
    minutes fits inside 240) and illegal the moment the file drops the interval to one hour
    (150 >= 60). Validating the batch would take the whole screen down over one stale row;
    trusting it would print a pair `config/loader.py` refuses to load. Dropping the offending
    override alone leaves every other one effective and makes that value report the layer it
    genuinely comes from.
    """
    candidate = file_document.model_dump()
    document = file_document
    applied: set[str] = set()
    for leaf in LEAVES:
        if leaf.key not in stored:
            continue
        section = candidate[leaf.section]
        previous = section[leaf.field]
        section[leaf.field] = stored[leaf.key]
        try:
            document = AppDocument.model_validate(candidate)
        except ValidationError:
            section[leaf.field] = previous
            continue
        applied.add(leaf.key)
    return document, applied


def resolve_effective(session: Session, *, path: Path | None = None) -> EffectiveConfig:
    chosen = _config_path(path)
    try:
        file_document = load_app_document(chosen)
    except ConfigError as error:
        # `ConfigError` is a plain `RuntimeError` (`config/loader.py:37`), so without this
        # it reaches the catch-all handler as an opaque 500 whose entire body is the string
        # "ConfigError" — on the one screen whose job is to explain the configuration.
        raise ApiError(
            500,
            "config_invalid",
            "설정 파일을 읽을 수 없어요. 파일을 고친 뒤 다시 시도해 주세요.",
            recoverable=False,
        ) from error
    document, applied = _overlay(file_document, _stored(session))
    return EffectiveConfig(
        path=chosen,
        raw=_raw_mapping(chosen),
        file_document=file_document,
        document=document,
        applied=frozenset(applied),
    )


def effective_app_document(session: Session, *, path: Path | None = None) -> AppDocument:
    """The configuration with this screen's overrides applied.

    The function `api/schedule.py`, `api/launchd.py` and the manual-refresh gate would call
    instead of `load_app_document()` to make an override mean anything. Nothing calls it
    yet, which is exactly what `EDITABLE` records.
    """
    return resolve_effective(session, path=path).document


# ------------------------------------------------------------------------- bounds


def _ceil_div(value: int, divisor: int) -> int:
    return -(-value // divisor)


def _static_bounds(leaf: _Leaf) -> tuple[int, int]:
    """The `ge`/`le` pydantic already enforces, read off the model rather than restated.

    Duck-typed on the constraint objects instead of importing `annotated_types`, which is
    pydantic's dependency and not this package's.
    """
    low = 0
    high = 0
    for constraint in SECTION_MODELS[leaf.section].model_fields[leaf.field].metadata:
        floor = getattr(constraint, "ge", None)
        ceiling = getattr(constraint, "le", None)
        if floor is not None:
            low = int(floor)
        if ceiling is not None:
            high = int(ceiling)
    return low, high


def _bounds(leaf: _Leaf, collection: CollectionSection) -> tuple[int, int]:
    """The bounds a control may actually move between, including the coupled pair.

    `CollectionSection._stagger_must_fit_inside_one_interval` rejects
    `stagger x (STAGGERED_SOURCES - 1) >= interval x 60`, so the two numbers are one
    constraint wearing two sliders. Sending the static 0-60 for the stagger would let the
    UI compose `interval=1, stagger=15` — both halves inside their own declared range — and
    earn a 422 for it. The derived ceiling is 47 minutes at the shipped four-hour interval
    and 11 at a one-hour interval, so the control physically cannot build an invalid pair.
    The interval's floor moves the same way for the same reason.
    """
    low, high = _static_bounds(leaf)
    others = STAGGERED_SOURCES - 1
    if others <= 0:
        return low, high
    if leaf.key == "collection.intervalHours":
        low = max(low, collection.stagger_minutes * others // 60 + 1)
    elif leaf.key == "collection.staggerMinutes":
        high = min(high, _ceil_div(collection.interval_hours * 60, others) - 1)
    # `max` because the frontend refines on `min <= value <= max` and would refuse the whole
    # payload over an inverted pair, which is a worse failure than a range of one.
    return low, max(low, high)


def _options(leaf: _Leaf) -> list[str]:
    """The closed list the backend will accept, taken from whoever owns it.

    Theme ids come from `packages/ui/theme-ids.json` in its documented order rather than
    from `config/schema.py::_theme_identity()`, which memoises them into a `frozenset` and
    loses that order — a picker whose seven entries reshuffle between requests is a picker
    nobody can point at.
    """
    if leaf.key == "appearance.defaultTheme":
        payload = json.loads(THEME_IDS_PATH.read_text(encoding="utf-8"))
        return [str(theme) for theme in payload["themeIds"]]
    annotation = SECTION_MODELS[leaf.section].model_fields[leaf.field].annotation
    return [str(option) for option in get_args(annotation)]


# ------------------------------------------------------------------------ document


def _origin(config: EffectiveConfig, leaf: _Leaf) -> str:
    if leaf.key in config.applied:
        return "user"
    section = config.raw.get(leaf.section)
    if isinstance(section, dict) and leaf.field in section:
        return "file"
    return "default"


def _setting(config: EffectiveConfig, leaf: _Leaf) -> dict[str, Any]:
    value = getattr(getattr(config.document, leaf.section), leaf.field)
    setting: dict[str, Any] = {
        "value": value,
        "origin": _origin(config, leaf),
        "effect": leaf.effect,
        "editable": leaf.key in EDITABLE,
    }
    if leaf.kind == "number":
        low, high = _bounds(leaf, config.document.collection)
        setting["min"] = low
        setting["max"] = high
    elif leaf.kind == "choice":
        setting["options"] = _options(leaf)
    return setting


def build_document(session: Session, *, path: Path | None = None) -> dict[str, Any]:
    config = resolve_effective(session, path=path)
    document: dict[str, Any] = {"generatedAt": generated_at()}
    for leaf in LEAVES:
        document.setdefault(leaf.group, {})[leaf.name] = _setting(config, leaf)
    return document


# --------------------------------------------------------------------------- write


def _read_changes(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("changes"), dict):
        raise ApiError(
            422,
            "setting_rejected",
            "바꿀 값을 changes에 담아 보내주세요.",
            recoverable=True,
        )
    changes: dict[str, Any] = payload["changes"]
    unknown = sorted(key for key in changes if key not in LEAF_BY_KEY)
    if unknown:
        # Named rather than dropped. A silently ignored key looks exactly like a change
        # that had no effect, and the response is the full document either way.
        raise ApiError(
            422,
            "setting_unknown",
            f"'{unknown[0]}' 항목은 설정에 없어요.",
            recoverable=False,
        )
    return changes


def _reject_unknown_timezone(writes: dict[str, Any]) -> None:
    """The one rule pydantic cannot carry, checked before anything is written.

    `AppSection.timezone` is a bare `str` and `api/schedule.py:46-52` answers an unreadable
    zone by falling back to UTC rather than failing, so "Asia/Seuol" is accepted at every
    layer and then silently moves Today's day boundary and every collection slot by nine
    hours — leaving the misspelling on screen as the explanation for a shift nobody asked
    for. This is the only place that can refuse it.
    """
    if "general.timezone" not in writes:
        return
    value = writes["general.timezone"]
    if not isinstance(value, str) or value not in available_timezones():
        raise ApiError(
            422,
            "setting_rejected",
            f"'general.timezone' 값을 저장하지 못했어요. 이 컴퓨터는 '{value}' 시간대를 모릅니다.",
            recoverable=True,
        )


def _coupling_reason(collection: dict[str, Any]) -> str | None:
    """The refused pair, said in Korean, with the ceiling the user can actually use.

    Recomputes the ceiling rather than calling `_bounds`, which needs a validated
    `CollectionSection` — and the whole reason this function is running is that no such
    object could be built from these two numbers.
    """
    others = STAGGERED_SOURCES - 1
    interval = collection.get("interval_hours")
    stagger = collection.get("stagger_minutes")
    if others <= 0 or not isinstance(interval, int) or not isinstance(stagger, int):
        return None
    if stagger * others < interval * 60:
        return None
    ceiling = min(
        _static_bounds(LEAF_BY_KEY["collection.staggerMinutes"])[1],
        _ceil_div(interval * 60, others) - 1,
    )
    return (
        f"소스 간격 {stagger}분은 수집 간격 {interval}시간 안에 들어가지 않아요. "
        f"지금 간격에서는 {ceiling}분까지 둘 수 있어요."
    )


def _reason(leaf: _Leaf, candidate: dict[str, Any]) -> str:
    coupled = _coupling_reason(candidate.get("collection", {}))
    if coupled is not None and leaf.section == "collection":
        return coupled
    if leaf.kind == "number":
        low, high = _static_bounds(leaf)
        return f"{low}에서 {high} 사이의 정수여야 해요."
    if leaf.kind == "choice":
        return f"{' · '.join(_options(leaf))} 중 하나여야 해요."
    return "값의 형식이 올바르지 않아요."


def _rejected(error: ValidationError, candidate: dict[str, Any], changed: list[str]) -> ApiError:
    """Turn a pydantic failure into the offending dotted key and one Korean sentence.

    The pydantic message is English and names snake_case fields, which is the wrong half of
    both languages for a screen: the frontend maps `code` to its own copy and shows
    `message` to a person. The key is in the message because the error envelope
    (`api/app.py:60-71`) carries only `code`, `message` and `recoverable`, and a rejection
    that does not say which value was refused is not actionable.
    """
    first = error.errors()[0]
    location = [str(part) for part in first["loc"]]
    leaf: _Leaf | None = None
    if len(location) >= 2:
        leaf = LEAF_BY_FIELD.get((location[0], location[1]))
    if leaf is None and location:
        # A section-level `model_validator` — the stagger/interval coupling is the only one
        # — reports the section, not a field. The offending key is then whichever of that
        # section's keys this request tried to change.
        leaf = next(
            (LEAF_BY_KEY[key] for key in changed if LEAF_BY_KEY[key].section == location[0]),
            None,
        )
    if leaf is None and changed:
        leaf = LEAF_BY_KEY[changed[0]]
    if leaf is None:
        # Unreachable while the baseline document validates, which it must have done to be
        # read at all. Named anyway: an `IndexError` here would leave the one screen that
        # explains the configuration answering an opaque 500 whose body is "IndexError".
        return ApiError(422, "setting_rejected", "설정 값을 저장하지 못했어요.", recoverable=True)
    return ApiError(
        422,
        "setting_rejected",
        f"'{leaf.key}' 값을 저장하지 못했어요. {_reason(leaf, candidate)}",
        recoverable=True,
    )


def apply_changes(
    session: Session, payload: dict[str, Any] | None, *, path: Path | None = None
) -> dict[str, Any]:
    """Validate a patch through the same models the loader uses, then persist it.

    Through `AppDocument.model_validate`, not through per-field checks, because the
    interval and the stagger are one constraint: a stagger of 60 and an interval of 4 are
    each inside their own bounds and the pair is refused. Field-by-field validation here
    would accept what `config/loader.py` would later reject, which is the failure this
    endpoint exists to prevent rather than reproduce.

    Nothing is written until the whole candidate validates, so a rejected change leaves
    every stored value exactly as it was — including the other keys in the same request.
    """
    changes = _read_changes(payload)
    config = resolve_effective(session, path=path)

    resets = {key for key, value in changes.items() if value is None}
    writes = {key: value for key, value in changes.items() if value is not None}
    _reject_unknown_timezone(writes)

    candidate = config.document.model_dump()
    for key in resets:
        # A reset drops the override, so the candidate has to fall back to what the *file*
        # says — reading it off `config.document` would read the override being removed.
        leaf = LEAF_BY_KEY[key]
        candidate[leaf.section][leaf.field] = getattr(
            getattr(config.file_document, leaf.section), leaf.field
        )
    for key, value in writes.items():
        leaf = LEAF_BY_KEY[key]
        candidate[leaf.section][leaf.field] = value

    try:
        validated = AppDocument.model_validate(candidate)
    except ValidationError as error:
        raise _rejected(error, candidate, sorted(changes)) from error

    stamp = generated_at()
    for key in sorted(resets):
        stale = session.get(Setting, key)
        if stale is not None:
            session.delete(stale)
    for key in sorted(writes):
        leaf = LEAF_BY_KEY[key]
        # The value pydantic produced, not the one the request sent, so the row and the
        # model can never disagree about `6.0` versus `6`.
        stored = json.dumps(getattr(getattr(validated, leaf.section), leaf.field))
        row = session.get(Setting, key)
        if row is None:
            session.add(Setting(key=key, value=stored, updated_at=stamp))
        else:
            row.value = stored
            row.updated_at = stamp
    # `get_session` never commits — every writer in this codebase commits for itself.
    session.commit()

    return build_document(session, path=path)


__all__ = [
    "EDITABLE",
    "LEAVES",
    "apply_changes",
    "build_document",
    "effective_app_document",
]
