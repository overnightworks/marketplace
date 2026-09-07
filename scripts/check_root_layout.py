#!/usr/bin/env python3
"""The layout gate: what may sit at the repository root, and what form a file may take.

The root holds only what a tool must find there — the host marketplace
catalogs, the scanner configuration, the licence, the entry documents —
and everything else lives in the directory of its owner (AGENTS.md,
"Repository layout"). The gate reads the tree as git sees it, tracked files
plus untracked files git does not ignore, so a stray that never landed is red
too, and every refusal names where the entry belongs.

It also refuses a tracked symlink anywhere in the tree. This repository
publishes a composite action that every consumer's CI resolves with `uses:`,
which checks out the whole repository: a link pointing outside it breaks that
extraction and every consuming build with it.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

# The entry documents and the files a tool must find at the root: git reads
# .gitignore there, the SonarCloud scanner reads sonar-project.properties, a
# Python toolchain would read pyproject.toml and uv.lock. Container files are
# not named because this repository builds no image; the day one is needed,
# adding it is a decision that adds its entry here. `plugins/atelier/` is the
# whole payload a host installs, so nothing a plugin needs belongs up here.
ROOT_FILES = frozenset(
    {
        ".gitignore",
        "AGENTS.md",
        "CLAUDE.md",
        "HEART.md",
        "LICENSE",
        "README.md",
        "pyproject.toml",
        "sonar-project.properties",
        "uv.lock",
    }
)
# `.agents/` and `.claude-plugin/` are the two hosts' marketplace catalogs,
# `.codex/` and `.claude/` this repository's own host configuration, `.github/`
# the workflows and the published action: every one of them is a path its tool
# fixes. `instructions/` owns the operator's coordination contract, `plugins/`
# the payload both catalogs name as their source.
ROOT_DIRECTORIES = frozenset(
    {
        ".agents",
        ".claude",
        ".claude-plugin",
        ".codex",
        ".github",
        "instructions",
        "plugins",
        "scripts",
        "tests",
    }
)
HOME_BY_SUFFIX = {
    ".py": "a helper belongs under scripts/",
    ".md": "a document belongs next to its owner",
}
DEFAULT_HOME = "the root holds only what a tool must find there; a file lives in the directory of its owner"
DIRECTORY_HOME = "a new top-level directory needs a named owner and an entry in scripts/check_root_layout.py"
SYMLINK_HOME = (
    "a tracked symlink makes this repository unextractable for every consumer of its "
    "published action, because `uses:` checks the whole repository out; commit the content"
)
SYMLINK_MODE = "120000"
# The gate judges the repository that carries it, never the caller's working
# directory: `git ls-files` prints paths relative to the cwd, so a run from
# `scripts/` would otherwise accuse this very file of being misplaced.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class RootAllowlist:
    files: frozenset[str]
    directories: frozenset[str]


@dataclass(frozen=True)
class TrackedEntry:
    mode: str
    path: str


REPOSITORY_ALLOWLIST = RootAllowlist(ROOT_FILES, ROOT_DIRECTORIES)


def root_layout_problems(listing: Iterable[str], allowlist: RootAllowlist) -> tuple[str, ...]:
    """What the listing carries at the root that the allowlist does not name.

    `listing` holds repository-relative paths as git prints them; an entry with
    a separator lives in a top-level directory, one without is a root file.
    """
    files: set[str] = set()
    directories: set[str] = set()
    for entry in listing:
        top, separator, _ = entry.partition("/")
        (directories if separator else files).add(top)
    problems = [
        f"{name}: {HOME_BY_SUFFIX.get(Path(name).suffix, DEFAULT_HOME)}"
        for name in sorted(files - allowlist.files)
    ]
    problems.extend(f"{name}/: {DIRECTORY_HOME}" for name in sorted(directories - allowlist.directories))
    return tuple(problems)


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
    completed = subprocess.run(
        ["git", "ls-files", "-z", *options],
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return [record for record in completed.stdout.split("\0") if record]


def tracked_entries(repository_root: Path) -> tuple[TrackedEntry, ...]:
    return parse_tracked_entries(_git_records(repository_root, "-s"))


def untracked_paths(repository_root: Path) -> list[str]:
    """Every untracked path git does not ignore."""
    return _git_records(repository_root, "--others", "--exclude-standard")


def main() -> int:
    tracked = tracked_entries(REPOSITORY_ROOT)
    listing = [entry.path for entry in tracked] + untracked_paths(REPOSITORY_ROOT)
    problems = root_layout_problems(listing, REPOSITORY_ALLOWLIST) + tracked_symlink_problems(tracked)
    if problems:
        print("layout check failed:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print("layout check passed")
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main())
