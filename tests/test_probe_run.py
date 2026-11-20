from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from hook_fixtures import install_fake

PROBE_RUN = Path(__file__).resolve().parents[1] / "scripts" / "probe_run.sh"
CORES = int(subprocess.run(["nproc"], capture_output=True, text=True, check=True).stdout)
LOAD_LIMIT = 1.5 * CORES
ARGUMENT_ECHO = '#!/bin/sh\nprintf "%s\\n" "$@"\n'
MAXIMUM_TOTAL_SECONDS = 1830
BAD_INPUT_STATUS = 2
LOAD_TIMEOUT_STATUS = 75


@pytest.fixture
def machine(tmp_path: Path) -> dict[str, str]:
    """An environment whose setpriv prints its arguments and whose load is a file."""
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    install_fake(bin_directory, "setpriv", ARGUMENT_ECHO)
    install_fake(bin_directory, "sleep", "#!/bin/sh\n")
    return {
        "PATH": f"{bin_directory}:{os.environ['PATH']}",
        "PROBE_RUN_LOADAVG_FILE": str(tmp_path / "loadavg"),
        "PROBE_RUN_POLL_SECONDS": "1",
        "PROBE_RUN_WAIT_SECONDS": "1",
    }


def set_load(machine: dict[str, str], load: float) -> None:
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text(f"{load:.2f} 0.50 0.50 1/100 1\n")


def timeout_arguments(result: subprocess.CompletedProcess[str]) -> list[str]:
    """What the fake setpriv was asked to run, from the timeout on."""
    tokens = result.stdout.split()
    return tokens[tokens.index("timeout") + 1 :]


def probe_run(machine: dict[str, str], *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(PROBE_RUN), *arguments], env=machine, capture_output=True, text=True, timeout=30, check=False
    )


def test_starts_the_command_capped_within_the_total_limit_when_the_load_is_below_the_limit(machine):
    set_load(machine, LOAD_LIMIT - 0.5)

    result = probe_run(machine, "my-stack", "--flag")

    assert result.returncode == 0
    assert result.stdout.split()[:2] == ["--pdeathsig", "TERM"]
    dash_k, kill_after, cap, command, flag = timeout_arguments(result)
    assert dash_k == "-k"
    kill_after, cap = int(kill_after), int(cap)
    assert kill_after > 0
    assert cap > 0
    assert cap + kill_after <= MAXIMUM_TOTAL_SECONDS
    assert (command, flag) == ("my-stack", "--flag")


def test_starts_the_command_with_the_given_kill_after_and_cap(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "-k", "60", "1700", "--", "my-stack")

    assert timeout_arguments(result) == ["-k", "60", "1700", "my-stack"]


def test_ends_without_starting_when_the_load_stays_at_the_limit(machine):
    set_load(machine, LOAD_LIMIT)

    result = probe_run(machine, "my-stack")

    assert result.returncode == LOAD_TIMEOUT_STATUS
    assert "no probe stack was started" in result.stderr
    assert result.stdout == ""


def test_starts_once_the_load_falls_below_the_limit_while_it_waits(machine):
    set_load(machine, LOAD_LIMIT + 5)
    bin_directory = Path(machine["PATH"].split(":")[0])
    install_fake(bin_directory, "sleep", f"#!/bin/sh\necho '0.10 0 0 1/1 1' > {machine['PROBE_RUN_LOADAVG_FILE']}\n")

    result = probe_run(machine, "my-stack")

    assert result.returncode == 0
    assert result.stdout.split()[-1] == "my-stack"


def test_decides_the_load_without_calling_awk(machine):
    set_load(machine, LOAD_LIMIT - 0.5)
    install_fake(Path(machine["PATH"].split(":")[0]), "awk", "#!/bin/sh\necho 'awk: broken' >&2\nexit 2\n")

    result = probe_run(machine, "my-stack")

    assert result.returncode == 0
    assert result.stdout.split()[-1] == "my-stack"


@pytest.mark.parametrize(
    ("load", "starts"),
    [
        (f"{LOAD_LIMIT - 0.01:.2f}", True),
        (f"{LOAD_LIMIT - 0.001}", True),
        (f"{LOAD_LIMIT:.2f}", False),
        (f"{LOAD_LIMIT + 0.001}", False),
        (f"00{LOAD_LIMIT - 1:.1f}", True),
        ("0", True),
    ],
)
def test_starts_only_when_the_exact_load_is_below_the_limit(machine, load, starts):
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text(f"{load} 0.50 0.50 1/100 1\n")

    result = probe_run(machine, "my-stack")

    assert (result.returncode == 0) is starts


def test_reads_a_load_with_a_leading_zero_as_decimal(machine):
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text("012345678 0.50 0.50 1/100 1\n")

    result = probe_run(machine, "my-stack")

    assert result.returncode == LOAD_TIMEOUT_STATUS


@pytest.mark.parametrize("content", ["", "\n", "not-a-number 1 2 3/4 5\n", "-1.0 0 0 1/1 1\n"])
def test_fails_loud_without_starting_when_the_load_reading_is_not_a_number(machine, content):
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text(content)

    result = probe_run(machine, "my-stack")

    assert result.returncode == BAD_INPUT_STATUS
    assert "no valid 1-minute load" in result.stderr or "cannot read a load average" in result.stderr
    assert result.stdout == ""


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
        (("-k", "30", "9223372036854775808", "my-stack"), "CAP must be a positive integer"),
        (("-k", "9223372036854775808", "1800", "my-stack"), "K must be a positive integer"),
    ],
)
def test_fails_loud_on_malformed_arguments_without_starting_anything(machine, arguments, complaint):
    set_load(machine, 0.0)

    result = probe_run(machine, *arguments)

    assert result.returncode == BAD_INPUT_STATUS
    assert complaint in result.stderr
    assert result.stdout == ""


def test_accepts_the_largest_allowed_cap(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "-k", "30", "1800", "my-stack")

    assert result.returncode == 0


@pytest.mark.parametrize("name", ["PROBE_RUN_POLL_SECONDS", "PROBE_RUN_WAIT_SECONDS"])
@pytest.mark.parametrize("value", ["0", "-1", "x", "", "1.5", "12345"])
def test_fails_loud_on_a_malformed_poll_or_wait_value(machine, name, value):
    set_load(machine, 0.0)

    result = probe_run({**machine, name: value}, "my-stack")

    assert result.returncode == BAD_INPUT_STATUS
    assert name in result.stderr
    assert result.stdout == ""


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_prints_its_own_usage_for_help_without_waiting_or_starting(machine, flag):
    set_load(machine, LOAD_LIMIT + 5)

    result = probe_run(machine, flag)

    assert result.returncode == 0
    assert result.stdout.startswith("Run a probe stack's drive")
    assert "usage: probe-run" in result.stdout
    assert "Exit status while waiting" in result.stdout


def test_hands_help_after_the_command_on_to_the_command(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "my-stack", "--help")

    assert result.stdout.split()[-2:] == ["my-stack", "--help"]


def test_ends_a_wait_without_starting_once_the_process_that_started_it_is_gone(machine, tmp_path):
    set_load(machine, LOAD_LIMIT + 5)
    install_fake(Path(machine["PATH"].split(":")[0]), "sleep", "#!/bin/sh\n/bin/sleep 0.05\n")
    environment = {**machine, "PROBE_RUN_WAIT_SECONDS": "3600"}
    output = tmp_path / "orphan.out"
    starter = subprocess.run(
        ["sh", "-c", f'{PROBE_RUN} my-stack > {output} 2>&1 & echo $!; /bin/sleep 1'],
        env=environment, capture_output=True, text=True, timeout=30, check=True,
    )
    orphan = int(starter.stdout)

    deadline = time.monotonic() + 20
    while is_running(orphan) and time.monotonic() < deadline:
        time.sleep(0.1)

    assert not is_running(orphan)
    assert "ended during the wait" in output.read_text()
    assert "my-stack" not in output.read_text().splitlines()


ENDS_ITS_STARTER_BEFORE_ARMING = """#!/bin/sh
starter=$PPID
kill -9 "$starter"
while [ -e "/proc/$starter" ] && ! grep -q '^State:.Z' "/proc/$starter/status"; do /bin/sleep 0.01; done
exec {real_setpriv} "$@"
"""
PR_SET_CHILD_SUBREAPER = 36


def test_ends_without_starting_when_the_starter_ends_before_the_signal_is_armed(machine, tmp_path):
    set_load(machine, 0.0)
    install_fake(
        Path(machine["PATH"].split(":")[0]),
        "setpriv",
        ENDS_ITS_STARTER_BEFORE_ARMING.format(real_setpriv=shutil.which("setpriv")),
    )
    output, marker = tmp_path / "orphan.out", tmp_path / "command-ran"
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl(PR_SET_CHILD_SUBREAPER, 1)
    try:
        starter = subprocess.Popen(
            ["sh", "-c", f'{PROBE_RUN} sh -c "touch {marker}" > {output} 2>&1 & echo $!; wait'],
            env=machine, stdout=subprocess.PIPE, text=True,
        )
        orphan = int(starter.stdout.readline())
        starter.wait(timeout=30)
        _, status = os.waitpid(orphan, 0)
    finally:
        libc.prctl(PR_SET_CHILD_SUBREAPER, 0)

    assert os.waitstatus_to_exitcode(status) == 4
    assert "ended during the wait" in output.read_text()
    assert not marker.exists()


def test_runs_the_command_under_timeout_while_the_starter_lives(machine, tmp_path):
    set_load(machine, 0.0)
    (Path(machine["PATH"].split(":")[0]) / "setpriv").unlink()
    marker = tmp_path / "command-ran"

    result = probe_run(machine, "sh", "-c", f"touch {marker}")

    assert result.returncode == 0
    assert marker.exists()


def is_running(pid: int) -> bool:
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False
