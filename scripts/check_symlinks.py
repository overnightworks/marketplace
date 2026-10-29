"""The symlink gate: no tracked symlink anywhere in the tree.

This repository publishes a composite action that every consumer's CI resolves
with `uses:`, which checks out the whole repository: a link pointing outside it
breaks that extraction and every consuming build with it. Which entries may
stand at the repository root is the quality `root-layout` rule's decision
(`quality/config.toml`); this gate keeps only what that rule leaves to this
repository.
"""
# ruff: noqa: T201 - the gate reports its findings

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

SYMLINK_HOME = (
    "a tracked symlink makes this repository unextractable for every consumer of its "
    "published action, because `uses:` checks the whole repository out; commit the content"
)
SYMLINK_MODE = "120000"
# The gate judges the repository that carries it, never the caller's working
# directory.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class TrackedEntry:
    mode: str
    path: str


def tracked_symlink_problems(entries: Iterable[TrackedEntry]) -> tuple[str, ...]:
    return tuple(
        f"{entry.path}: {SYMLINK_HOME}"
        for entry in sorted(entries, key=lambda entry: entry.path)
        if entry.mode == SYMLINK_MODE
    )


def parse_tracked_entries(records: Iterable[str]) -> tuple[TrackedEntry, ...]:
    """Read `git ls-files -s` records, each `<mode> <object> <stage>\tpath`."""
    entries = []
    for record in records:
        metadata, _, path = record.partition("\t")
        entries.append(TrackedEntry(mode=metadata.split()[0], path=path))
    return tuple(entries)


def _git_records(repository_root: Path, *options: str) -> list[str]:
    completed = subprocess.run(  # noqa: S603 - argv is fixed words and the caller's options
        ["git", "ls-files", "-z", *options],  # noqa: S607 - git is resolved from PATH like every repository tool
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return [record for record in completed.stdout.split("\0") if record]


def tracked_entries(repository_root: Path) -> tuple[TrackedEntry, ...]:
    return parse_tracked_entries(_git_records(repository_root, "-s"))


def main() -> int:
    tracked = tracked_entries(REPOSITORY_ROOT)
    problems = tracked_symlink_problems(tracked)
    if problems:
        print("symlink check failed:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print("symlink check passed")
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main())
