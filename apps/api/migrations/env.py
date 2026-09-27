"""Alembic environment.

The database URL comes from `DATABASE_URL` (see `.env.example`) so that no personal
data path is committed. Metadata comes from `taste_inbox.db.Base`, so
`alembic revision --autogenerate` compares against the declarative models rather than a
hand-written list.
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

from taste_inbox.db import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

DEFAULT_DATABASE_URL = "sqlite:///./var/data/taste-inbox.db"
database_url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def _ensure_sqlite_directory(url: str) -> None:
    """Create the parent directory for a file-backed SQLite database.

    A clean checkout has no `var/` tree — it is gitignored because it holds personal
    data. Creating it on demand is what lets the documented bootstrap run without a
    manual `mkdir`.
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return
    path = url[len(prefix) :]
    if not path or path == ":memory:":
        return
    Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_directory(database_url)
config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite cannot ALTER most things in place.
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
