"""Tell a running Claude Code head what changed in the contract since it last saw it.

The host runs this once per SessionStart, UserPromptSubmit and PostToolBatch event
and passes the event as JSON on stdin. The hook prints the changed lines of
AGENTS.md and HEAD.md as `additionalContext`, or nothing.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import asdict, dataclass, replace
from enum import StrEnum
from pathlib import Path

CONTRACT_FILES = ("AGENTS.md", "HEAD.md")
BASELINE_SOURCES = frozenset({"startup", "resume", "clear", "fork"})
DELEGATED_SECTION_HEADING = "## Head or helper"
HINT_CHARACTER_LIMIT = 10_000
STATE_SECONDS_BEFORE_PRUNING = 7 * 24 * 3600
SESSION_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
BLOCKQUOTE_MARKER_PATTERN = re.compile(r"^[ \t]*(?:>[ \t]?)+", re.MULTILINE)


class Role(StrEnum):
    HEAD = "head"
    HELPER = "helper"


# The role of a session whose contract cannot be read; every hook that decides a role shares this answer.
UNREADABLE_CONTRACT_ROLE = Role.HEAD


@dataclass(frozen=True)
class Snapshot:
    commit: str
    blobs: dict[str, str]


@dataclass(frozen=True)
class SessionState:
    seen: Snapshot | None
    role: Role | None
    last_failure: str | None


class ContractFailure(Exception):
    """The contract cannot be located or read; the message is the line the head gets."""


def git_run(directory: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - git with fixed words and paths derived from the operator's own contract link
        ["git", "-C", str(directory), "--no-optional-locks", *arguments],  # noqa: S607 - git is found on PATH like every tool here
        capture_output=True,
        text=True,
        check=False,
    )


def git_text(directory: Path, *arguments: str) -> str:
    completed = git_run(directory, *arguments)
    if completed.returncode != 0:
        command = " ".join(arguments)
        detail = normalise_whitespace(completed.stderr) or f"exit status {completed.returncode}"
        raise ContractFailure(f"Contract hook: git {command} failed in {directory}: {detail}")
    return completed.stdout


def locate_contract_file() -> Path | None:
    """Return the AGENTS.md that `~/.claude/CLAUDE.md` links to, or None when no link exists."""
    link = Path.home() / ".claude" / "CLAUDE.md"
    if not link.is_symlink():
        return None
    try:
        target = link.resolve(strict=True)
    except OSError:
        raise ContractFailure(f"Contract hook: {link} points to a missing file.") from None
    if target.name != "AGENTS.md":
        raise ContractFailure(f"Contract hook: {link} points to {target.name}, not AGENTS.md.")
    if git_run(target.parent, "rev-parse", "--is-inside-work-tree").returncode != 0:
        raise ContractFailure(f"Contract hook: {target.parent} is not a git work tree.")
    return target


def normalise_whitespace(text: str) -> str:
    return " ".join(text.split())


def read_delegated_line(contract_file: Path) -> str:
    quoted: list[str] = []
    in_section = False
    for line in contract_file.read_text().splitlines():
        if line.startswith("## "):
            in_section = line.strip() == DELEGATED_SECTION_HEADING
        elif in_section and line.startswith(">"):
            quoted.append(line[1:])
        elif quoted:
            break
    if not quoted:
        raise ContractFailure(
            f"Contract hook: {contract_file} has no blockquote under '{DELEGATED_SECTION_HEADING}'."
        )
    return normalise_whitespace(" ".join(quoted))


def decide_role(prompt: str, contract_file: Path) -> Role:
    delegated_line = read_delegated_line(contract_file)
    unquoted = BLOCKQUOTE_MARKER_PATTERN.sub("", prompt)
    return Role.HELPER if normalise_whitespace(unquoted).startswith(delegated_line) else Role.HEAD


def take_snapshot(directory: Path) -> Snapshot:
    return Snapshot(
        commit=git_text(directory, "rev-parse", "HEAD").strip(),
        blobs={
            name: git_text(directory, "rev-parse", f"HEAD:./{name}").strip() for name in CONTRACT_FILES
        },
    )


def describe_change(directory: Path, old: Snapshot, new: Snapshot, changed: list[str]) -> str:
    lines = [f"The contract in {directory} changed since this session last saw it: {', '.join(changed)}."]
    if git_run(directory, "merge-base", "--is-ancestor", old.commit, new.commit).returncode == 0:
        subjects = git_text(directory, "log", "--format=%s", f"{old.commit}..{new.commit}", "--", *changed)
        lines += ["Commits that changed them:", *(f"- {subject}" for subject in subjects.splitlines())]
    else:
        lines.append(f"The checkout moved to a commit without {old.commit}; no commit list applies.")
    header = "\n".join(lines)
    diffs = [
        f"Diff of {name}:\n{git_text(directory, 'diff', old.commit, new.commit, '--', name)}" for name in changed
    ]
    hint = "\n".join([header, *diffs])
    if len(hint) <= HINT_CHARACTER_LIMIT:
        return hint
    commands = [
        f"git -C {directory} diff {old.commit} {new.commit} -- {name}" for name in changed
    ]
    return "\n".join([header, "The diff is too long to show here; these commands print it:", *commands])


def stored_snapshot_exists(directory: Path, snapshot: Snapshot) -> bool:
    identifiers = [snapshot.commit, *snapshot.blobs.values()]
    return all(git_run(directory, "cat-file", "-e", identifier).returncode == 0 for identifier in identifiers)


def changes_since(directory: Path, old: Snapshot) -> tuple[str | None, Snapshot]:
    commit = git_text(directory, "rev-parse", "HEAD").strip()
    if commit == old.commit:
        return None, old
    new = take_snapshot(directory)
    if not stored_snapshot_exists(directory, old):
        gone = f"Contract hook: the contract this session saw last is gone from {directory}; its history was rewritten."
        return f"{gone} The baseline is taken again.", new
    changed = [name for name in CONTRACT_FILES if new.blobs[name] != old.blobs[name]]
    return (describe_change(directory, old, new, changed) if changed else None), new


def start_session(directory: Path, source: str, previous: SessionState | None) -> SessionState:
    role = previous.role if previous and source == "resume" else None
    return SessionState(take_snapshot(directory), role, None)


def follow_session(
    payload: dict[str, object], contract_file: Path, previous: SessionState | None
) -> tuple[str | None, SessionState]:
    directory = contract_file.parent
    state = previous or SessionState(None, None, None)
    role = state.role
    if role is None and payload["hook_event_name"] == "UserPromptSubmit":
        role = decide_role(str(payload["prompt"]), contract_file)
    if state.seen is None:
        return None, SessionState(take_snapshot(directory), role, None)
    if role is not Role.HEAD:
        return None, replace(state, role=role, last_failure=None)
    hint, seen = changes_since(directory, state.seen)
    return hint, SessionState(seen, role, None)


def report_failure(message: str, previous: SessionState | None) -> tuple[str | None, SessionState]:
    state = previous or SessionState(None, None, None)
    hint = None if state.last_failure == message else message
    return hint, replace(state, role=state.role or UNREADABLE_CONTRACT_ROLE, last_failure=message)


def read_state(state_file: Path) -> SessionState | None:
    try:
        raw = json.loads(state_file.read_text())
        seen = raw["seen"]
        return SessionState(
            None
            if seen is None
            else Snapshot(seen["commit"], {name: seen["blobs"][name] for name in CONTRACT_FILES}),
            None if raw["role"] is None else Role(raw["role"]),
            raw["last_failure"],
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def write_state(state_file: Path, state: Mapping[str, object]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=state_file.parent, suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w") as temporary:
            json.dump(state, temporary)
        os.replace(temporary_name, state_file)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def prune_stale_states(state_directory: Path) -> None:
    cutoff = time.time() - STATE_SECONDS_BEFORE_PRUNING
    for state_file in state_directory.glob("*.json"):
        with suppress(FileNotFoundError):  # another session may have pruned this file since the listing
            if state_file.stat().st_mtime < cutoff:
                state_file.unlink(missing_ok=True)


def print_hint(event: str, hint: str) -> None:
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": hint}}))
    sys.stdout.flush()


def session_state_file(state_directory: Path, session_id: str) -> Path:
    """Return the state file of one session; a session id that is not a plain name never reaches the disk."""
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise ValueError(f"Contract hook: session id {session_id!r} is not a plain name.")
    return state_directory / f"{session_id}.json"


def main() -> None:
    payload = json.load(sys.stdin)
    event = payload["hook_event_name"]
    if "agent_id" in payload or (event == "SessionStart" and payload["source"] not in BASELINE_SOURCES):
        return
    state_directory = Path(os.environ["CLAUDE_PLUGIN_DATA"]) / "contract-change"
    state_file = session_state_file(state_directory, payload["session_id"])
    previous = read_state(state_file)
    if event != "SessionStart" and previous and previous.role is Role.HELPER:
        return
    try:
        contract_file = locate_contract_file()
        if contract_file is None:
            return
        if event == "SessionStart":
            prune_stale_states(state_directory)
            hint, state = None, start_session(contract_file.parent, payload["source"], previous)
        else:
            hint, state = follow_session(payload, contract_file, previous)
    except ContractFailure as failure:
        hint, state = report_failure(str(failure), previous)
    if hint:
        print_hint(event, hint)
    write_state(state_file, asdict(state))


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    main()
