# TasteContext

What the user's saved history says about one item. Built from rows, never from a model —
`apps/api/src/taste_inbox/taste/context.py`.

## Shape

| Field                                             | Meaning                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `itemId` `title` `kind` `platform` `canonicalUrl` | the subject                                                              |
| `itemTerms`                                       | the subject's own normalised tags                                        |
| `recurringTerms`                                  | `[{term, itemCount}]` — what recurs across the recent library            |
| `sharedTerms`                                     | the intersection: why this is not arriving into an empty room            |
| `neighbours`                                      | `[{itemId, title, kind, platform, canonicalUrl, sharedTerms, actionAt}]` |
| `recentKinds` `recentTotal`                       | the shape of the last 30 days                                            |
| `stated`                                          | facts the source declared (a paper's repo, its demos)                    |
| `evidenceItemIds`                                 | every row this was built from                                            |
| `grounded`                                        | false when there is no connection to claim                               |

## Rules

1. **Deterministic.** SQL and counting. The same database produces the same context, so
   two research runs over one item are comparable. The moment this infers, the citation
   trail behind every suggestion loses its first link.
2. **Bounded by recency** (30 days). A repository starred two years ago is history, not
   current attention.
3. **A term must separate something.** `rank()` requires a term on at least two items:
   one occurrence describes one item, not a taste.
4. **Identifier namespaces are not vocabulary.** `arxiv:` `license:` `format:` `library:`
   `size_categories:` are join keys. Measured: a first context ranked `format:parquet` and
   `library:polars` in its top terms, which every dataset on the Hub answers.
5. **Ties break alphabetically.** A context that changed between identical runs would make
   its own results impossible to compare.
6. **`grounded: false` is an answer.** Do not widen the window to manufacture a link.

## Reading it without the API

```bash
python3 skills/taste-agent/scripts/taste_context.py <item-id>
```

Read-only. Opens the SQLite file and prints the context as JSON.
