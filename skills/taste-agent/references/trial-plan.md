# TrialPlan

What the sandbox agent is asked to do — `apps/api/src/taste_inbox/action/proposal.py`.

## Shape

| Field | Meaning |
| --- | --- |
| `planText` | the instruction handed to the agent. **Prose.** |
| `successCriteria` | stated before the run, so the result is a comparison |
| `requiredHosts` | hosts the plan needs, filtered to what a trial may have |
| `refusedHosts` | hosts the report named that are **not** opened |
| `commandsSeen` | fenced blocks, for display — not for execution |

## Why the plan stays prose

The thing on the other side is an agent, not a shell. It reads the intent, finds the real
entry point, and adapts when the documented command is wrong — which it often is.
Extracting a rigid script throws away the capability that makes `Try safely` more than a
`Makefile`, and fails on exactly the repositories where a human would also have improvised.

Measured: a report proposed `docker run …` as its fastest path. There is no Docker inside
the sandbox. An agent works around that by falling back to the source install; a script
would simply have failed.

## The report is untrusted input

A research report is web-derived text. It may name any host it likes. Only hosts in
`ALLOWED_TRIAL_HOSTS` are opened; everything else becomes `refusedHosts` and is **shown to
the user**. A document cannot widen the boundary by mentioning a domain.

Observed on a real run: the report named `voicestudio.sh`, `www.remio.ai`, `tessl.io` and
`hoangyell.com`. None was opened.

## Egress is endpoint × binary

Measured, not assumed (`docs/FEASIBILITY.md`, F4): `curl` could not reach `huggingface.co`
although the host is allowed, because curl is not in that policy's binary list. Opening a
host does not open it to every tool.

`config/nemoclaw/taste-inbox-trial.yaml` declares both. Applying it is a person's job:

```bash
nemoclaw <sandbox> policy add github --yes
nemoclaw <sandbox> policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --dry-run
nemoclaw <sandbox> policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --yes
```

## Never

- request a host mount
- ask for a credential value (name the environment variable instead)
- offer `Try safely` when `actionable` is false
