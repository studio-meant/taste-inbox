"""A small library of GitHub stars and Hugging Face likes, in the collectors' real shape.

The capture documents here are what `api_sources/github_stars.py` and
`api_sources/huggingface/` write — the same `{run, items}` envelope, the same item fields —
so the database under these tests is built by the production ingester, not by inserts
that could drift from it. Every repository and paper named is public.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from taste_inbox.db.models import Base, Item
from taste_inbox.ingest import ingest_all

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "data" / "fixtures"


def _run(count: int) -> dict[str, Any]:
    return {
        "started_at": "2026-09-27T17:04:05Z",
        "finished_at": "2026-09-27T17:04:08Z",
        "outcome": "ok",
        "scroll_passes": 1,
        "exhausted": True,
        "advanced_checkpoint": False,
        "checkpoint": None,
        "stopped_because": "fixture",
        "notes": [],
        "items_seen": count,
    }


def repo(name: str, *, topics: list[str], starred: str, body: str | None = None) -> dict[str, Any]:
    owner = name.split("/")[0]
    return {
        "platform": "github",
        "platform_item_id": f"gh-{name}",
        "canonical_url": f"https://github.com/{name}",
        "kind": "repo",
        "title": name,
        "body_text": body,
        "owner": owner,
        "source_published_at": "2026-01-01T00:00:00Z",
        "action_at": starred,
        "tags": topics,
        "outbound_urls": [],
        "evidence": [],
    }


GITHUB_ITEMS = [
    repo(
        "debpalash/VoiceStudio",
        topics=["local-first", "mlx", "cuda", "text-to-speech", "mcp"],
        starred="2026-09-26T09:00:00Z",
        body="The open-source, fully-local ElevenLabs alternative.",
    ),
    repo(
        "jamiepine/voicebox",
        topics=["mlx", "cuda", "voice-ai", "text-to-speech"],
        starred="2026-09-20T09:00:00Z",
    ),
    repo(
        "modelcontextprotocol/servers",
        topics=["mcp", "ai-agents"],
        starred="2026-09-18T09:00:00Z",
    ),
    repo(
        "anthropics/claude-code",
        topics=["claude-code", "ai-agents", "mcp"],
        starred="2026-09-10T09:00:00Z",
    ),
]

HF_ITEMS = [
    {
        "platform": "huggingface",
        "platform_item_id": "dataset:FineEnvs/SmolDataEnvs",
        "canonical_url": "https://huggingface.co/datasets/FineEnvs/SmolDataEnvs",
        "kind": "dataset",
        "title": "FineEnvs/SmolDataEnvs",
        "body_text": "5.5K+ RL tasks for hill-climbing small models in code and data science.",
        "owner": "FineEnvs",
        "source_published_at": "2026-09-24T09:46:20.000Z",
        "action_at": "2026-09-25T10:50:58.000Z",
        "tags": ["license:mit", "agent", "reinforcement-learning", "arxiv:2501.12948"],
        "outbound_urls": [],
        "evidence": [],
    },
    {
        "platform": "huggingface",
        "platform_item_id": "space:cfahlgren1/robotok",
        "canonical_url": "https://huggingface.co/spaces/cfahlgren1/robotok",
        "kind": "space",
        "title": "cfahlgren1/robotok",
        "body_text": None,
        "owner": "cfahlgren1",
        "source_published_at": "2026-09-24T17:41:39.000Z",
        "action_at": "2026-09-25T11:04:45.000Z",
        "tags": ["static", "region:us"],
        "outbound_urls": [],
        "evidence": [],
    },
    {
        "platform": "huggingface",
        "platform_item_id": "paper:2501.12948",
        "canonical_url": "https://huggingface.co/papers/2501.12948",
        "kind": "paper",
        "title": (
            "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning"
        ),
        "body_text": (
            "We introduce our first-generation reasoning models, DeepSeek-R1-Zero and DeepSeek-R1."
        ),
        "owner": None,
        "source_published_at": "2025-01-22T00:00:00.000Z",
        "action_at": "2026-09-25T10:50:58.000Z",
        "tags": ["reinforcement-learning", "reasoning"],
        "outbound_urls": [],
        "evidence": [
            {
                "type": "paper.github_repo",
                "label": "Code",
                "value": "deepseek-ai/DeepSeek-R1",
                "source_url": "https://github.com/deepseek-ai/DeepSeek-R1",
                "confidence": 1.0,
                "provenance": "huggingface",
            },
            {
                "type": "paper.linked_model",
                "label": "Model",
                "value": "deepseek-ai/DeepSeek-R1",
                "source_url": "https://huggingface.co/deepseek-ai/DeepSeek-R1",
                "confidence": 1.0,
                "provenance": "huggingface",
            },
            {
                "type": "paper.linked_dataset",
                "label": "Dataset",
                "value": "FineEnvs/SmolDataEnvs",
                "source_url": "https://huggingface.co/datasets/FineEnvs/SmolDataEnvs",
                "confidence": 1.0,
                "provenance": "huggingface",
            },
            {
                "type": "paper.total_models",
                "label": "Models citing this paper",
                "value": "521",
                "source_url": None,
                "confidence": None,
                "provenance": "huggingface",
            },
            {
                "type": "paper.total_spaces",
                "label": "Spaces citing this paper",
                "value": "4297",
                "source_url": None,
                "confidence": None,
                "provenance": "huggingface",
            },
        ],
    },
]


def write_captures(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "github_stars_api.json").write_text(
        json.dumps({"run": _run(len(GITHUB_ITEMS)), "items": GITHUB_ITEMS}), "utf-8"
    )
    (directory / "huggingface_activity.json").write_text(
        json.dumps({"run": _run(len(HF_ITEMS)), "items": HF_ITEMS}), "utf-8"
    )
    return directory


def library(tmp_path: Path) -> sessionmaker[Session]:
    """An in-memory database holding the library above, shared across threads."""

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    with factory() as session:
        ingest_all(session, write_captures(tmp_path / "captures"))
    return factory


def item_id(session: Session, canonical_url: str) -> str:
    found = session.scalar(select(Item.id).where(Item.canonical_url == canonical_url))
    assert found is not None, canonical_url
    return found


def recorded_report() -> str:
    return (FIXTURES / "research" / "voicestudio-shallow-report.md").read_text("utf-8")


def recorded_status(name: str) -> str:
    return (FIXTURES / "sandbox" / name).read_text("utf-8")
