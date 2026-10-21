#!/usr/bin/env python3
"""Install or update the atelier plugin for every provider CLI found, and link the contract."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT = REPO_ROOT / "instructions" / "AGENTS.md"
GITHUB_URL = "git@github.com:overnightworks/marketplace.git"
MARKETPLACE = "atelier"
PLUGIN = "atelier@atelier"

CONTRACT_LINKS = (Path(".claude") / "CLAUDE.md", Path(".codex") / "AGENTS.md")

RELOAD_STEP = "Reload: run /reload-plugins in Claude Code, and start a new Codex thread."
CODEX_WARNING = "Codex removes the installed version directory on update: run this between Codex jobs."


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        link_contract(Path.home())
        for provider in (install_codex, install_claude):
            provider(from_checkout=args.from_checkout)
    except InstallError as error:
        print(f"install.py: {error}", file=sys.stderr)
        return error.exit_status
    print(RELOAD_STEP)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-checkout",
        action="store_true",
        help="add the marketplace from this checkout instead of GitHub",
    )
    return parser.parse_args(argv)


class InstallError(Exception):
    def __init__(self, message: str, exit_status: int = 1) -> None:
        super().__init__(message)
        self.exit_status = exit_status


def link_contract(home: Path) -> None:
    """Link the contract where it is missing; refuse before touching anything else."""
    links = [home / relative for relative in CONTRACT_LINKS]
    missing = [link for link in links if not is_contract_link(link)]
    for link in missing:
        if link.is_symlink() or link.exists():
            raise InstallError(f"{link} exists and is not a link to {CONTRACT}; leaving it unchanged")
    for link in missing:
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(CONTRACT)
        print(f"linked {link} -> {CONTRACT}")
    for link in links:
        if link not in missing:
            print(f"{link} already links the contract")


def is_contract_link(link: Path) -> bool:
    return link.is_symlink() and link.resolve() == CONTRACT.resolve()


def install_codex(*, from_checkout: bool) -> None:
    codex = shutil.which("codex")
    if codex is None:
        print("codex: not on PATH, skipped")
        return
    marketplaces = {
        entry["name"]: entry
        for entry in run_json([codex, "plugin", "marketplace", "list", "--json"])["marketplaces"]
    }
    existing = marketplaces.get(MARKETPLACE)
    if existing is None:
        source = [str(REPO_ROOT)] if from_checkout else [GITHUB_URL, "--ref", "main"]
        run([codex, "plugin", "marketplace", "add", *source])
    elif existing.get("marketplaceSource", {}).get("sourceType") != "local":
        run([codex, "plugin", "marketplace", "upgrade", MARKETPLACE])
    run([codex, "plugin", "add", PLUGIN])
    print(f"codex: {MARKETPLACE} installed or updated. {CODEX_WARNING}")


def install_claude(*, from_checkout: bool) -> None:
    claude = shutil.which("claude")
    if claude is None:
        print("claude: not on PATH, skipped")
        return
    marketplaces = {entry["name"] for entry in run_json([claude, "plugin", "marketplace", "list", "--json"])}
    if MARKETPLACE in marketplaces:
        run([claude, "plugin", "marketplace", "update", MARKETPLACE])
    else:
        run([claude, "plugin", "marketplace", "add", str(REPO_ROOT) if from_checkout else GITHUB_URL])
    installed = {entry["id"] for entry in run_json([claude, "plugin", "list", "--json"])}
    run([claude, "plugin", "update" if PLUGIN in installed else "install", PLUGIN])
    print(f"claude: {MARKETPLACE} installed or updated")


def run(command: list[str], *, show_output: bool = True) -> subprocess.CompletedProcess[str]:
    if show_output:
        print("+ " + " ".join(command))
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if show_output:
        sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise InstallError(f"{' '.join(command)} exited with status {result.returncode}", result.returncode)
    return result


def run_json(command: list[str]) -> dict | list:
    return json.loads(run(command, show_output=False).stdout)


if __name__ == "__main__":
    raise SystemExit(main())
