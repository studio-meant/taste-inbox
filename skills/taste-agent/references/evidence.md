# Results → Evidence

One rule decides the column: **who said it.**

| Who                           | `provenance`  | Written by                  |
| ----------------------------- | ------------- | --------------------------- |
| The Hub stated it             | `huggingface` | the collector, at read time |
| AI-Q research found it        | `aiq`         | `research/runner.py`        |
| The sandbox observed it       | `sandbox`     | `sandbox/trial.py`          |
| The network policy refused it | `policy`      | `sandbox/trial.py`          |
| This product observed it      | `fact`        | inherited                   |
| This product concluded it     | `inference`   | inherited                   |
| Someone else concluded it     | `external`    | inherited                   |

The first three inherited values say what _kind_ of claim a row is. The four added on
2026-09-28 say _who made it_, because the screens now carry claims from three different
machines and a reader has to be able to tell a sandbox observation from a research citation.

## Types

| Type                                                  | Provenance    | Note                                                              |
| ----------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `paper.github_repo`                                   | `huggingface` | `confidence 1.0` = a person linked it; `0.9` = the Hub matched it |
| `paper.project_page` `paper.linked_*` `paper.total_*` | `huggingface` | the bundle                                                        |
| `research.brief`                                      | `aiq`         | **what left the machine**, stored so it can be reviewed           |
| `research.report`                                     | `aiq`         | verbatim, citations intact                                        |
| `research.suggestion`                                 | `aiq`         | one line                                                          |
| `trial.result`                                        | `sandbox`     | exit code, tool calls, failures, stop reason                      |
| `trial.transcript`                                    | `sandbox`     | what the agent reported                                           |
| `trial.blocked_endpoint`                              | `policy`      | **a finding, not a log line**                                     |
| `trial.artifact`                                      | `sandbox`     | what the run left behind                                          |

## Rules

1. **A claim with no `source_url` is not evidence.** Exceptions are rows whose source is
   the run itself (`trial.*`), where the run id is the provenance.
2. **Replace, do not accumulate.** The card shows _the_ research; three superseded reports
   stacked under one item is a worse answer than the current one.
3. **A `policy` row is shown, not swallowed.** _The repository you starred tried to reach
   this host while installing_ — nothing but the sandbox could have observed that, and it
   is the most product-specific thing this stack produces.
