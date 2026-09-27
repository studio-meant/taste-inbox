"""Which network policy a trial runs under.

The preset lives in `config/nemoclaw/taste-inbox-trial.yaml` and is applied by a person,
not by this code: `nemoclaw <sandbox> policy add --from-file …`. That split is deliberate
and matches how the inherited product treats `launchctl` — the repository prints the
command and a human runs it, because widening a security boundary is not something a
scheduled job should be able to do on its own.

What this module does is *read* the boundary so the product can state it, and check a
plan against it before the plan runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..action.proposal import ALLOWED_TRIAL_HOSTS, TrialPlan
from . import nemoclaw

#: Presets a trial expects to be applied. Named so the screen can say what is missing
#: rather than letting a run fail halfway through a clone.
REQUIRED_PRESETS = ("github", "taste-inbox-trial", "pypi")


@dataclass(frozen=True, slots=True)
class PolicyCheck:
    sandbox: str
    ready: bool
    #: Another run holds the host lock. Distinct from `not ready`: the boundary is fine,
    #: the machine is simply busy, and the answer is to wait rather than to re-apply presets.
    busy: bool
    policies: list[str]
    missing_presets: list[str]
    #: Hosts the plan needs that this product would never open.
    refused_hosts: list[str]

    @property
    def satisfied(self) -> bool:
        return self.ready and not self.busy and not self.missing_presets

    def as_dict(self) -> dict[str, Any]:
        return {
            "sandbox": self.sandbox,
            "ready": self.ready,
            "busy": self.busy,
            "policies": self.policies,
            "missingPresets": self.missing_presets,
            "refusedHosts": self.refused_hosts,
            "satisfied": self.satisfied,
        }


def check(plan: TrialPlan, *, sandbox: str | None = None) -> PolicyCheck:
    """Compare what the plan needs against what the sandbox actually allows."""

    state = nemoclaw.status(sandbox=sandbox)
    policies = list(state["policies"])
    busy = bool(state.get("busy"))
    # While the lock is held the policy list is unreadable, so claiming presets are missing
    # would be a guess. Report busy and let the caller wait.
    missing = [] if busy else [preset for preset in REQUIRED_PRESETS if preset not in policies]
    # A host the plan named that this product refuses outright. Not opened, and not
    # silently dropped either — the screen says the research mentioned it.
    refused = [host for host in plan.refused_hosts if host not in ALLOWED_TRIAL_HOSTS]
    return PolicyCheck(
        sandbox=state["sandbox"],
        ready=bool(state["ready"]),
        busy=busy,
        policies=policies,
        missing_presets=missing,
        refused_hosts=refused,
    )


def install_commands(sandbox: str | None = None) -> list[str]:
    """What a person runs to give a sandbox this boundary. Printed, never executed."""

    name = nemoclaw.sandbox_name(sandbox)
    return [
        f"nemoclaw {name} policy add github --yes",
        f"nemoclaw {name} policy add pypi --yes",
        f"nemoclaw {name} policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --dry-run",
        f"nemoclaw {name} policy add --from-file config/nemoclaw/taste-inbox-trial.yaml --yes",
    ]


__all__ = ["REQUIRED_PRESETS", "PolicyCheck", "check", "install_commands"]
