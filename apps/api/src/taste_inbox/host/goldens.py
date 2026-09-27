"""Regenerate the committed resource-policy expectations.

    uv run python -m taste_inbox.host.goldens

Run this only after an *intentional* resolver change. The hand-derived assertions in
`tests/test_resource_policy.py` must then be re-derived from
docs/RESOURCE_POLICY_RESOLUTION.md — regenerating goldens alone proves nothing, since
they are produced by the very code under test.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from taste_inbox.config.loader import load_resource_policy_document
from taste_inbox.host.detector import FixtureHostProfileDetector
from taste_inbox.host.policy import resolve_resource_policy
from taste_inbox.paths import HOST_PROFILE_FIXTURES_DIR, RESOURCE_POLICY_FIXTURES_DIR

#: Fixed instant, so regeneration is reproducible. Mirrors `tests/helpers.py`.
RESOLVED_AT = datetime(2026, 8, 8, 7, 0, 0, tzinfo=UTC)


def main() -> None:
    config = load_resource_policy_document().resource_policy
    output_dir = RESOURCE_POLICY_FIXTURES_DIR / "expected"
    output_dir.mkdir(parents=True, exist_ok=True)

    for path in sorted(HOST_PROFILE_FIXTURES_DIR.glob("*.json")):
        profile = FixtureHostProfileDetector(path).detect()
        policy = resolve_resource_policy(profile, config, RESOLVED_AT)
        payload = json.dumps(
            policy.model_dump(mode="json", by_alias=True), indent=2, ensure_ascii=False
        )
        (output_dir / path.name).write_text(payload + "\n", encoding="utf-8")
        print(f"wrote {path.name}")


if __name__ == "__main__":
    main()
