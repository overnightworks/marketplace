from __future__ import annotations

import json
from pathlib import Path

import pytest

from script_under_test import HOOKS_DIRECTORY, load_script


oom_first = load_script("oom_first", HOOKS_DIRECTORY)

SESSION_PID = 100
SHELL_PID = 200
HOOK_PID = 300
UNRELATED_PID = 400
DEFAULT_SCORE = "200"


def add_process(proc_root: Path, pid: int, parent: int) -> None:
    directory = proc_root / str(pid)
    directory.mkdir(parents=True)
    (directory / "status").write_text(f"Name:\tx\nPPid:\t{parent}\n")
    (directory / "oom_score_adj").write_text(DEFAULT_SCORE)


@pytest.fixture
def proc_root(tmp_path: Path) -> Path:
    """A fake /proc: the session, a shell layer and the hook below it, and a process outside that chain."""
    add_process(tmp_path, SESSION_PID, 1)
    add_process(tmp_path, SHELL_PID, SESSION_PID)
    add_process(tmp_path, HOOK_PID, SHELL_PID)
    add_process(tmp_path, UNRELATED_PID, 1)
    return tmp_path


def score_of(proc_root: Path, pid: int) -> str:
    return (proc_root / str(pid) / "oom_score_adj").read_text()


def run_hook(proc_root: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], claude_pid: str | None) -> str:
    if claude_pid is None:
        monkeypatch.delenv("CLAUDE_PID", raising=False)
    else:
        monkeypatch.setenv("CLAUDE_PID", claude_pid)
    oom_first.main(proc_root, HOOK_PID)
    return capsys.readouterr().out


def test_the_session_behind_a_shell_layer_gets_the_first_rank(proc_root, monkeypatch, capsys):
    printed = run_hook(proc_root, monkeypatch, capsys, str(SESSION_PID))

    assert score_of(proc_root, SESSION_PID) == "1000"
    assert score_of(proc_root, SHELL_PID) == DEFAULT_SCORE
    assert printed == ""


@pytest.mark.parametrize("claude_pid", [None, "not-a-pid", "999", str(UNRELATED_PID)], ids=["absent", "malformed", "unknown", "not-an-ancestor"])
def test_a_missing_or_foreign_session_pid_is_said_and_writes_nothing(proc_root, monkeypatch, capsys, claude_pid):
    printed = run_hook(proc_root, monkeypatch, capsys, claude_pid)

    assert "no session process found" in json.loads(printed)["systemMessage"]
    assert {score_of(proc_root, pid) for pid in (SESSION_PID, SHELL_PID, HOOK_PID, UNRELATED_PID)} == {DEFAULT_SCORE}


def test_a_refused_write_is_said(proc_root, monkeypatch, capsys):
    score_file = proc_root / str(SESSION_PID) / "oom_score_adj"
    score_file.unlink()
    score_file.mkdir()

    printed = run_hook(proc_root, monkeypatch, capsys, str(SESSION_PID))

    assert "failed" in json.loads(printed)["systemMessage"]


def test_a_process_chain_with_an_unreadable_link_is_said_and_writes_nothing(proc_root):
    vanished_pid = 555
    headless_pid = 556
    add_process(proc_root, vanished_pid, SESSION_PID)
    (proc_root / str(vanished_pid) / "status").unlink()
    add_process(proc_root, headless_pid, SESSION_PID)
    (proc_root / str(headless_pid) / "status").write_text("Name:\tx\n")

    failures = [oom_first.raise_score(proc_root, pid, str(SESSION_PID)) for pid in (vanished_pid, headless_pid)]

    assert all(failure and "no session process found" in failure for failure in failures)
    assert score_of(proc_root, SESSION_PID) == DEFAULT_SCORE
