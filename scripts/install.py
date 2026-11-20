#!/usr/bin/env python3
"""Install or update the atelier plugin for every provider CLI found, link the contract and probe-run, and deliver the shared Claude Code settings."""
# ruff: noqa: T201 - the install command reports what it ran and found

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT = REPO_ROOT / "instructions" / "AGENTS.md"
GITHUB_URL = "git@github.com:overnightworks/marketplace.git"
MARKETPLACE = "atelier"
PLUGIN = "atelier@atelier"

PROBE_RUN = REPO_ROOT / "scripts" / "probe_run.sh"

SHIPPED_SETTINGS = REPO_ROOT / "settings" / "claude-managed.json"
MANAGED_SETTINGS_COPY = Path(".local") / "share" / "marketplace" / "claude-managed.json"
USER_SETTINGS = Path(".claude") / "settings.json"
MANAGED_DROP_IN = Path("/etc/claude-code/managed-settings.d/50-marketplace.json")


@dataclass(frozen=True)
class OwnedSetting:
    """A setting marketplace owns: its path of keys, and the value type with the check that holds it."""

    path: tuple[str, ...]
    description: str
    holds: Callable[[object], bool]


# The shipped file may hold nothing else, and the install removes exactly these from the user file.
OWNED = (
    OwnedSetting(("env", "PYTEST_XDIST_AUTO_NUM_WORKERS"), "a string", lambda value: isinstance(value, str)),
    OwnedSetting(
        ("autoMode", "allow"), "a list of strings", lambda value: isinstance(value, list) and all(isinstance(item, str) for item in value)
    ),
    OwnedSetting(("autoCompactEnabled",), "a boolean", lambda value: isinstance(value, bool)),
    OwnedSetting(("autoCompactWindow",), "an integer", lambda value: isinstance(value, int) and not isinstance(value, bool)),
)


def owned_keys_by_top_level_key() -> dict[str, tuple[str, ...] | None]:
    """Map each owned top-level key to the nested keys it owns, or to None when the whole key is owned."""
    owned: dict[str, tuple[str, ...] | None] = {}
    for setting in OWNED:
        key, *nested = setting.path
        owned[key] = (*(owned.get(key) or ()), *nested) if nested else None
    return owned


OWNED_SETTINGS = owned_keys_by_top_level_key()

LOCAL_BIN = Path(".local") / "bin"
NEW_FILE_MODE = 0o644
ABSENT = object()  # distinguishes a missing key from one holding null or false

LINKS = (
    (Path(".claude") / "CLAUDE.md", CONTRACT),
    (Path(".codex") / "AGENTS.md", CONTRACT),
    (LOCAL_BIN / "probe-run", PROBE_RUN),
)

RELOAD_STEP = "Reload: run /reload-plugins in Claude Code, and start a new Codex thread."
CODEX_PROCESS_NAME = "codex"
CODEX_DAEMON_ARGUMENT = "app-server"
CODEX_POLL_SECONDS = 30
CODEX_WAIT_NOTE = "Codex removes the installed version directory on update, so the update waits for a gap between Codex jobs; the always-on app-server does not count as a job."


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        home = Path.home()
        user_file = home / USER_SETTINGS
        user_settings = read_json_object(user_file) if user_file.exists() else None
        link_shared_files(home)
        warn_when_probe_run_is_off_path(home)
        install_managed_settings(home)
        if user_settings is not None:
            strip_owned_settings_from_user_file(user_file, user_settings, linked=is_link_to(MANAGED_DROP_IN, home / MANAGED_SETTINGS_COPY))
        for provider in (install_claude, install_codex):
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


def link_shared_files(home: Path) -> None:
    """Link the contract and probe-run where missing; refuse before touching anything else."""
    links = {home / relative: target for relative, target in LINKS}
    missing = {link: target for link, target in links.items() if not is_link_to(link, target)}
    for link, target in missing.items():
        if link.is_symlink() or link.exists():
            raise InstallError(f"{link} exists and is not a link to {target}; leaving it unchanged")
    for link, target in missing.items():
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(target)
        print(f"linked {link} -> {target}")
    for link, target in links.items():
        if link not in missing:
            print(f"{link} already links {target.name}")


def install_managed_settings(home: Path) -> None:
    """Copy the validated shipped settings under home and say how to link them; a file that fails validation leaves the previous copy intact."""
    shipped = read_json_object(SHIPPED_SETTINGS)
    unowned = find_unowned_settings(shipped)
    if unowned:
        raise InstallError(f"{SHIPPED_SETTINGS} holds settings marketplace does not own: {', '.join(unowned)}")
    mistyped = find_mistyped_settings(shipped)
    if mistyped:
        raise InstallError(f"{SHIPPED_SETTINGS} holds settings of the wrong type: {', '.join(mistyped)}")
    copy = home / MANAGED_SETTINGS_COPY
    copy.parent.mkdir(parents=True, exist_ok=True)
    write_atomically(copy, SHIPPED_SETTINGS.read_text(encoding="utf-8"))
    print(f"copied {SHIPPED_SETTINGS.name} to {copy}")
    if not is_link_to(MANAGED_DROP_IN, copy):
        print("One-time step, run it yourself (install.py never runs sudo):")
        quoted_copy, quoted_drop_in = shlex.quote(str(copy)), shlex.quote(str(MANAGED_DROP_IN))
        print(f"  sudo mkdir -p {shlex.quote(str(MANAGED_DROP_IN.parent))} && sudo ln -sfn {quoted_copy} {quoted_drop_in}")
        print("Recovery if Claude Code stops starting:")
        print(f"  sudo rm {quoted_drop_in}")


def find_unowned_settings(settings: dict) -> list[str]:
    """Name every shipped path outside OWNED_SETTINGS; a nested key that is not an object counts as unowned."""
    unowned = []
    for key, value in settings.items():
        owned_keys = OWNED_SETTINGS.get(key, ())
        if key not in OWNED_SETTINGS or (owned_keys is not None and not isinstance(value, dict)):
            unowned.append(key)
        elif owned_keys is not None:
            unowned.extend(f"{key}.{nested}" for nested in value if nested not in owned_keys)
    return unowned


def find_mistyped_settings(settings: dict) -> list[str]:
    """Name every owned shipped value whose type is wrong; only paths that hold a value count."""
    mistyped = []
    for setting in OWNED:
        value = settings
        for part in setting.path:
            value = value.get(part, ABSENT) if isinstance(value, dict) else ABSENT
        if value is not ABSENT and not setting.holds(value):
            mistyped.append(f"{'.'.join(setting.path)} must be {setting.description}")
    return mistyped


def strip_owned_settings_from_user_file(user_file: Path, settings: dict, *, linked: bool) -> None:
    """Remove the owned settings from the user file once the drop-in links the installed copy, so a value is never in neither layer; writes only when one was there."""
    removed = [path for key, owned_keys in OWNED_SETTINGS.items() for path in remove_owned(settings, key, owned_keys)]
    if not removed:
        return
    if not linked:
        print(f"{user_file} keeps its shipped settings ({', '.join(removed)}) until the drop-in links the copy; the next install removes them")
        return
    write_atomically(user_file, json.dumps(settings, indent=2, ensure_ascii=False) + "\n")
    print(f"removed from {user_file}, now shipped: {', '.join(removed)}")


def remove_owned(settings: dict, key: str, owned_keys: tuple[str, ...] | None) -> list[str]:
    """Delete one owned entry from settings and return its dotted paths; a container this empties goes too."""
    if owned_keys is None:
        return [key] if settings.pop(key, ABSENT) is not ABSENT else []
    container = settings.get(key)
    if not isinstance(container, dict):
        return []
    removed = [f"{key}.{nested}" for nested in owned_keys if container.pop(nested, ABSENT) is not ABSENT]
    if removed and not container:
        del settings[key]
    return removed


def read_json_object(path: Path) -> dict:
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise InstallError(f"{path} cannot be read as JSON: {error}") from error
    if not isinstance(settings, dict):
        raise InstallError(f"{path} is not a JSON object")
    return settings


def write_atomically(path: Path, text: str) -> None:
    """Replace path in one step, keeping its mode and following a link, so a reader never sees half a file; the text sits in a private, uniquely named file until it is complete."""
    target = path.resolve()
    mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else NEW_FILE_MODE
    descriptor, temporary_name = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        temporary.chmod(mode)
        temporary.replace(target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def warn_when_probe_run_is_off_path(home: Path) -> None:
    bin_directory = home / LOCAL_BIN
    on_path = any(Path(entry) == bin_directory for entry in os.environ.get("PATH", "").split(os.pathsep) if entry)
    if not on_path:
        print(f"warning: {bin_directory} is not on PATH, so a shell cannot find probe-run; add it to PATH", file=sys.stderr)


def is_link_to(link: Path, target: Path) -> bool:
    return link.is_symlink() and link.resolve() == target.resolve()


def install_codex(*, from_checkout: bool) -> None:
    codex = shutil.which("codex")
    if codex is None:
        print("codex: not on PATH, skipped")
        return
    wait_for_codex_gap()
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
    print(f"codex: {MARKETPLACE} installed or updated. {CODEX_WAIT_NOTE}")


def wait_for_codex_gap() -> None:
    """Block until no Codex job runs; the script's own Codex subcommands start after this."""
    while jobs := find_codex_jobs():
        print(f"codex: waiting for a gap before updating: {', '.join(map(describe_job, jobs))}")
        pause(CODEX_POLL_SECONDS)


@dataclass(frozen=True)
class CodexJob:
    """A process the update waits for; an unreadable age or directory is None."""

    pid: str
    age_seconds: float | None
    directory: str | None


def describe_job(job: CodexJob) -> str:
    age = "?" if job.age_seconds is None else format_age(job.age_seconds)
    return f"{job.pid} ({age}, {job.directory or '?'})"


def format_age(seconds: float) -> str:
    minutes = int(seconds // 60)
    return f"{minutes // 60}h{minutes % 60:02d}m" if minutes >= 60 else f"{minutes}m"


def find_codex_jobs(process_root: Path = Path("/proc")) -> list[CodexJob]:
    return [
        CodexJob(
            pid=name_file.parent.name,
            age_seconds=read_process_age(name_file.parent, process_root / "uptime"),
            directory=read_process_directory(name_file.parent),
        )
        for name_file in process_root.glob("[0-9]*/comm")
        if read_process_name(name_file) == CODEX_PROCESS_NAME
        and not is_app_server(name_file.with_name("cmdline"))
    ]


def read_process_age(process_directory: Path, uptime_file: Path) -> float | None:
    try:
        status = (process_directory / "stat").read_text()
        started_ticks = int(status.rpartition(")")[2].split()[19])  # field 22 of stat
        uptime_seconds = float(uptime_file.read_text().split()[0])
    except (OSError, ValueError, IndexError):
        return None
    return uptime_seconds - started_ticks / os.sysconf("SC_CLK_TCK")


def read_process_directory(process_directory: Path) -> str | None:
    try:
        return str(os.readlink(process_directory / "cwd"))
    except OSError:
        return None


def read_process_name(name_file: Path) -> str | None:
    try:
        return name_file.read_text().strip()
    except OSError:  # the process ended between listing and reading
        return None


def is_app_server(command_line_file: Path) -> bool:
    """The always-on daemon serves threads and never ends; an unreadable command line counts as a job."""
    try:
        arguments = command_line_file.read_bytes().split(b"\0")
    except OSError:
        return False
    return arguments[1:2] == [CODEX_DAEMON_ARGUMENT.encode()]


def pause(seconds: float) -> None:
    time.sleep(seconds)


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
    result = subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603 - argv is fixed words
    if show_output:
        sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise InstallError(f"{' '.join(command)} exited with status {result.returncode}", result.returncode)
    return result


def run_json(command: list[str]) -> dict | list:
    return json.loads(run(command, show_output=False).stdout)


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main())
