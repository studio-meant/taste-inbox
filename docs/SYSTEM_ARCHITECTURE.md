# Taste Inbox — Local System Architecture

> **Superseded in part — 2026-08-09.** Every passage below describing execution — running
> a collected repository, preparing an environment, compatibility verdicts, memory and disk
> estimates, `바로 실행` — describes a feature that has been removed. `CLAUDE.md` §3 ranks
> `docs/DECISIONS.md` above this document, and the entry
> "코드 실행 기능을 제품에서 제거" is the current answer. The rest of this document still
> holds.

## Target topology

```text
Supported Apple Silicon Mac
(runtime hardware profile auto-detected)
│
├─ Host Profile Detector
│  ├─ model / chip / architecture
│  ├─ unified memory
│  ├─ total / free storage
│  └─ memory pressure
│
├─ Resource Policy Resolver
│  └─ memory / disk / cache / concurrency limits
│
├─ launchd
│  ├─ morning collectors
│  ├─ enrichment jobs
│  ├─ evening brief
│  └─ service restart
│
├─ Desktop application
│  ├─ Tauri 2 static WebView (shared React/Next page sources)
│  ├─ restricted request/response stdio bridge
│  └─ FastAPI handler layer (in-process, no HTTP listener)
│
├─ Web development target
│  ├─ Next.js frontend
│  └─ FastAPI backend
│
├─ Collectors
│  ├─ GitHub Star API
│  ├─ Threads Browser Collector
│  ├─ Instagram Likes Browser Collector [disabled: no permalinks, no captions]
│  ├─ Instagram Saved Browser Collector — one entry per user-designated collection
│  │  ├─ ai      → AI Tech
│  │  ├─ music   → Music
│  │  └─ fashion → Style
│  └─ LinkedIn Reactions Browser Collector [experimental]
│
├─ Storage
│  ├─ SQLite
│  ├─ local media cache
│  └─ isolated browser profiles
│
├─ Enrichers
│  ├─ AI Tech Enricher
│  └─ Fashion Enricher
│
└─ Sandbox Runner
   ├─ uv / isolated Python environment
   ├─ arm64 container
   ├─ MLX / llama.cpp adapters
   └─ resource and credential boundaries
```

## Pipeline

```text
Collect
→ Raw event
→ Normalize and canonicalize
→ Deduplicate
→ Classify
→ Enrich
→ Prepare action
→ Surface in dashboard
→ Notify
```

## Suggested repository boundary

```text
apps/
  desktop/             # Tauri 2 production shell and static router
  web/                 # Next.js
  api/                 # FastAPI
packages/
  ui/                  # tokens and reusable UI
  shared/              # shared schemas/types
services/
  collectors/
  enrichers/
  runner/
  notifier/
data/
  fixtures/            # sanitized fixtures only
config/
  collectors.yaml
  resource-policy.yaml
scripts/
  launchd/
```

This layout is a production target. The included `prototype/` is a visual reference and must remain isolated from production code.

## Core persistence entities

- `source_accounts`
- `collector_runs`
- `raw_events`
- `items`
- `item_sources`
- `media_assets`
- `classifications`
- `ai_analyses`
- `style_analyses`
- `evidence`
- `prepared_actions`
- `jobs`
- `checkpoints`
- `settings`

Exact schemas should follow the type and API contracts in the frontend architecture document and be introduced through migrations.

## Process separation

- Browser collectors do not call LLMs and do not execute external code.
- Enrichers read normalized items and write structured results.
- Runner accepts only validated manifests, never raw web text as commands.
- UI reads application APIs through the desktop IPC repository; it never reads browser profiles or filesystem secrets.
- The packaged desktop does not bind a loopback HTTP port. The stdio bridge accepts only
  `GET`/`PATCH` requests under `/api/` and returns local media only from `var/media`.
- Notification failures do not roll back collection or enrichment.
- Runtime resource limits are resolved from the current Host Profile and are not tied to a specific Mac model.


## Runtime hardware adaptation

At service startup, build a `HostProfile` from macOS system information and current pressure signals. The resource-policy resolver uses that profile to calculate effective memory, disk, cache, and concurrency limits.

```text
HostProfile
├─ device model and chip
├─ architecture
├─ unified memory
├─ total and free storage
└─ memory pressure
        ↓
Adaptive Resource Policy
├─ OS/service headroom
├─ auto-prepare and manual-review budgets
├─ cache budgets
└─ heavy-job concurrency
```

Manual configuration may reduce the computed limits for quieter operation. It must not increase them beyond the resolver's safe capacity.
