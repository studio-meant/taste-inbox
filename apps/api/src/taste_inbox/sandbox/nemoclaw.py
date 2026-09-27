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

import yaml

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

#: The CLI's own diagnosis when a layer under the sandbox is down. It prints this *above*
#: the gateway's cached `Phase: Ready`, so reading the phase alone reported a sandbox as
#: ready while Docker was not even running (observed 2026-09-28).
_FAILURE_LAYER = re.compile(r"Failure layer:\s*(?P<layer>[\w.-]+)\s*(?:[—-]+\s*(?P<why>.+))?")

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


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

    return parse_status(name, completed.stdout + completed.stderr)


def parse_status(name: str, output: str) -> dict[str, Any]:
    """Read `nemoclaw <name> status` output. Pure, so it is tested on recorded output."""

    text = _ANSI.sub("", output)

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
            "endpoints": [],
            "reason": "다른 실행이 샌드박스를 쓰고 있습니다",
            "raw": text.strip(),
        }

    policies: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Policies:"):
            policies = [
                part.strip() for part in stripped.split(":", 1)[1].split(",") if part.strip()
            ]
            break

    failure = _FAILURE_LAYER.search(text)
    phase_ready = "Phase: Ready" in text
    ready = phase_ready and failure is None
    reason: str | None = None
    if failure is not None:
        layer = failure.group("layer")
        why = (failure.group("why") or "").strip()
        reason = f"{layer}: {why}" if why else layer
    elif not phase_ready:
        reason = "샌드박스가 Ready 상태가 아닙니다"
    return {
        "sandbox": name,
        "ready": ready,
        "busy": False,
        "endpoints": network_policies(text),
        # Still reported when not ready: they are what the boundary *will* be once the
        # failing layer is back, and the screen names them either way.
        "policies": policies,
        "reason": reason,
        "raw": "" if ready else text.strip(),
    }


def network_policies(text: str) -> list[dict[str, Any]]:
    """Each network policy as the sandbox enforces it: hosts *and* the binaries allowed
    to reach them.

    The pairing is the point. Feasibility F4 showed `curl` refused on a host the
    `huggingface` policy opens, because that policy lists `python3` and `node`, not `curl`.
    A ledger that listed hosts alone would claim an access the sandbox does not grant.

    Read from the `Policy:` block of `status`, which is YAML indented under the heading.
    Anything unreadable yields an empty list — the screen then says the ledger is
    unavailable rather than drawing a guess.
    """

    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "Policy:")
    except StopIteration:
        return []
    block: list[str] = []
    for line in lines[start + 1 :]:
        if not line.strip():
            if block:
                break
            continue
        block.append(line)
    try:
        document = yaml.safe_load("\n".join(block))
    except yaml.YAMLError:
        return []
    policies = document.get("network_policies") if isinstance(document, dict) else None
    if not isinstance(policies, dict):
        return []

    ledger: list[dict[str, Any]] = []
    for key, policy in policies.items():
        if not isinstance(policy, dict):
            continue
        hosts: list[str] = []
        for endpoint in policy.get("endpoints") or []:
            if isinstance(endpoint, dict) and endpoint.get("host"):
                port = endpoint.get("port")
                host = str(endpoint["host"])
                label = host if port in (None, 443) else f"{host}:{port}"
                if label not in hosts:
                    hosts.append(label)
        binaries = [
            str(binary["path"])
            for binary in policy.get("binaries") or []
            if isinstance(binary, dict) and binary.get("path")
        ]
        ledger.append(
            {"policy": str(policy.get("name") or key), "hosts": hosts, "binaries": binaries}
        )
    return ledger


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
    "network_policies",
    "parse_status",
    "run_agent",
    "sandbox_name",
    "status",
]
