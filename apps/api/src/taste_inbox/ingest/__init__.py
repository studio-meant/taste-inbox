"""Reading collector output into the local database."""

from .captures import IngestReport, ingest_all

__all__ = ["IngestReport", "ingest_all"]
