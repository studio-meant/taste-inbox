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

`resource-policy/expected/` is the cross-language contract: `apps/api` asserts its
resolver reproduces each file exactly, and `packages/shared` asserts each file validates
against `EffectiveResourcePolicySchema`. Neither language can drift without the other
failing. Regenerate with `uv run python -m taste_inbox.host.goldens` after an intentional
resolver change — never by hand.

Collector response fixtures (Phase 3+) will be added under `collectors/` and must follow
the same rules.
