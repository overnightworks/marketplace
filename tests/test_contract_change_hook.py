from __future__ import annotations

import io
import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from script_under_test import HOOKS_DIRECTORY, load_script


contract_change = load_script("contract_change", HOOKS_DIRECTORY)

DELEGATED_LINE = "Fixture brief opener: do only this brief."
CONTRACT_MARKER = "secret-contract-marker"


def contract_text(rule: str = "rule one") -> str:
    return (
        "# Contract\n\n## Head or helper\n\nWho is who.\n\n"
        "> Fixture brief opener:\n> do only this brief.\n\n"
        f"## Rules\n\n{CONTRACT_MARKER} {rule}\n"
    )


class Machine:
    """A temporary home whose contract link points into a temporary git checkout."""

    def __init__(self, root: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
        self.root = root
        self.monkeypatch = monkeypatch
        self.capsys = capsys
        self.home = root / "home"
        self.checkout = root / "checkout"
        self.data = root / "data"
        (self.home / ".claude").mkdir(parents=True)
        (self.checkout / "instructions").mkdir(parents=True)
        monkeypatch.setenv("HOME", str(self.home))
        monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(self.data))
        monkeypatch.setenv("GIT_AUTHOR_NAME", "Fixture")
        monkeypatch.setenv("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
        monkeypatch.setenv("GIT_COMMITTER_NAME", "Fixture")
        monkeypatch.setenv("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
        monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
        self.git("init", "-q", "-b", "main")
        self.commit({"AGENTS.md": contract_text(), "HEAD.md": "head rule one\n"}, "Start the contract")
        self.link_contract()

    @property
    def instructions(self) -> Path:
        return self.checkout / "instructions"

    @property
    def state_files(self) -> list[Path]:
        return sorted(self.data.rglob("*.json"))

    def git(self, *arguments: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.checkout), *arguments], capture_output=True, text=True, check=True
        ).stdout.strip()

    def commit(self, files: dict[str, str], subject: str) -> None:
        for name, text in files.items():
            (self.instructions / name).write_text(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", subject)

    def link_contract(self, target: Path | None = None) -> None:
        link = self.home / ".claude" / "CLAUDE.md"
        link.unlink(missing_ok=True)
        link.symlink_to(target or self.instructions / "AGENTS.md")

    def fire(self, event: str, session: str = "head-session", **fields: object) -> str:
        """Run the hook once as the host does and return the context it injected, or an empty string."""
        payload = {"session_id": session, "hook_event_name": event, **fields}
        self.monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
        contract_change.main()
        printed = self.capsys.readouterr().out
        if not printed:
            return ""
        output = json.loads(printed)["hookSpecificOutput"]
        assert output["hookEventName"] == event
        return output["additionalContext"]

    def start(self, session: str = "head-session", source: str = "startup") -> str:
        return self.fire("SessionStart", session, source=source)

    def prompt(self, text: str = "Work on the board.", session: str = "head-session", **fields: object) -> str:
        return self.fire("UserPromptSubmit", session, prompt=text, **fields)

    def batch(self, session: str = "head-session", **fields: object) -> str:
        return self.fire("PostToolBatch", session, **fields)

    def running_head(self, session: str = "head-session") -> None:
        self.start(session)
        assert self.prompt(session=session) == ""


@pytest.fixture
def machine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> Machine:
    return Machine(tmp_path, monkeypatch, capsys)


def read_events(machine: Machine) -> dict[str, object]:
    return {"prompt": machine.prompt, "batch": machine.batch}


@pytest.mark.parametrize("event", ["prompt", "batch"])
@pytest.mark.parametrize("file_name", ["AGENTS.md", "HEAD.md"])
def test_running_head_gets_the_diff_and_the_subject_of_a_changed_contract_file(
    machine: Machine, event: str, file_name: str
) -> None:
    machine.running_head()
    machine.commit({file_name: "a changed line\n"}, "Tighten the changed rule")

    hint = read_events(machine)[event]()

    assert file_name in hint
    assert "+a changed line" in hint
    assert "Tighten the changed rule" in hint


@pytest.mark.parametrize("event", ["prompt", "batch"])
def test_hook_prints_nothing_while_the_contract_is_unchanged(machine: Machine, event: str) -> None:
    machine.running_head()

    assert read_events(machine)[event]() == ""


def test_a_commit_that_leaves_both_contract_files_alone_prints_nothing(machine: Machine) -> None:
    machine.running_head()
    (machine.checkout / "README.md").write_text("elsewhere\n")
    machine.git("add", "-A")
    machine.git("commit", "-q", "-m", "Change something else")

    assert machine.batch() == ""


@pytest.mark.parametrize(
    "helper_event",
    [
        lambda machine: machine.batch("shared-session", agent_id="agent-1"),
        lambda machine: machine.prompt(session="shared-session", agent_id="agent-1"),
    ],
    ids=["subagent batch", "subagent prompt"],
)
def test_a_subagent_gets_nothing_and_leaves_the_head_baseline_alone(machine: Machine, helper_event) -> None:
    machine.running_head("shared-session")
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert helper_event(machine) == ""
    assert "+" + CONTRACT_MARKER + " rule two" in machine.batch("shared-session")


@pytest.mark.parametrize(
    "first_prompt",
    [
        DELEGATED_LINE + " Build item 1.",
        "Fixture brief opener:\n   do  only this\tbrief.\nBuild item 1.",
    ],
    ids=["exact", "whitespace differs"],
)
def test_a_session_whose_first_prompt_opens_with_the_delegated_line_gets_nothing(
    machine: Machine, first_prompt: str
) -> None:
    machine.start("helper-session")
    assert machine.prompt(first_prompt, "helper-session") == ""
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert machine.batch("helper-session") == ""
    assert machine.prompt("More work.", "helper-session") == ""


def test_a_resumed_head_keeps_its_role_and_only_moves_the_baseline(machine: Machine) -> None:
    machine.running_head()
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change while away")

    assert machine.start(source="resume") == ""
    assert machine.batch() == ""
    machine.commit({"AGENTS.md": contract_text("rule three")}, "Change after resume")
    hint = machine.batch()

    assert "Change after resume" in hint
    assert "Change while away" not in hint


def test_a_resumed_helper_stays_a_helper(machine: Machine) -> None:
    machine.start("helper-session")
    machine.prompt(DELEGATED_LINE, "helper-session")
    machine.start("helper-session", source="resume")
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert machine.prompt("Continue.", "helper-session") == ""


def test_a_session_with_no_role_hears_nothing_until_its_first_prompt_decides(machine: Machine) -> None:
    machine.start()
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert machine.batch() == ""
    assert "Change the rule" in machine.prompt()


def test_a_session_with_no_state_file_takes_a_new_baseline_silently(machine: Machine) -> None:
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change before the hook saw the session")

    assert machine.prompt() == ""
    machine.commit({"AGENTS.md": contract_text("rule three")}, "Change after the baseline")
    assert "Change after the baseline" in machine.batch()


def test_an_unreadable_state_file_means_a_new_baseline_silently(machine: Machine) -> None:
    machine.running_head()
    machine.state_files[0].write_text("{not json")
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert machine.batch() == ""
    assert json.loads(machine.state_files[0].read_text())["role"] is None


@pytest.mark.parametrize("event", ["prompt", "batch"])
def test_compaction_does_nothing(machine: Machine, event: str) -> None:
    machine.running_head()
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert machine.start(source="compact") == ""
    assert "Change the rule" in read_events(machine)[event]()


def test_a_change_is_told_once_and_the_next_change_only_by_its_own_lines(machine: Machine) -> None:
    machine.running_head()
    machine.commit({"AGENTS.md": contract_text("rule two")}, "First change")
    assert "First change" in machine.batch()
    assert machine.batch() == ""

    machine.commit({"AGENTS.md": contract_text("rule three")}, "Second change")
    hint = machine.batch()

    assert "Second change" in hint
    assert "First change" not in hint


def test_a_hint_over_the_host_limit_gives_the_subjects_and_the_command_that_shows_the_diff(
    machine: Machine,
) -> None:
    machine.running_head()
    machine.commit({"AGENTS.md": contract_text("long\n" * 4000)}, "Rewrite the whole contract")

    hint = machine.batch()

    assert len(hint) <= 10_000
    assert "Rewrite the whole contract" in hint
    assert f"git -C {machine.instructions} diff" in hint
    assert "+long" not in hint


def test_uncommitted_edits_are_never_told(machine: Machine) -> None:
    machine.running_head()
    (machine.instructions / "AGENTS.md").write_text(contract_text("edited but not committed"))

    assert machine.batch() == ""


def test_an_unfinished_merge_is_never_told(machine: Machine) -> None:
    machine.running_head()
    machine.git("checkout", "-q", "-b", "side")
    machine.commit({"AGENTS.md": contract_text("side rule")}, "Side change")
    machine.git("checkout", "-q", "main")
    machine.commit({"AGENTS.md": contract_text("main rule")}, "Main change")
    machine.start(source="resume")
    subprocess.run(["git", "-C", str(machine.checkout), "merge", "side"], capture_output=True, check=False)

    assert (machine.checkout / ".git" / "MERGE_HEAD").exists()
    assert machine.batch() == ""


def test_a_checkout_moved_to_a_commit_without_the_old_one_says_so_and_gives_the_blob_diff(
    machine: Machine,
) -> None:
    machine.running_head()
    machine.git("checkout", "-q", "--orphan", "unrelated")
    machine.commit({"AGENTS.md": contract_text("unrelated rule")}, "Unrelated history")

    hint = machine.batch()

    assert "without" in hint
    assert "+" + CONTRACT_MARKER + " unrelated rule" in hint
    assert "Unrelated history" not in hint


def test_a_missing_or_regular_contract_file_keeps_the_hook_silent(machine: Machine) -> None:
    machine.running_head()
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")
    link = machine.home / ".claude" / "CLAUDE.md"
    link.unlink()
    assert machine.batch() == ""

    link.write_text("a regular file\n")
    assert machine.batch() == ""
    assert machine.state_files[0].exists()


def break_the_link(machine: Machine) -> None:
    machine.link_contract(machine.root / "missing" / "AGENTS.md")


def link_another_file_name(machine: Machine) -> None:
    machine.link_contract(machine.instructions / "HEAD.md")


def link_outside_a_work_tree(machine: Machine) -> None:
    plain = machine.root / "plain"
    plain.mkdir()
    (plain / "AGENTS.md").write_text(contract_text())
    machine.link_contract(plain / "AGENTS.md")


def drop_the_delegated_line(machine: Machine) -> None:
    (machine.instructions / "AGENTS.md").write_text("# Contract without the section\n")


@pytest.mark.parametrize(
    "break_contract",
    [break_the_link, link_another_file_name, link_outside_a_work_tree, drop_the_delegated_line],
)
def test_a_failed_contract_lookup_gives_one_line_once_per_session(machine: Machine, break_contract) -> None:
    machine.start()
    break_contract(machine)

    first = machine.prompt()
    second = machine.batch()

    assert first != ""
    assert "\n" not in first
    assert second == ""


def test_a_second_distinct_failure_is_told_again(machine: Machine) -> None:
    machine.running_head()
    break_the_link(machine)
    broken = machine.batch()
    link_another_file_name(machine)

    assert broken != ""
    assert machine.batch() not in {"", broken}


def test_a_recovered_contract_takes_a_new_baseline_after_a_failure(machine: Machine) -> None:
    machine.running_head()
    break_the_link(machine)
    assert machine.batch() != ""
    machine.link_contract()
    assert machine.batch() == ""
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")

    assert "Change the rule" in machine.batch()


def test_state_holds_one_file_per_session_with_no_contract_text(machine: Machine) -> None:
    machine.running_head("first-session")
    machine.running_head("second-session")
    machine.commit({"AGENTS.md": contract_text("rule two")}, "Change the rule")
    machine.batch("first-session")

    files = machine.state_files
    assert sorted(file.stem for file in files) == ["first-session", "second-session"]
    assert all(CONTRACT_MARKER not in file.read_text() for file in files)
    assert all("Change the rule" not in file.read_text() for file in files)
    assert sorted(path.name for path in machine.data.rglob("*") if path.is_file()) == [
        "first-session.json",
        "second-session.json",
    ]


@pytest.mark.parametrize("session", ["../escape", "nested/session", ".."])
def test_a_session_id_that_is_not_a_plain_name_is_refused_and_writes_nothing(
    machine: Machine, session: str
) -> None:
    with pytest.raises(ValueError):
        machine.start(session)

    assert machine.state_files == []


def test_a_session_start_prunes_only_state_untouched_for_seven_days(machine: Machine) -> None:
    machine.running_head("old-session")
    machine.running_head("recent-session")
    stale = time.time() - 8 * 24 * 3600
    old_file = next(file for file in machine.state_files if file.stem == "old-session")
    os.utime(old_file, (stale, stale))

    machine.start("new-session")

    assert sorted(file.stem for file in machine.state_files) == ["new-session", "recent-session"]
