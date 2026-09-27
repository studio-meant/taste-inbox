# Fixture policy

Fixtures in this tree are the only sample data allowed in version control.

## Rules

1. **Sanitized only.** No real account handles, cookies, tokens, serial numbers,
   hardware UUIDs, personal filesystem paths, private post text, or private media.
2. **No live capture.** Fixtures are hand-authored or derived from a capture that was
   reviewed and scrubbed by a human. CI never contacts a real social account
   (`CLAUDE.md` §9, `docs/SECURITY_BOUNDARIES.md`).
3. **No device identity.** Host fixtures describe a *capacity class*, never a specific
   Mac model. Filenames and `deviceModel` values are deliberately synthetic so that no
   fixed hardware assumption can leak into product code
   (`docs/DECISIONS.md` → Host, `docs/SYSTEM_ARCHITECTURE.md` → Runtime hardware adaptation).
4. **Contract-bound.** Every fixture must validate against its schema in
   `packages/shared`. `pnpm --filter @taste-inbox/shared test` enforces this, and
   `apps/api` loads the same files, so TypeScript and Python cannot drift apart.
5. **Additive.** Editing a fixture changes the meaning of existing tests. Prefer adding
   a new file for a new scenario.

## Trees

| Path | Contents | Consumers |
|---|---|---|
| `host-profiles/` | Runtime hardware profiles by capacity class | `packages/shared`, `apps/api` |
| `resource-policy/expected/` | Resolved policy for each host profile | `packages/shared`, `apps/api` |
| `research/` | NVIDIA AI-Q reports, recorded verbatim from a real run | `apps/api` |
| `collectors/` | GitHub and Hugging Face API responses, recorded once from public endpoints | `services/collectors` |
| `focus/` | Focus and Working Queue payloads the API writes from its real endpoints | `apps/api`, `packages/shared`, `apps/web` |
| `sandbox/` | `nemoclaw <sandbox> status` output and `openclaw agent --json` envelopes, recorded | `apps/api` |

`resource-policy/expected/` is the cross-language contract: `apps/api` asserts its
resolver reproduces each file exactly, and `packages/shared` asserts each file validates
against `EffectiveResourcePolicySchema`. Neither language can drift without the other
failing. Regenerate with `uv run python -m taste_inbox.host.goldens` after an intentional
resolver change — never by hand.

## Collector responses (2026-09-28)

Recorded once, unauthenticated, from public endpoints; CI replays them and never reaches the
network (`services/collectors/tests/transport.py`).

| File | Endpoint | Scrubbed |
|---|---|---|
| `collectors/github/starred-page.json` | `GET /users/octocat/starred?per_page=3`, `Accept: application/vnd.github.star+json` | nothing — `octocat` is GitHub's own demo account |
| `collectors/huggingface/likes-page.json` | `GET /api/users/<public account>/likes` | the account is not stored; six entries kept, one per kind plus an unknown `kernel` |
| `collectors/huggingface/{model,dataset,space}-*.json` | `GET /api/{models,datasets,spaces}/<name>` for exactly those likes | trimmed to the fields the parser reads (`id`, `author`, `tags`, `pipeline_tag`, `description`, `createdAt`) |
| `collectors/huggingface/paper-*.json` | `GET /api/papers/<arXiv id>` — the two those likes cite, and DeepSeek-R1 for the `auto` repo case | `authors`, `submittedOnDailyBy`, `discussionId` removed (people's handles; unused) |

Recorded facts the tests rely on: `githubRepoAddedBy` is `"user"` on 2602.15763 and `"auto"` on
2501.12948 — not a person's name, which is why the bundle says "linked by a person" and not
"by the author".

## Recorded NVIDIA runtime output (2026-09-28)

`CLAUDE.md` §9: tests that touch the NVIDIA runtime run on **recorded** output, never live.
These files are real output, kept byte-for-byte except for the scrubbing listed here, because
the parsers exist to survive the runtime's actual phrasing — a hand-written sample would only
test that the parser reads what its author imagined.

| File | Recorded from | Scrubbed |
|---|---|---|
| `research/voicestudio-shallow-report.md` | AI-Q `shallow_researcher`, job `568c6ddf…`, about the public repo `debpalash/VoiceStudio` | nothing. The inline URLs that look cut (`curl -fsSL \| sh`) were already missing in AI-Q's own job output; see `docs/FEASIBILITY.md` |
| `sandbox/status-docker-down.txt` | `nemoclaw taste-inbox status` with the `docker` CLI unreachable | sandbox id and create-attempt label replaced |
| `sandbox/status-ready.txt` | the same, with Docker reachable — includes a retried inference 503 line | sandbox id and create-attempt label replaced |
| `sandbox/logs-trial-uv-denied.txt` | `nemoclaw taste-inbox logs` for the second Golden Path trial's window: OCSF `NET:OPEN` lines, eight of them `DENIED` (`uv` → releases.astral.sh, github.com) | none — the lines carry sandbox paths and public hosts only; checked for key/token shapes |

**Needs a human review before any public push:** the research report's table repeats the
brief's aggregate topic counts (e.g. `claude-code (26 saves)`). They are summaries, not
items, and no handle appears — but rule 1 asks for a person to have looked.
