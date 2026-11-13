from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

PROBE_RUN = Path(__file__).resolve().parents[1] / "scripts" / "probe_run.sh"
CORES = os.cpu_count() or 1
LOAD_LIMIT = 1.5 * CORES
ARGUMENT_ECHO = '#!/bin/sh\nprintf "%s\\n" "$@"\n'


@pytest.fixture
def machine(tmp_path: Path) -> dict[str, str]:
    """An environment whose setpriv prints its arguments and whose load is a file."""
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    setpriv = bin_directory / "setpriv"
    setpriv.write_text(ARGUMENT_ECHO)
    setpriv.chmod(0o755)
    return {
        "PATH": f"{bin_directory}:{os.environ['PATH']}",
        "PROBE_RUN_LOADAVG_FILE": str(tmp_path / "loadavg"),
        "PROBE_RUN_POLL_SECONDS": "1",
        "PROBE_RUN_WAIT_SECONDS": "1",
    }


def set_load(machine: dict[str, str], load: float) -> None:
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text(f"{load:.2f} 0.50 0.50 1/100 1\n")


def probe_run(machine: dict[str, str], *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(PROBE_RUN), *arguments], env=machine, capture_output=True, text=True, timeout=30, check=False
    )


def test_starts_the_command_capped_with_the_defaults_when_the_load_is_below_the_limit(machine):
    set_load(machine, LOAD_LIMIT - 0.5)

    result = probe_run(machine, "my-stack", "--flag")

    assert result.returncode == 0
    assert result.stdout.split() == ["--pdeathsig", "TERM", "timeout", "-k", "30", "1800", "my-stack", "--flag"]


def test_starts_the_command_with_the_given_kill_after_and_cap(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "-k", "60", "1700", "--", "my-stack")

    assert result.stdout.split()[3:] == ["-k", "60", "1700", "my-stack"]


def test_ends_without_starting_when_the_load_stays_at_the_limit(machine):
    set_load(machine, LOAD_LIMIT)

    result = probe_run(machine, "my-stack")

    assert result.returncode != 0
    assert "no probe stack was started" in result.stderr
    assert result.stdout == ""


def test_starts_once_the_load_falls_below_the_limit_while_it_waits(machine, tmp_path):
    set_load(machine, LOAD_LIMIT + 5)
    machine["PROBE_RUN_WAIT_SECONDS"] = "20"
    lower_the_load = subprocess.Popen(
        ["sh", "-c", f"sleep 1; echo '0.10 0 0 1/1 1' > {machine['PROBE_RUN_LOADAVG_FILE']}"]
    )

    result = probe_run(machine, "my-stack")

    lower_the_load.wait()
    assert result.stdout.split()[-1] == "my-stack"


@pytest.mark.parametrize(
    ("arguments", "complaint"),
    [
        ((), "no command"),
        (("-k", "60"), "-k needs K and CAP"),
        (("-k", "60", "1700"), "no command"),
        (("-k", "x", "1700", "my-stack"), "K must be a positive integer"),
        (("-k", "30", "0", "my-stack"), "CAP must be a positive integer"),
        (("-k", "30", "-5", "my-stack"), "CAP must be a positive integer"),
        (("-k", "31", "1800", "my-stack"), "CAP + K must be at most 1830"),
    ],
)
def test_fails_loud_on_malformed_arguments_without_starting_anything(machine, arguments, complaint):
    set_load(machine, 0.0)

    result = probe_run(machine, *arguments)

    assert result.returncode == 2
    assert complaint in result.stderr
    assert result.stdout == ""


def test_accepts_the_largest_allowed_cap(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "-k", "30", "1800", "my-stack")

    assert result.returncode == 0
