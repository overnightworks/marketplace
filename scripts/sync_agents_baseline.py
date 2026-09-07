#!/usr/bin/env python3
"""Derive the agent-documentation skill's AGENTS.md seed from the root policy.

The seed ships inside the plugin payload (`plugins/atelier/`), which is all a
host installs, so it cannot be a pointer at the root policy file — it has to be
a file. It is a view of that policy: this script writes it, `--check` fails on
drift, and the only editable parts are the root `AGENTS.md` and the seed
preamble next to this script. What the root file says about this repository
alone sits between the baseline-skip markers and never reaches the seed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = REPOSITORY_ROOT / "AGENTS.md"
PREAMBLE_PATH = Path(__file__).resolve().parent / "agents_baseline_preamble.md"
BASELINE_PATH = (
    REPOSITORY_ROOT
    / "plugins"
    / "atelier"
    / "skills"
    / "agent-documentation"
    / "AGENTS.baseline.md"
)

SKIP_START = "<!-- baseline-skip-start"
SKIP_END = "<!-- baseline-skip-end"
REGENERATE_COMMAND = "python3 scripts/sync_agents_baseline.py"


def main() -> int:
    args = parse_args()
    expected = render_baseline(read(POLICY_PATH), read(PREAMBLE_PATH))
    current = read(BASELINE_PATH) if BASELINE_PATH.exists() else None
    if current == expected:
        print(f"{relative(BASELINE_PATH)} is in sync with {relative(POLICY_PATH)}.")
        return 0
    if args.check:
        print(
            f"{relative(BASELINE_PATH)} has drifted from {relative(POLICY_PATH)}. "
            f"Run `{REGENERATE_COMMAND}` and commit the result.",
            file=sys.stderr,
        )
        return 1
    with BASELINE_PATH.open("w", encoding="utf-8") as baseline:
        baseline.write(expected)
    print(f"Regenerated {relative(BASELINE_PATH)} from {relative(POLICY_PATH)}.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the agent-documentation seed baseline from the root AGENTS.md."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if the generated baseline is not up to date.",
    )
    return parser.parse_args()


def render_baseline(policy: str, preamble: str) -> str:
    return f"{preamble.rstrip()}\n\n{reusable_policy(policy)}"


def reusable_policy(policy: str) -> str:
    """The policy without the passages that speak about this repository alone."""
    kept: list[str] = []
    skipping = False
    for line in policy.splitlines():
        if line.startswith(SKIP_START):
            skipping = True
        elif line.startswith(SKIP_END):
            if not skipping:
                raise SystemExit(f"{relative(POLICY_PATH)} closes a baseline skip that never opened.")
            skipping = False
        elif not skipping:
            kept.append(line)
    if skipping:
        raise SystemExit(f"{relative(POLICY_PATH)} leaves a baseline skip open.")
    return "\n".join(kept).strip() + "\n"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def relative(path: Path) -> str:
    # Every path this module prints is derived from REPOSITORY_ROOT.
    return str(path.relative_to(REPOSITORY_ROOT))


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main())
