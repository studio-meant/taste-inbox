"""The execution boundary: NemoClaw-managed OpenShell sandboxes.

Every call into the agent runtime lives here. `scripts/verify-repo.sh` enforces that —
a subprocess naming openclaw/openshell/nemoclaw anywhere else fails the build.
"""

from .trial import TrialOutcome, latest, run

__all__ = ["TrialOutcome", "latest", "run"]
