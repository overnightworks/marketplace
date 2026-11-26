"""Rank a Claude Code session and everything it starts first for the kernel's out-of-memory killer.

The host runs this once per SessionStart. It writes 1000 to the `oom_score_adj` of the session's
process, so the processes the session starts inherit it. Raising one's own score needs no privilege.
The session's process is the pid in the hook's own `CLAUDE_PID`, accepted only when it is an ancestor
of the hook: the host gives its hooks the correct pid, while the environment the session itself was
launched with can hold a stale one.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

OOM_SCORE_ADJUST = "1000"
PROC_ROOT = Path("/proc")


def parent_pid(proc_root: Path, pid: int) -> int | None:
    try:
        for line in (proc_root / str(pid) / "status").read_text().splitlines():
            if line.startswith("PPid:"):
                return int(line.removeprefix("PPid:"))
    except (OSError, ValueError):
        return None
    return None


def is_ancestor(proc_root: Path, candidate: int, start_pid: int) -> bool:
    seen: set[int] = set()
    pid: int | None = start_pid
    while pid and pid > 1 and pid not in seen:
        if pid == candidate:
            return True
        seen.add(pid)
        pid = parent_pid(proc_root, pid)
    return False


def find_session_pid(proc_root: Path, start_pid: int, claude_pid: str | None) -> int | None:
    if claude_pid is None or not claude_pid.isdecimal():
        return None
    return int(claude_pid) if is_ancestor(proc_root, int(claude_pid), start_pid) else None


def raise_score(proc_root: Path, start_pid: int, claude_pid: str | None) -> str | None:
    """Write the score to the session's process and return what failed, or None."""
    session_pid = find_session_pid(proc_root, start_pid, claude_pid)
    if session_pid is None:
        return "no session process found: CLAUDE_PID is missing or not an ancestor of the hook"
    try:
        (proc_root / str(session_pid) / "oom_score_adj").write_text(OOM_SCORE_ADJUST)
    except OSError as error:
        return f"writing oom_score_adj of process {session_pid} failed: {error}"
    return None


def main(proc_root: Path = PROC_ROOT, start_pid: int | None = None) -> None:
    failure = raise_score(proc_root, os.getppid() if start_pid is None else start_pid, os.environ.get("CLAUDE_PID"))
    if failure:
        sys.stdout.write(json.dumps({"systemMessage": f"OOM hook: this session keeps its default out-of-memory rank; {failure}"}))
        sys.stdout.flush()


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    main()
