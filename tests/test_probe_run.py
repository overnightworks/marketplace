from __future__ import annotations

import contextlib
import ctypes
import os
import shutil
import signal
import socket
import subprocess
import threading
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
ENVIRONMENT_ERROR_STATUS = 69


@pytest.fixture
def real_machine(tmp_path: Path) -> dict[str, str]:
    """An environment with the system setpriv and timeout and a load that leaves room."""
    (tmp_path / "loadavg").write_text("0.00 0.00 0.00 1/100 1\n")
    return {
        "PATH": os.environ["PATH"],
        "PROBE_RUN_LOADAVG_FILE": str(tmp_path / "loadavg"),
        "PROBE_RUN_POLL_SECONDS": "1",
        "PROBE_RUN_WAIT_SECONDS": "1",
    }


@pytest.fixture
def machine(tmp_path: Path, real_machine: dict[str, str]) -> dict[str, str]:
    """An environment whose timeout prints what it is asked to run and whose load is a file."""
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    install_fake(bin_directory, "timeout", ARGUMENT_ECHO)
    install_fake(bin_directory, "sleep", "#!/bin/sh\n")
    return {**real_machine, "PATH": f"{bin_directory}:{real_machine['PATH']}"}


def set_load(machine: dict[str, str], load: float) -> None:
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text(f"{load:.2f} 0.50 0.50 1/100 1\n")


def timeout_arguments(result: subprocess.CompletedProcess[str]) -> list[str]:
    """What the fake timeout was asked to run."""
    return result.stdout.split()


def answer_one_connection(listener: socket.socket) -> None:
    """Read a request from the next client and answer it, as a server does."""
    listener.settimeout(10)
    with contextlib.suppress(OSError):
        connection, _ = listener.accept()
        with connection:
            connection.recv(4)
            connection.sendall(b"ok")


def probe_run(
    machine: dict[str, str], *arguments: str, input: str | None = None
) -> subprocess.CompletedProcess[str]:
    """Runs probe-run as the leader of its own session, so that a failure ends every process it owns."""
    probe = subprocess.Popen(
        [str(PROBE_RUN), *arguments],
        env=machine, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, start_new_session=True,
    )
    try:
        stdout, stderr = probe.communicate(input=input, timeout=30)
    except BaseException:
        end_probe_run(probe)
        raise
    return subprocess.CompletedProcess(probe.args, probe.returncode, stdout, stderr)


def test_starts_the_command_capped_within_the_total_limit_when_the_load_is_below_the_limit(machine):
    set_load(machine, LOAD_LIMIT - 0.5)

    result = probe_run(machine, "my-stack", "--flag")

    assert result.returncode == 0
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


def test_runs_the_command_in_a_network_namespace_of_its_own(real_machine):
    starters_namespace = os.readlink("/proc/self/ns/net")

    result = probe_run(real_machine, "readlink", "/proc/self/ns/net")

    assert result.returncode == 0
    assert result.stdout.strip().startswith("net:[")
    assert result.stdout.strip() != starters_namespace


# A client that tries ::1 first and falls back only when that connection is refused, as curl does
# for localhost.
IPV6_FIRST_CLIENT = """
import socket, sys
for address in ("::1", "127.0.0.1"):
    try:
        connection = socket.create_connection((address, int(sys.argv[1])), timeout=10)
    except OSError:
        continue
    connection.sendall(b"ping")
    sys.exit(0 if connection.recv(2) == b"ok" else 1)
sys.exit(1)
"""


def test_a_client_that_tries_ipv6_localhost_first_exchanges_data_with_a_host_ipv4_listener(real_machine):
    with socket.create_server(("127.0.0.1", 0)) as listener:
        port = listener.getsockname()[1]
        answerer = threading.Thread(target=answer_one_connection, args=(listener,))
        answerer.start()

        result = probe_run(real_machine, "python3", "-c", IPV6_FIRST_CLIENT, str(port))

        answerer.join(timeout=10)

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("missing_tool", "present_tools"),
    [("pasta", ()), ("pgrep", ("pasta",))],
    ids=["pasta-missing", "pgrep-missing"],
)
def test_fails_loud_without_starting_when_a_network_tool_is_missing(
    real_machine, tmp_path, missing_tool, present_tools
):
    bin_directory = tmp_path / "bare-bin"
    bin_directory.mkdir()
    for tool in ("bash", *present_tools):
        (bin_directory / tool).symlink_to(shutil.which("bash"))

    result = probe_run({**real_machine, "PATH": str(bin_directory)}, "my-stack")

    assert result.returncode == ENVIRONMENT_ERROR_STATUS
    assert missing_tool in result.stderr
    assert "no probe stack was started" in result.stderr


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


def test_wait_only_returns_at_once_for_a_load_below_the_limit_under_a_german_locale(machine):
    set_load(machine, LOAD_LIMIT / 3)
    machine["LANG"] = "de_DE.UTF-8"

    result = probe_run(machine, "--wait-only")

    assert result.returncode == 0
    assert result.stdout == ""


def test_wait_only_ends_with_the_load_timeout_status_when_the_load_stays_at_the_limit(machine):
    set_load(machine, LOAD_LIMIT)

    result = probe_run(machine, "--wait-only")

    assert result.returncode == LOAD_TIMEOUT_STATUS
    assert result.stdout == ""


def test_wait_only_fails_loud_on_an_unreadable_load(machine):
    Path(machine["PROBE_RUN_LOADAVG_FILE"]).write_text("")

    result = probe_run(machine, "--wait-only")

    assert result.returncode == BAD_INPUT_STATUS


def test_wait_only_with_a_command_is_a_usage_error(machine):
    set_load(machine, 0.0)

    result = probe_run(machine, "--wait-only", "my-stack")

    assert result.returncode == BAD_INPUT_STATUS
    assert "--wait-only" in result.stderr
    assert result.stdout == ""


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
    assert "Exit status" in result.stdout


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


SLEEPS_AFTER_ANNOUNCING = "#!/bin/sh\ntouch {announcement}\nexec /bin/sleep 30\n"
INTERRUPTED_STATUS = 130
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
    assert "ended before the command started" in output.read_text()
    assert not marker.exists()


def test_ends_a_wait_at_once_on_sigint_without_starting_the_command(machine, tmp_path):
    set_load(machine, LOAD_LIMIT + 5)
    bin_directory = Path(machine["PATH"].split(":")[0])
    (bin_directory / "timeout").unlink()
    announcement, marker = tmp_path / "waiting", tmp_path / "command-ran"
    install_fake(bin_directory, "sleep", SLEEPS_AFTER_ANNOUNCING.format(announcement=announcement))
    environment = {**machine, "PROBE_RUN_WAIT_SECONDS": "3600"}
    probe = subprocess.Popen(
        [str(PROBE_RUN), "sh", "-c", f"touch {marker}"], env=environment, stderr=subprocess.PIPE, text=True
    )
    deadline = time.monotonic() + 20
    while not announcement.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    try:
        probe.send_signal(signal.SIGINT)
        _, stderr = probe.communicate(timeout=10)
    finally:
        if probe.poll() is None:
            probe.kill()
            probe.wait()

    assert probe.returncode == INTERRUPTED_STATUS
    assert "no probe stack was started" in stderr
    assert not marker.exists()


def test_runs_the_command_under_timeout_while_the_starter_lives(machine, tmp_path):
    set_load(machine, 0.0)
    (Path(machine["PATH"].split(":")[0]) / "timeout").unlink()
    marker = tmp_path / "command-ran"

    result = probe_run(machine, "sh", "-c", f"touch {marker}")

    assert result.returncode == 0
    assert marker.exists()


def test_hands_its_stdin_to_the_command(real_machine):
    result = probe_run(real_machine, "cat", input="a piped scenario\n")

    assert result.returncode == 0
    assert result.stdout == "a piped scenario\n"


def test_starts_the_command_with_interrupt_and_quit_handled_by_default(real_machine):
    result = probe_run(real_machine, "grep", "^SigIgn:", "/proc/self/status")

    ignored = int(result.stdout.split()[1], 16)
    assert ignored & ((1 << (signal.SIGINT - 1)) | (1 << (signal.SIGQUIT - 1))) == 0


TEARS_DOWN_ON_EXIT_AND_TERM = """#!/bin/sh
trap 'touch {torn_down}; exit 0' EXIT TERM
touch {ready}
while true; do /bin/sleep 0.05; done
"""
COUNTS_TERM_FOR_TWO_SECONDS = """#!/bin/sh
trap 'echo term >> {terms}' TERM
touch {ready}
for _ in $(seq 40); do /bin/sleep 0.05; done
"""
IGNORES_TERM = """#!/bin/sh
trap '' TERM
touch {ready}
while true; do /bin/sleep 0.05; done
"""
HUNG_UP_STATUS = 129
CAP_EXPIRED_STATUS = 124
KILLED_STATUS = 137
SHORT_KILL_AFTER, SHORT_CAP = "2", "20"
# A cap far beyond DEATH_SIGNAL_WINDOW, so that only a death signal can end the stack inside it.
LONG_CAP = "120"
DEATH_SIGNAL_WINDOW = 10


class Stack:
    """A command under the system timeout that announces itself and may tear down."""

    def __init__(self, tmp_path: Path, script: str) -> None:
        self.ready, self.torn_down = tmp_path / "ready", tmp_path / "torn-down"
        self.terms = tmp_path / "terms"
        self.script = tmp_path / "stack.sh"
        self.script.write_text(script.format(ready=self.ready, torn_down=self.torn_down, terms=self.terms))
        self.script.chmod(0o755)

    def wait_until_ready(self) -> None:
        wait_for(self.ready.exists)


def wait_for(condition, seconds: float = 20) -> None:
    deadline = time.monotonic() + seconds
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.05)


def start_stack_under_probe_run(real_machine: dict[str, str], stack: Stack, *times: str) -> subprocess.Popen[str]:
    """Starts probe-run as the leader of its own session, so that ending it ends every process it owns."""
    probe = subprocess.Popen(
        [str(PROBE_RUN), "-k", *(times or (SHORT_KILL_AFTER, SHORT_CAP)), "--", str(stack.script)],
        env=real_machine, text=True, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        stack.wait_until_ready()
    except BaseException:
        end_probe_run(probe)
        raise
    return probe


def end_probe_run(probe: subprocess.Popen[str]) -> None:
    """Kills every process of probe-run's session and reaps it.

    timeout and the stack run in a process group of their own, so only the session reaches them.
    """
    with contextlib.suppress(ProcessLookupError):
        os.killpg(probe.pid, signal.SIGKILL)
    for member in live_session_members(probe.pid):
        with contextlib.suppress(ProcessLookupError):
            os.kill(member, signal.SIGKILL)
    probe.communicate(timeout=30)


@pytest.mark.parametrize(
    ("signal_number", "status"), [(signal.SIGINT, INTERRUPTED_STATUS), (signal.SIGHUP, HUNG_UP_STATUS)]
)
@pytest.mark.parametrize("to_process_group", [False, True], ids=["to-the-pid", "to-the-process-group"])
def test_tears_the_stack_down_on_an_interrupt_or_hangup_and_reports_it(
    real_machine, tmp_path, signal_number, status, to_process_group
):
    stack = Stack(tmp_path, TEARS_DOWN_ON_EXIT_AND_TERM)
    probe = start_stack_under_probe_run(real_machine, stack)

    try:
        if to_process_group:
            os.killpg(probe.pid, signal_number)
        else:
            probe.send_signal(signal_number)
        probe.communicate(timeout=10)
    finally:
        end_probe_run(probe)

    assert probe.returncode == status
    assert stack.torn_down.exists()


HIDES_CHILDREN_UNTIL_VISIBLE = """#!/bin/sh
[ -e {visible} ] || {{ touch {asked}; exit 1; }}
exec /usr/bin/pgrep "$@"
"""


def test_a_term_before_pasta_has_a_visible_child_still_reaches_the_command(real_machine, tmp_path):
    """The TERM must not end pasta, which would leave the command running until the cap."""
    stack = Stack(tmp_path, TEARS_DOWN_ON_EXIT_AND_TERM)
    visible = tmp_path / "children-visible"
    asked = tmp_path / "relay-asked-for-children"
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    install_fake(bin_directory, "pgrep", HIDES_CHILDREN_UNTIL_VISIBLE.format(visible=visible, asked=asked))
    probe = start_stack_under_probe_run({**real_machine, "PATH": f"{bin_directory}:{real_machine['PATH']}"}, stack)

    try:
        probe.send_signal(signal.SIGTERM)
        wait_for(asked.exists)
        assert asked.exists()
        visible.touch()
        probe.communicate(timeout=10)
        wait_for(lambda: not live_session_members(probe.pid), DEATH_SIGNAL_WINDOW)
        left_running = live_session_members(probe.pid)
    finally:
        end_probe_run(probe)

    assert left_running == []
    assert stack.torn_down.exists()


def test_sends_one_term_however_many_stop_signals_arrive(real_machine, tmp_path):
    """A timeout forwards every TERM it gets, so the one it is sent must stay one."""
    stack = Stack(tmp_path, COUNTS_TERM_FOR_TWO_SECONDS)
    bin_directory = tmp_path / "bin"
    bin_directory.mkdir()
    install_fake(bin_directory, "timeout", stack.script.read_text())
    probe = start_stack_under_probe_run({**real_machine, "PATH": f"{bin_directory}:{real_machine['PATH']}"}, stack)

    try:
        probe.send_signal(signal.SIGINT)
        wait_for(stack.terms.exists)
        probe.send_signal(signal.SIGHUP)
        probe.communicate(timeout=20)
    finally:
        end_probe_run(probe)

    assert stack.terms.read_text().splitlines() == ["term"]


def test_tears_the_stack_down_and_ends_it_when_the_cap_expires(real_machine, tmp_path):
    stack = Stack(tmp_path, TEARS_DOWN_ON_EXIT_AND_TERM)
    probe = start_stack_under_probe_run(real_machine, stack, "2", "1")

    try:
        probe.communicate(timeout=20)
    finally:
        end_probe_run(probe)

    assert probe.returncode == CAP_EXPIRED_STATUS
    assert stack.torn_down.exists()


def test_kills_a_stack_that_ignores_term_only_after_the_kill_delay(real_machine, tmp_path):
    stack = Stack(tmp_path, IGNORES_TERM)
    probe = start_stack_under_probe_run(real_machine, stack, "2", "1")

    try:
        started = time.monotonic()
        probe.communicate(timeout=20)
        elapsed = time.monotonic() - started
    finally:
        end_probe_run(probe)

    assert probe.returncode == KILLED_STATUS
    assert elapsed >= 2


def test_tears_the_stack_down_once_the_process_that_started_probe_run_is_gone(real_machine, tmp_path):
    stack = Stack(tmp_path, TEARS_DOWN_ON_EXIT_AND_TERM)
    pid_file = tmp_path / "probe-run.pid"
    starter = subprocess.Popen(
        ["sh", "-c", f"{PROBE_RUN} -k {SHORT_KILL_AFTER} {LONG_CAP} {stack.script} & echo $! > {pid_file}; wait"],
        env=real_machine,
    )
    probe_run_pid = None
    try:
        stack.wait_until_ready()
        probe_run_pid = int(pid_file.read_text())
        starter.kill()
        starter.wait(timeout=10)
        wait_for(stack.torn_down.exists, DEATH_SIGNAL_WINDOW)
        wait_for(lambda: not is_running(probe_run_pid), DEATH_SIGNAL_WINDOW)
    finally:
        if starter.poll() is None:
            starter.kill()
            starter.wait()
        if probe_run_pid is not None and is_running(probe_run_pid):
            os.kill(probe_run_pid, signal.SIGKILL)

    assert stack.torn_down.exists()
    assert not is_running(probe_run_pid)


def test_a_killed_probe_run_tears_the_stack_down_and_leaves_nothing_of_its_own_running(real_machine, tmp_path):
    stack = Stack(tmp_path, TEARS_DOWN_ON_EXIT_AND_TERM)
    probe = start_stack_under_probe_run(real_machine, stack, SHORT_KILL_AFTER, LONG_CAP)

    try:
        probe.kill()
        probe.wait(timeout=10)
        wait_for(stack.torn_down.exists, DEATH_SIGNAL_WINDOW)
        wait_for(lambda: not live_session_members(probe.pid), DEATH_SIGNAL_WINDOW)
        remaining = live_session_members(probe.pid)
    finally:
        end_probe_run(probe)

    assert stack.torn_down.exists()
    assert remaining == []


def is_running(pid: int) -> bool:
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False


def live_session_members(session: int) -> list[int]:
    listing = subprocess.run(
        ["ps", "-s", str(session), "-o", "pid=,stat="], capture_output=True, text=True, check=False
    )
    members = (line.split() for line in listing.stdout.splitlines())
    return [int(pid) for pid, status in members if not status.startswith("Z")]
