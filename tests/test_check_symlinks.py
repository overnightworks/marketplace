from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from script_under_test import load_script


check_symlinks = load_script("check_symlinks")
GATE = Path(check_symlinks.__file__).resolve()


def commit_everything(repository: Path, message: str) -> None:
    """Track what the tree holds, so the gate reads it as a tracked path.

    The identity is passed per command because the fixture pins the git
    configuration to the null device; a machine's user.name never reaches here.
    """
    subprocess.run(["git", "add", "--all"], cwd=repository, check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=layout gate test",
            "-c",
            "user.email=gate@example.invalid",
            "commit",
            "--quiet",
            "--message",
            message,
        ],
        cwd=repository,
        check=True,
        capture_output=True,
    )


@pytest.fixture
def clean_repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A git repository the gate is happy with, installed as the gate's own root.

    Its files are committed, because the gate reads tracked entries and a fixture
    that only writes would leave them unasserted.

    The git configuration is pinned to the null device for this test and every
    process it starts, so a machine's git settings never decide the outcome.
    """
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)
    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / "README.md").write_text("a repository the gate is happy with\n", encoding="utf-8")
    subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True, capture_output=True)
    commit_everything(repository, "the clean tree")
    monkeypatch.setattr(check_symlinks, "REPOSITORY_ROOT", repository)
    return repository


def test_the_gate_passes_on_a_clean_tree(
    clean_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert check_symlinks.main() == 0
    assert "passed" in capsys.readouterr().out


def test_the_gate_names_a_tracked_symlink_and_fails(
    clean_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A link inside the payload breaks the checkout of every consumer of the published action."""
    payload = clean_repository / "plugins" / "atelier" / "bin"
    payload.mkdir(parents=True)
    (payload / "uv").symlink_to("/home/somebody/.local/bin/uv")
    commit_everything(clean_repository, "a tracked symlink")

    assert check_symlinks.main() == 1
    error = capsys.readouterr().err
    assert "plugins/atelier/bin/uv" in error
    assert "unextractable" in error


def test_the_gate_leaves_a_regular_file_in_the_payload_alone(
    clean_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = clean_repository / "plugins" / "atelier" / "bin"
    payload.mkdir(parents=True)
    (payload / "uv").write_text("the content itself\n", encoding="utf-8")
    commit_everything(clean_repository, "a regular file in the payload")

    assert check_symlinks.main() == 0
    assert "passed" in capsys.readouterr().out


def test_the_gate_exits_non_zero_as_a_command(clean_repository: Path) -> None:
    """CI runs the gate as a script, so its exit code is the contract."""
    link = clean_repository / "link"
    link.symlink_to("/home/somebody/.local/bin/uv")
    commit_everything(clean_repository, "a tracked symlink")
    (clean_repository / "scripts").mkdir()
    shutil.copy(GATE, clean_repository / "scripts" / GATE.name)

    completed = subprocess.run(
        [sys.executable, str(clean_repository / "scripts" / GATE.name)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1
    assert "link: " in completed.stderr


def test_only_the_symlink_mode_is_named_among_tracked_entries() -> None:
    entries = check_symlinks.parse_tracked_entries(
        [
            "100644 0000000000000000000000000000000000000000 0\tREADME.md",
            "100755 0000000000000000000000000000000000000000 0\tplugins/atelier/hooks/pre_commit_gate.sh",
            "120000 0000000000000000000000000000000000000000 0\tplugins/atelier/bin/uv",
        ]
    )

    assert check_symlinks.tracked_symlink_problems(entries) == (
        "plugins/atelier/bin/uv: a tracked symlink makes this repository unextractable for "
        "every consumer of its published action, because `uses:` checks the whole repository "
        "out; commit the content",
    )
