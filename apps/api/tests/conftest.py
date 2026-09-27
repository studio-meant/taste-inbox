"""Pytest fixtures."""

from __future__ import annotations

import pytest

from taste_inbox.config.loader import load_resource_policy_document
from taste_inbox.config.schema import ResourcePolicyConfig


@pytest.fixture(scope="session")
def example_policy_config() -> ResourcePolicyConfig:
    """The committed `config/resource-policy.example.yaml`, parsed and validated."""
    return load_resource_policy_document().resource_policy
