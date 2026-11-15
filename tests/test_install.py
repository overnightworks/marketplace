from __future__ import annotations

import json
import os
import re
import shlex
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

from script_under_test import load_script


install = load_script("install")

FAKE_PROVIDER = f"""#!{sys.executable}
import json, os, sys
from pathlib import Path

provider = sys.argv[0].rsplit("/", 1)[-1]
state = json.loads(Path(os.environ["FAKE_PROVIDER_STATE"]).read_text())[provider]
command = " ".join(sys.argv[1:])
with Path(os.environ["FAKE_PROVIDER_LOG"]).open("a") as log:
    log.write(provider + " " + command + "\\n")
if command == state.get("fail_on"):
    sys.exit(7)
if command.endswith("list --json"):
    print(json.dumps(state[command]))
"""

CODEX_ABSENT = {"plugin marketplace list --json": {"marketplaces": []}}
CODEX_FROM_GITHUB = {
    "plugin marketplace list --json": {
        "marketplaces": [{"name": "atelier", "marketplaceSource": {"sourceType": "git"}}]
    }
}
CODEX_FROM_LOCAL = {
    "plugin marketplace list --json": {
        "marketplaces": [{"name": "atelier", "marketplaceSource": {"sourceType": "local"}}]
    }
}
CLAUDE_ABSENT = {"plugin marketplace list --json": [], "plugin list --json": []}
CLAUDE_PRESENT = {
    "plugin marketplace list --json": [{"name": "atelier"}],
    "plugin list --json": [{"id": "atelier@atelier"}],
}

GITHUB = install.GITHUB_URL
CHECKOUT = str(install.REPO_ROOT)


class Machine:
    """A temporary home and PATH holding fake provider CLIs that record their argv."""

    def __init__(self, root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.home = root / "home"
        self.home.mkdir()
        self.bin = root / "bin"
        self.bin.mkdir()
        self.log = root / "log"
        self.drop_in = root / "etc" / "50-marketplace.json"
        monkeypatch.setattr(install, "MANAGED_DROP_IN", self.drop_in)
        self.state_file = root / "state.json"
        self.state: dict[str, object] = {}
        monkeypatch.setenv("HOME", str(self.home))
        monkeypatch.setenv("PATH", str(self.bin))
        monkeypatch.setenv("FAKE_PROVIDER_STATE", str(self.state_file))
        monkeypatch.setenv("FAKE_PROVIDER_LOG", str(self.log))

    def install_provider(self, name: str, state: dict[str, object]) -> None:
        executable = self.bin / name
        executable.write_text(FAKE_PROVIDER)
        executable.chmod(0o755)
        self.state.setdefault(name, {}).update(state)
        self.state_file.write_text(json.dumps(self.state))

    def commands(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def contract_link(self, relative: str) -> Path:
        return self.home / relative

    @property
    def managed_copy(self) -> Path:
        return self.home / ".local" / "share" / "marketplace" / "claude-managed.json"

    @property
    def user_settings(self) -> Path:
        return self.home / ".claude" / "settings.json"

    def write_user_settings(self, text: str) -> Path:
        self.user_settings.parent.mkdir(parents=True, exist_ok=True)
        self.user_settings.write_text(text)
        return self.user_settings


class CodexJobs:
    """Running jobs the script sees in turn (the last list repeats); sleeps are recorded, not slept."""

    def __init__(self) -> None:
        self.polls: list[list[install.CodexJob]] = [[]]
        self.pauses: list[float] = []
        self.commands_at_pause: list[list[str]] = []
        self.read_commands: Callable[[], list[str]] = list

    def pause(self, seconds: float) -> None:
        self.pauses.append(seconds)
        self.commands_at_pause.append(self.read_commands())

    def find(self) -> list[install.CodexJob]:
        return self.polls.pop(0) if len(self.polls) > 1 else self.polls[0]


@pytest.fixture
def codex_jobs(monkeypatch: pytest.MonkeyPatch) -> CodexJobs:
    jobs = CodexJobs()
    monkeypatch.setattr(install, "find_codex_jobs", jobs.find)
    monkeypatch.setattr(install, "pause", jobs.pause)
    return jobs


@pytest.fixture
def machine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, codex_jobs) -> Machine:
    environment = Machine(tmp_path, monkeypatch)
    codex_jobs.read_commands = environment.commands
    return environment


@pytest.mark.parametrize(
    ("provider", "state", "arguments", "expected"),
    [
        pytest.param(
            "codex", CODEX_ABSENT, [],
            [
                "codex plugin marketplace list --json",
                f"codex plugin marketplace add {GITHUB} --ref main",
                "codex plugin add atelier@atelier",
            ],
            id="codex-fresh-install-from-github",
        ),
        pytest.param(
            "codex", CODEX_ABSENT, ["--from-checkout"],
            [
                "codex plugin marketplace list --json",
                f"codex plugin marketplace add {CHECKOUT}",
                "codex plugin add atelier@atelier",
            ],
            id="codex-fresh-install-from-checkout",
        ),
        pytest.param(
            "codex", CODEX_FROM_GITHUB, [],
            [
                "codex plugin marketplace list --json",
                "codex plugin marketplace upgrade atelier",
                "codex plugin add atelier@atelier",
            ],
            id="codex-update-git-marketplace",
        ),
        pytest.param(
            "codex", CODEX_FROM_LOCAL, [],
            ["codex plugin marketplace list --json", "codex plugin add atelier@atelier"],
            id="codex-update-local-marketplace",
        ),
        pytest.param(
            "claude", CLAUDE_ABSENT, [],
            [
                "claude plugin marketplace list --json",
                f"claude plugin marketplace add {GITHUB}",
                "claude plugin list --json",
                "claude plugin install atelier@atelier",
            ],
            id="claude-fresh-install-from-github",
        ),
        pytest.param(
            "claude", CLAUDE_ABSENT, ["--from-checkout"],
            [
                "claude plugin marketplace list --json",
                f"claude plugin marketplace add {CHECKOUT}",
                "claude plugin list --json",
                "claude plugin install atelier@atelier",
            ],
            id="claude-fresh-install-from-checkout",
        ),
        pytest.param(
            "claude", CLAUDE_PRESENT, [],
            [
                "claude plugin marketplace list --json",
                "claude plugin marketplace update atelier",
                "claude plugin list --json",
                "claude plugin update atelier@atelier",
            ],
            id="claude-update",
        ),
    ],
)
def test_runs_the_provider_commands_the_situation_needs(
    machine, capsys, provider, state, arguments, expected
):
    machine.install_provider(provider, state)

    assert install.main(arguments) == 0

    assert machine.commands() == expected
    assert "/reload-plugins" in capsys.readouterr().out


def test_skips_a_provider_that_is_not_on_path(machine, capsys):
    machine.install_provider("claude", CLAUDE_PRESENT)

    assert install.main([]) == 0

    assert not any(command.startswith("codex") for command in machine.commands())
    assert "codex: not on PATH" in capsys.readouterr().out


def test_stops_with_the_provider_exit_status_when_a_provider_command_fails(machine, capsys):
    machine.install_provider("codex", CODEX_ABSENT)
    machine.install_provider("claude", CLAUDE_PRESENT)
    machine.install_provider("codex", {"fail_on": "plugin add atelier@atelier"})

    assert install.main([]) == 7

    assert "claude plugin update atelier@atelier" in machine.commands()
    assert "exited with status 7" in capsys.readouterr().err


def test_links_the_contract_where_it_is_missing(machine):
    assert install.main([]) == 0

    for relative in (".claude/CLAUDE.md", ".codex/AGENTS.md"):
        link = machine.contract_link(relative)
        assert link.is_symlink()
        assert link.resolve() == install.CONTRACT.resolve()


def test_leaves_a_link_that_already_points_to_the_contract(machine):
    link = machine.contract_link(".claude/CLAUDE.md")
    link.parent.mkdir()
    link.symlink_to(install.CONTRACT)

    assert install.main([]) == 0

    assert link.resolve() == install.CONTRACT.resolve()
    assert machine.contract_link(".codex/AGENTS.md").is_symlink()


def test_links_probe_run_onto_the_path_and_keeps_an_existing_link(machine):
    link = machine.contract_link(".local/bin/probe-run")

    assert install.main([]) == 0
    assert install.main([]) == 0

    assert link.is_symlink()
    assert link.resolve() == install.PROBE_RUN.resolve()
    assert os.access(link, os.X_OK)


def test_warns_when_the_local_bin_directory_is_not_on_path(machine, capsys):
    assert install.main([]) == 0

    assert f"{machine.home / '.local' / 'bin'} is not on PATH" in capsys.readouterr().err


def test_stays_quiet_when_the_local_bin_directory_is_on_path(machine, monkeypatch, capsys):
    monkeypatch.setenv("PATH", f"{machine.bin}{os.pathsep}{machine.home / '.local' / 'bin'}")

    assert install.main([]) == 0

    assert "not on PATH" not in capsys.readouterr().err


@pytest.mark.parametrize("existing", ["regular-file", "link-elsewhere", "dangling-link"])
def test_stops_and_changes_nothing_when_a_contract_path_holds_something_else(
    machine, capsys, tmp_path, existing
):
    machine.install_provider("claude", CLAUDE_PRESENT)
    path = machine.contract_link(".codex/AGENTS.md")
    path.parent.mkdir()
    elsewhere = tmp_path / "elsewhere.md"
    if existing == "regular-file":
        path.write_text("mine")
    elif existing == "link-elsewhere":
        elsewhere.write_text("mine")
        path.symlink_to(elsewhere)
    else:
        path.symlink_to(elsewhere)

    assert install.main([]) == 1

    assert str(path) in capsys.readouterr().err
    assert machine.commands() == []
    assert not machine.contract_link(".claude/CLAUDE.md").exists()
    if existing == "regular-file":
        assert path.read_text() == "mine"
    else:
        assert path.readlink() == elsewhere


def test_waits_for_a_gap_between_codex_jobs_before_updating_codex(machine, codex_jobs, capsys):
    machine.install_provider("codex", CODEX_FROM_LOCAL)
    codex_jobs.polls = [jobs_named("1", "2", "3"), jobs_named("4"), []]

    assert install.main([]) == 0

    assert codex_jobs.pauses == [install.CODEX_POLL_SECONDS] * 2
    output = capsys.readouterr().out
    assert output.count("codex: waiting for a gap before updating: 1 (?, ?), 2 (?, ?), 3 (?, ?)") == 1
    assert output.count("codex: waiting for a gap before updating: 4 (?, ?)") == 1
    assert "codex plugin add atelier@atelier" in machine.commands()


def test_does_not_wait_for_codex_when_no_job_runs(machine, codex_jobs, capsys):
    machine.install_provider("codex", CODEX_FROM_LOCAL)

    assert install.main([]) == 0

    assert codex_jobs.pauses == []
    assert "waiting" not in capsys.readouterr().out


def test_does_not_wait_for_codex_jobs_when_only_claude_is_updated(machine, codex_jobs):
    machine.install_provider("claude", CLAUDE_PRESENT)
    codex_jobs.polls = [jobs_named("1")]

    assert install.main([]) == 0

    assert codex_jobs.pauses == []


FIND_CODEX_JOBS = install.find_codex_jobs  # the codex_jobs fixture replaces the module attribute


def jobs_named(*pids: str) -> list[install.CodexJob]:
    return [install.CodexJob(pid=pid, age_seconds=None, directory=None) for pid in pids]


def pids(jobs: list[install.CodexJob]) -> set[str]:
    return {job.pid for job in jobs}


def test_counts_only_processes_named_codex(tmp_path):
    for pid, name in {"11": "codex\n", "12": "python3\n", "13": "codex\n"}.items():
        (tmp_path / pid).mkdir()
        (tmp_path / pid / "comm").write_text(name)
    (tmp_path / "14").mkdir()
    (tmp_path / "14" / "comm").mkdir()  # reading fails like a process that just ended

    assert pids(install.find_codex_jobs(tmp_path)) == {"11", "13"}


def write_process(process_root: Path, pid: str, name: str, *arguments: str) -> None:
    (process_root / pid).mkdir()
    (process_root / pid / "comm").write_text(f"{name}\n")
    (process_root / pid / "cmdline").write_bytes(b"".join(f"{part}\0".encode() for part in (name, *arguments)))


def test_does_not_count_the_codex_app_server_daemon_as_a_job(tmp_path):
    write_process(tmp_path, "21", "codex", "app-server", "--listen", "stdio://")
    write_process(tmp_path, "22", "codex", "app-server", "daemon", "pid-update-loop")
    write_process(tmp_path, "23", "codex", "exec", "task")

    assert pids(install.find_codex_jobs(tmp_path)) == {"23"}


def test_finds_no_job_when_only_the_app_server_daemon_runs(tmp_path):
    write_process(tmp_path, "21", "codex", "app-server", "--listen", "stdio://")

    assert install.find_codex_jobs(tmp_path) == []


def test_counts_a_codex_process_whose_command_line_cannot_be_read(tmp_path):
    write_process(tmp_path, "21", "codex", "app-server")
    (tmp_path / "21" / "cmdline").unlink()
    (tmp_path / "21" / "cmdline").mkdir()

    assert pids(install.find_codex_jobs(tmp_path)) == {"21"}


def test_names_a_waited_for_job_with_its_pid_age_and_directory(tmp_path, machine, codex_jobs, capsys):
    ticks = os.sysconf("SC_CLK_TCK")
    write_process(tmp_path, "31", "codex", "exec", "task")
    (tmp_path / "31" / "stat").write_text(f"31 (codex) S {' '.join(['0'] * 18)} {1000 * ticks} 0 0\n")
    (tmp_path / "uptime").write_text(f"{1000 + 3 * 3600 + 18 * 60}.50 99.00\n")
    (tmp_path / "31" / "cwd").symlink_to("/work/hopin-worktrees/issue-253")
    jobs = FIND_CODEX_JOBS(tmp_path)
    machine.install_provider("codex", CODEX_FROM_LOCAL)
    codex_jobs.polls = [jobs, []]

    assert install.main([]) == 0

    assert "codex: waiting for a gap before updating: 31 (3h18m, /work/hopin-worktrees/issue-253)" in capsys.readouterr().out


def test_shows_a_question_mark_for_a_job_value_that_cannot_be_read(tmp_path):
    write_process(tmp_path, "41", "codex", "exec", "task")
    (tmp_path / "41" / "stat").mkdir()

    [job] = install.find_codex_jobs(tmp_path)

    assert install.describe_job(job) == "41 (?, ?)"


def test_updates_claude_before_waiting_for_a_gap_between_codex_jobs(machine, codex_jobs):
    machine.install_provider("codex", CODEX_FROM_LOCAL)
    machine.install_provider("claude", CLAUDE_PRESENT)
    codex_jobs.polls = [jobs_named("1", "2"), []]

    assert install.main([]) == 0

    assert codex_jobs.commands_at_pause[0][-1] == "claude plugin update atelier@atelier"
    assert not any(command.startswith("codex") for command in codex_jobs.commands_at_pause[0])


def test_pause_sleeps_for_the_given_seconds(monkeypatch):
    slept = []
    monkeypatch.setattr(install.time, "sleep", slept.append)

    install.pause(30)

    assert slept == [30]


@pytest.fixture
def shipped(machine, tmp_path, monkeypatch) -> Path:
    """A stand-in for the shipped settings file, which a test fills with the case under test."""
    file = tmp_path / "claude-managed.json"
    monkeypatch.setattr(install, "SHIPPED_SETTINGS", file)
    return file


def test_copies_the_shipped_settings_and_prints_the_one_time_sudo_step(machine, capsys):
    assert install.main([]) == 0

    assert machine.managed_copy.read_bytes() == install.SHIPPED_SETTINGS.read_bytes()
    output = capsys.readouterr().out
    assert f"sudo ln -sfn {machine.managed_copy} {machine.drop_in}" in output
    assert f"sudo rm {machine.drop_in}" in output


def test_refreshes_the_copy_and_stays_quiet_when_the_drop_in_links_the_copy(machine, capsys):
    machine.managed_copy.parent.mkdir(parents=True)
    machine.managed_copy.write_text("{}")
    machine.drop_in.parent.mkdir()
    machine.drop_in.symlink_to(machine.managed_copy)

    assert install.main([]) == 0

    assert machine.managed_copy.read_bytes() == install.SHIPPED_SETTINGS.read_bytes()
    assert "sudo" not in capsys.readouterr().out


def test_prints_the_sudo_step_again_when_the_drop_in_links_elsewhere(machine, tmp_path, capsys):
    machine.drop_in.parent.mkdir()
    machine.drop_in.symlink_to(tmp_path / "elsewhere.json")

    assert install.main([]) == 0

    assert f"sudo ln -sfn {machine.managed_copy} {machine.drop_in}" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("content", "problem"),
    [
        pytest.param("{not json", "cannot be read as JSON", id="malformed-json"),
        pytest.param(None, "cannot be read as JSON", id="file-missing"),
        pytest.param("[]", "is not a JSON object", id="not-an-object"),
        pytest.param('{"enabledPlugins": {}}', "enabledPlugins", id="unshipped-top-level-key"),
        pytest.param('{"env": {"HOME": "/tmp"}}', "env.HOME", id="unshipped-nested-key"),
        pytest.param('{"autoMode": ["allow"]}', "autoMode", id="owned-container-not-an-object"),
    ],
)
def test_fails_loud_and_keeps_the_previous_copy_when_the_shipped_settings_are_invalid(
    machine, shipped, capsys, content, problem
):
    machine.managed_copy.parent.mkdir(parents=True)
    machine.managed_copy.write_text("previous")
    user_text = '{"autoMode": {"allow": ["mine"]}}'
    machine.write_user_settings(user_text)
    if content is not None:
        shipped.write_text(content)

    assert install.main([]) == 1

    assert problem in capsys.readouterr().err
    assert machine.managed_copy.read_text() == "previous"
    assert machine.user_settings.read_text() == user_text
    assert machine.commands() == []


def test_removes_only_the_shipped_settings_from_the_user_file(machine, capsys):
    machine.write_user_settings(
        json.dumps(
            {
                "theme": "dark",
                "env": {"PYTEST_XDIST_AUTO_NUM_WORKERS": "2", "OTHER": "kept"},
                "autoMode": {"allow": ["mine"], "environment": ["private"]},
                "autoCompactEnabled": False,
                "hooks": {},
            }
        )
    )

    assert install.main([]) == 0

    assert json.loads(machine.user_settings.read_text()) == {
        "theme": "dark",
        "env": {"OTHER": "kept"},
        "autoMode": {"environment": ["private"]},
        "hooks": {},
    }
    assert "autoMode.allow" in capsys.readouterr().out


def test_writes_the_user_file_with_two_space_indentation_and_drops_a_container_it_emptied(machine):
    machine.write_user_settings('{"env": {"PYTEST_XDIST_AUTO_NUM_WORKERS": "2"}, "theme": "ünï"}')

    assert install.main([]) == 0

    assert machine.user_settings.read_text() == '{\n  "theme": "ünï"\n}\n'


def test_follows_a_user_file_link_and_keeps_its_mode(machine, tmp_path):
    real = tmp_path / "dotfiles-settings.json"
    real.write_text('{"autoCompactEnabled": true, "theme": "dark"}')
    real.chmod(0o600)
    machine.user_settings.parent.mkdir()
    machine.user_settings.symlink_to(real)

    assert install.main([]) == 0

    assert machine.user_settings.is_symlink()
    assert json.loads(real.read_text()) == {"theme": "dark"}
    assert real.stat().st_mode & 0o777 == 0o600
    assert sorted(path.name for path in tmp_path.iterdir() if path.name.startswith("dotfiles")) == ["dotfiles-settings.json"]


@pytest.mark.parametrize(
    "text",
    ['{"theme":"dark","env":{"OTHER":"x"}}', '{"env": "not an object", "autoMode": []}', "{}"],
    ids=["no-owned-key", "owned-containers-not-objects", "empty-object"],
)
def test_leaves_a_user_file_byte_for_byte_when_it_holds_no_shipped_setting(machine, text):
    machine.write_user_settings(text)

    assert install.main([]) == 0

    assert machine.user_settings.read_text() == text


def test_fails_loud_and_leaves_a_malformed_user_file_untouched(machine, capsys):
    machine.write_user_settings("{broken")

    assert install.main([]) == 1

    assert "settings.json cannot be read as JSON" in capsys.readouterr().err
    assert machine.user_settings.read_text() == "{broken"


def test_creates_no_user_file_when_there_is_none(machine):
    assert install.main([]) == 0

    assert not machine.user_settings.exists()


def test_prints_a_sudo_step_that_survives_a_home_with_spaces(machine, tmp_path, capsys):
    spaced_home = tmp_path / "home with spaces"

    install.install_managed_settings(spaced_home)

    ln_line = next(line for line in capsys.readouterr().out.splitlines() if "sudo ln" in line)
    operands = shlex.split(ln_line.split("&&", 1)[1])
    assert operands[-2:] == [str(spaced_home / install.MANAGED_SETTINGS_COPY), str(machine.drop_in)]


def test_leaves_a_file_beside_the_user_file_alone_whatever_its_name(machine, tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("keep")
    real = tmp_path / "dotfiles-settings.json"
    real.write_text('{"autoCompactEnabled": true}')
    machine.user_settings.parent.mkdir()
    machine.user_settings.symlink_to(real)
    (tmp_path / "dotfiles-settings.json.tmp").symlink_to(victim)

    assert install.main([]) == 0

    assert victim.read_text() == "keep"
    assert json.loads(real.read_text()) == {}


def test_leaves_no_temporary_file_and_keeps_the_target_when_the_replace_fails(tmp_path):
    target = tmp_path / "settings.json"
    target.mkdir()
    (target / "kept.txt").write_text("before")

    with pytest.raises(OSError):
        install.write_atomically(target, "after")

    assert (target / "kept.txt").read_text() == "before"
    assert [path.name for path in tmp_path.iterdir()] == ["settings.json"]


def test_shipped_settings_hold_no_machine_specific_path():
    shipped = install.SHIPPED_SETTINGS.read_text(encoding="utf-8")

    assert not re.search(r"/tmp/claude-\d+|/home/|/Users/", shipped)
