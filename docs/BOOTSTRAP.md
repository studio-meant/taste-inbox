# Taste Inbox — Bootstrap

> **Document role:** clean checkout → running application, and the verification that
> proves it worked.
> **Version:** 1.0 (Phase 0)
> **Last updated:** 2026-08-08

Phase 0 exit criteria:

```text
clean checkout
→ documented bootstrap
→ lint + typecheck + tests pass
→ no secrets required for mock mode
```

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| macOS on Apple Silicon | any supported | The product is a local 24/7 hub for this host |
| Node.js | 22 LTS or newer (`.nvmrc`) | Next.js App Router |
| pnpm | 10 or newer | Workspace management |
| Python | 3.12 or newer | Local service, host detection, resource policy |
| uv | any recent | Python environment and task runner |

```bash
brew install node pnpm python@3.12 uv
```

The frontend and shared packages build on any platform. Live host detection only runs on
Apple Silicon macOS; everywhere else — including CI — the suite uses sanitized fixtures
and skips the live test.

## 2. Install

```bash
pnpm install
cd apps/api && uv sync --python 3.12 && cd ../..
```

**No `.env` file is required.** Mock mode is the default and needs no credential of any
kind. `.env.example` documents what live mode will need from Phase 2 onward; copy it only
when you get there.

## 3. Run

```bash
pnpm --filter @taste-inbox/web dev      # http://127.0.0.1:4173
```

Phase 0 serves a foundation page: resolved host profile, derived resource limits, mock
repository contents, and all seven themes. Phase 1 replaces it with
Splash → Greeting → Today.

## 4. Verify

One command runs everything CI runs:

```bash
pnpm verify:all
```

Or individually:

| Command | Checks |
|---|---|
| `pnpm format` | Prettier, production tree only |
| `pnpm lint` | ESLint with type-aware rules |
| `pnpm typecheck` | `tsc --noEmit` in every workspace package |
| `pnpm test` | Vitest across `packages/*` and `apps/web` |
| `pnpm build` | Next.js production build |
| `pnpm api:lint` | Ruff check and format |
| `pnpm api:typecheck` | mypy, strict |
| `pnpm api:test` | pytest |
| `pnpm verify` | Repository invariants (see §6) |

Expected on a clean checkout:

```text
pnpm test        8 files · 174 tests passed
pnpm api:test    84 passed  (85 on Apple Silicon: live host detection also runs)
pnpm verify      All repository checks passed.
```

## 5. Inspecting the runtime host

The adaptive resource policy is easiest to understand by running it:

```bash
cd apps/api
uv run python -c "
from datetime import UTC, datetime
from taste_inbox.config.loader import load_resource_policy_document
from taste_inbox.host.detector import MacOSHostProfileDetector
from taste_inbox.host.policy import resolve_resource_policy

profile = MacOSHostProfileDetector().detect()
policy = resolve_resource_policy(
    profile, load_resource_policy_document().resource_policy, datetime.now(UTC)
)
print(profile.model_dump_json(indent=2, by_alias=True))
print(policy.model_dump_json(indent=2, by_alias=True))
"
```

Every number is derived from what was just detected — see `config/resource-policy.example.yaml`
for the shape and `apps/api/tests/test_policy_goldens.py` for the cases both languages agree on.

To exercise a host you do not own, point the detector at a fixture:

```bash
uv run pytest tests/test_resource_policy.py -v
```

## 6. Repository invariants

`scripts/verify-repo.sh` enforces what linters and type checkers cannot:

- no credential-shaped strings, and no session, key or database artefact tracked by git
- no specific Mac model named anywhere
- the shipped config pins no device profile
- the detector actually reads memory, storage and pressure from the host
- six themes, default `meadow-cream`, storage key `…-v4`
- the example execution policy still denies host mount, SSH forwarding and privilege
- production code does not import from `prototype/`

`scripts/verify-handoff.sh` separately validates the original handoff package.

## 7. Repository layout

```text
apps/
  web/                 Next.js App Router frontend
  api/                 Local service: host detection, resource policy, migrations
packages/
  shared/              Domain types and runtime schemas, shared with the backend
  ui/                  Design tokens, theme registry, structural stylesheets
data/
  fixtures/            Sanitized fixtures — the cross-language contract
config/                Example runtime, collector and resource policies
scripts/               Verification
docs/                  Specifications; source-of-truth order is in CLAUDE.md §3
prototype/             Visual and interaction reference. Not production code.
reference/             Captured UI, palette and motion
```

`prototype/` is deliberately excluded from linting, formatting, and the production
TypeScript project. It is read, not extended.

## 8. What Phase 0 deliberately does not do

None of the following exists yet, and none of it should be added without working through
the phases:

- any collector, browser profile, or real account access
- the FastAPI application and HTTP endpoints (Phase 2)
- database schema — migration tooling is in place, the revision history is empty
- enrichment, external LLM calls, or the sandbox runner
- launchd services and notifications

Setting `NEXT_PUBLIC_DATA_SOURCE=live` fails today with a message pointing at Phase 2.
That is intentional: it is better to fail loudly than to silently render nothing.
