"""Official-API collectors for Taste Inbox R&D.

Read-only, deterministic, no browser. Two surfaces — GitHub Stars and Hugging Face
activity — both reached through documented JSON APIs over HTTPS.

This package never imports the database. Its work reaches a screen as a capture file that
`apps/api` reads; see `capture_file` for why that seam is worth keeping.
"""

__all__: list[str] = []
