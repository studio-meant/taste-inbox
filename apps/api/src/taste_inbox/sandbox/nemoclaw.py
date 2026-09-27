"""Running one trial inside a NemoClaw-managed OpenShell sandbox.

**This is the only module that spawns the agent runtime.** `scripts/verify-repo.sh`
enforces that: a `subprocess` call naming `openclaw`/`openshell`/`nemoclaw` anywhere
outside `sandbox/` fails the build. Scattering those calls is how an unreviewed second
path to execution appears, and this product removed code execution once already for
exactly that class of reason.

## The call shape, measured rather than quoted

`docs/FEASIBILITY.md` records what the installed runtime actually accepts. The published
docs describe `openclaw agent exec --cwd --state-dir`; **OpenClaw 2026.7.1 has none of
those** — no `exec` subcommand, no `--cwd`. And `--local`, which the docs call the
headless entry point, is refused inside a sandbox:

    Error: 'openclaw agent --local' is not supported inside NemoClaw sandboxes.
    The --local flag bypasses the gateway's security protections (secret scanning,
    network policy, inference auth) and can crash the sandbox.

That refusal is not an obstacle to work around — it is this product's entire premise. The
agent has to go through the gateway, because the gateway is what applies the network
policy and keeps the inference credential out of the sandbox.

So a trial is:

    nemoclaw <sandbox> exec --timeout N -- sh -lc '
        cd <workdir> && openclaw agent --agent main --json --timeout N
                                       --session-id <id> --message-file <plan>'

The plan travels as a **file**, written inside the sandbox from base64 on stdin. Passing
it as an argv string would put an untrusted research report through two levels of shell
quoting; a report containing a quote or a backtick would then become shell syntax, which
is the injection this seam exists to avoid.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any

DEFAULT_SANDBOX = "taste-inbox"

#: Where a trial's files live. `/sandbox` is the writable root; every trial gets its own
#: directory so two runs cannot read each other's checkout.
WORK_ROOT = "/sandbox/work"

#: Long enough for a clone, a dependency resolve and a first run. The agent gets slightly
#: less than the outer command so its own timeout fires first and produces a JSON envelope
#: instead of being killed and producing nothing.
DEFAULT_TIMEOUT_SECONDS = 900
_AGENT_MARGIN_SECONDS = 60

#: The CLI serialises host operations behind one lock, so a concurrent trial makes an
#: unrelated `status` fail. The message is matched rather than the exit code because the
#: CLI exits 0 on it.
_LOCK_CONTENDED = re.compile(r"Failed to acquire lock on .*\.lock", re.IGNORECASE)


class SandboxUnavailable(RuntimeError):
    """The sandbox could not be used, with the reason kept for the screen."""


@dataclass(frozen=True, slots=True)
class SandboxRun:
    """One agent turn inside the sandbox."""

    trial_id: str
    workdir: str
    exit_code: int
    stdout: str
    stderr: str
    #: The parsed `--json` envelope when there was one.
    envelope: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def _cli() -> str:
    found = shutil.which("nemoclaw")
    if not found:
        raise SandboxUnavailable(
            "nemoclaw is not on PATH. Install it with "
            "`curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash`."
        )
    return found


def sandbox_name(name: str | None = None) -> str:
    return (name or os.environ.get("NEMOCLAW_SANDBOX_NAME") or DEFAULT_SANDBOX).strip()


def _exec(
    script: str,
    *,
    sandbox: str,
    timeout: float,
    stdin: str | None = None,
) -> subprocess.CompletedProcess[str]:
    argv = [_cli(), sandbox, "exec", "--timeout", str(int(timeout)), "--"]
    argv += ["sh", "-lc", script]
    if stdin is not None:
        argv.insert(argv.index("exec") + 1, "--stdin")
    try:
        return subprocess.run(  # noqa: S603 — argv built here; the plan never enters it
            argv,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=timeout + 30,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise SandboxUnavailable(f"sandbox exec timed out after {timeout:.0f}s") from error
    except FileNotFoundError as error:
        raise SandboxUnavailable(str(error)) from error


def status(*, sandbox: str | None = None, timeout: float = 90) -> dict[str, Any]:
    """Whether the sandbox is usable, and what boundary it is running under."""

    name = sandbox_name(sandbox)
    try:
        completed = subprocess.run(  # noqa: S603
            [_cli(), name, "status"], capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired as error:
        raise SandboxUnavailable(f"`nemoclaw {name} status` timed out") from error

    text = completed.stdout + completed.stderr

    # A contended host lock is not "the sandbox is not ready" — it is "another run of ours
    # holds it". Measured the hard way: a trial in progress made a policy check report the
    # boundary as missing, which would have refused the next trial for the wrong reason
    # and told the user to re-apply presets that were already applied.
    if _LOCK_CONTENDED.search(text):
        return {
            "sandbox": name,
            "ready": False,
            "busy": True,
            "policies": [],
            "raw": text.strip(),
        }

    ready = "Phase: Ready" in text
    policies: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Policies:"):
            policies = [part.strip() for part in stripped.split(":", 1)[1].split(",") if part.strip()]
            break
    return {
        "sandbox": name,
        "ready": ready,
        "busy": False,
        "policies": policies,
        "raw": text if not ready else "",
    }


def run_agent(
    *,
    trial_id: str,
    plan_text: str,
    sandbox: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> SandboxRun:
    """Hand the plan to the agent and return what came back.

    The plan is written into the sandbox from base64 on stdin, so nothing from the
    research report is ever interpreted by a shell.
    """

    name = sandbox_name(sandbox)
    workdir = f"{WORK_ROOT}/{trial_id}"
    agent_timeout = max(60, int(timeout) - _AGENT_MARGIN_SECONDS)
    encoded = base64.b64encode(plan_text.encode("utf-8")).decode("ascii")

    script = (
        f"set -e; mkdir -p {workdir}; cd {workdir}; "
        # `base64 -d` reads the encoded plan from stdin, so the plan text never becomes
        # part of any command line.
        f"base64 -d > plan.md; "
        f"openclaw agent --agent main --json "
        f"--timeout {agent_timeout} --session-id trial-{trial_id} "
        f"--message-file {workdir}/plan.md"
    )

    completed = _exec(script, sandbox=name, timeout=timeout, stdin=encoded)
    from . import transcript

    return SandboxRun(
        trial_id=trial_id,
        workdir=workdir,
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        envelope=transcript.envelope_of(completed.stdout) or {},
    )


def list_workdir(trial_id: str, *, sandbox: str | None = None, timeout: float = 60) -> list[str]:
    """What the trial left behind, as plain names. Evidence that something ran."""

    workdir = f"{WORK_ROOT}/{trial_id}"
    completed = _exec(
        f"cd {workdir} 2>/dev/null && ls -1A | head -60 || true",
        sandbox=sandbox_name(sandbox),
        timeout=timeout,
    )
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


__all__ = [
    "DEFAULT_SANDBOX",
    "DEFAULT_TIMEOUT_SECONDS",
    "WORK_ROOT",
    "SandboxRun",
    "SandboxUnavailable",
    "list_workdir",
    "run_agent",
    "sandbox_name",
    "status",
]
