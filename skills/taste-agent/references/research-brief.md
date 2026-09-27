# ResearchBrief

**The only text this product sends off the machine.** The list below is a boundary, not a
style guide — `apps/api/src/taste_inbox/research/brief.py`.

## May cross

- the subject's public identifiers: `owner/name`, an arXiv id, a Hub repo id, its URL
- facts the source itself stated (a paper's repository, its linked demos)
- the subject's own topic terms
- recurring topic terms with counts
- public ids of related saves, with the shared term
- the shape of recent attention, as counts

## Must not cross

- other items' titles or body text
- any URL but the subject's
- `@handles`, account names, email addresses
- file paths, anything from `.env`
- the user's own notes

`_scrub()` is the backstop, not the boundary: it drops token-shaped strings
(`nvapi-`, `tvly-`, `ghp_`, `hf_`, `sk-`, JWTs) and handles. The shape above is what keeps
them out in the first place.

## Inherited from `aiq-research/SKILL.md`

- **State the target backend URL before sending.** Non-local must be https and explicitly
  trusted by the user in this conversation.
- No credentials, cookies, bearer tokens or secret values in query text.
- **Never auto-retry a failed job.**
- **Keep citations and source URLs intact.**
- Do not force polling when there is no `job_id`.

## The questions

Exactly three, plus a fourth when the subject is a paper with no known repository. Do not
add questions that ask the model to estimate memory, disk, or whether something will run
here — the sandbox answers that by running it, and an estimate would be the fabricated
number this product deleted once already.

When the context is not grounded the brief says so, so the report cannot invent a
relationship to fill the gap.
