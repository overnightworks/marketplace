from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from script_under_test import load_script


check_root_layout = load_script("check_root_layout")

ALLOWLIST = check_root_layout.REPOSITORY_ALLOWLIST
GATE = Path(check_root_layout.__file__).resolve()


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
def allowlisted_repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A git repository the gate is happy with, installed as the gate's own root.

    Its files are committed, because tracked and untracked paths reach the gate
    through separate git calls and a fixture that only writes would leave the
    tracked half unasserted.

    The git configuration is pinned to the null device for this test and every
    process it starts: the gate asks git which untracked files are ignored, so
    a machine-wide ignore matching a probe file would otherwise turn a red path
    green on that machine only.
    """
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)
    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / "README.md").write_text("a repository the gate is happy with\n", encoding="utf-8")
    (repository / ".gitignore").write_text(".coverage\n", encoding="utf-8")
    subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True, capture_output=True)
    commit_everything(repository, "the allowlisted tree")
    monkeypatch.setattr(check_root_layout, "REPOSITORY_ROOT", repository)
    return repository


def test_the_gate_passes_on_an_allowlisted_tree(
    allowlisted_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert check_root_layout.main() == 0
    assert "passed" in capsys.readouterr().out


def test_the_gate_leaves_a_root_file_git_ignores_alone(
    allowlisted_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A coverage run drops .coverage at the root; the gate judges the tree, not the workspace."""
    (allowlisted_repository / ".coverage").write_text("a build artefact\n", encoding="utf-8")

    assert check_root_layout.main() == 0
    assert "passed" in capsys.readouterr().out


@pytest.mark.parametrize("working_directory", [".", ".."], ids=["from the repository", "from elsewhere"])
def test_the_gate_names_a_stray_root_file_and_fails(
    allowlisted_repository: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    working_directory: str,
) -> None:
    """The gate judges the repository that carries it, whatever the caller's cwd."""
    (allowlisted_repository / "NOTES.md").write_text("a stray at the root\n", encoding="utf-8")
    monkeypatch.chdir(allowlisted_repository / working_directory)

    assert check_root_layout.main() == 1
    assert "NOTES.md" in capsys.readouterr().err


def test_the_gate_names_a_committed_stray_root_file(
    allowlisted_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A stray that already landed is as red as one that never was tracked."""
    (allowlisted_repository / "sync_agents.py").write_text("the helper left at the root\n", encoding="utf-8")
    commit_everything(allowlisted_repository, "a stray at the root")

    assert check_root_layout.main() == 1
    assert "sync_agents.py" in capsys.readouterr().err


def test_the_gate_names_a_tracked_symlink_and_fails(
    allowlisted_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A link inside the payload breaks the checkout of every consumer of the published action."""
    payload = allowlisted_repository / "plugins" / "atelier" / "bin"
    payload.mkdir(parents=True)
    (payload / "uv").symlink_to("/home/somebody/.local/bin/uv")
    commit_everything(allowlisted_repository, "a tracked symlink")

    assert check_root_layout.main() == 1
    error = capsys.readouterr().err
    assert "plugins/atelier/bin/uv" in error
    assert "unextractable" in error


def test_the_gate_leaves_a_regular_file_in_the_payload_alone(
    allowlisted_repository: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = allowlisted_repository / "plugins" / "atelier" / "bin"
    payload.mkdir(parents=True)
    (payload / "uv").write_text("the content itself\n", encoding="utf-8")
    commit_everything(allowlisted_repository, "a regular file in the payload")

    assert check_root_layout.main() == 0
    assert "passed" in capsys.readouterr().out


def test_the_gate_exits_non_zero_as_a_command(allowlisted_repository: Path) -> None:
    """CI runs the gate as a script, so its exit code is the contract."""
    (allowlisted_repository / "stray.txt").write_text("a stray at the root\n", encoding="utf-8")
    (allowlisted_repository / "scripts").mkdir()
    shutil.copy(GATE, allowlisted_repository / "scripts" / GATE.name)

    completed = subprocess.run(
        [sys.executable, str(allowlisted_repository / "scripts" / GATE.name)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1
    assert "stray.txt" in completed.stderr


def test_every_entry_the_layout_rule_admits_at_the_root_is_accepted() -> None:
    """The names are spelled out, so narrowing the allowlist cannot pass unnoticed.

    Three of them are admissions the tree does not exercise: `HEART.md` is the
    entry document this repository does not carry yet, and a Python toolchain
    would bring `pyproject.toml` with its lockfile.
    """
    listing = [
        ".gitignore",
        "AGENTS.md",
        "CLAUDE.md",
        "HEART.md",
        "LICENSE",
        "README.md",
        "pyproject.toml",
        "sonar-project.properties",
        "uv.lock",
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        ".github/workflows/ci.yml",
        "instructions/AGENTS.md",
        "plugins/atelier/skills/agent-documentation/SKILL.md",
        "scripts/check_root_layout.py",
        "tests/test_check_root_layout.py",
    ]

    assert check_root_layout.root_layout_problems(listing, ALLOWLIST) == ()


@pytest.mark.parametrize(
    ("stray", "problem"),
    [
        ("NOTES.md", "NOTES.md: a document belongs next to its owner"),
        ("sync_agents.py", "sync_agents.py: a helper belongs under scripts/"),
        (
            "marketplace.json",
            "marketplace.json: the root holds only what a tool must find there; "
            "a file lives in the directory of its owner",
        ),
    ],
)
def test_a_stray_root_file_is_named_with_the_sentence_where_it_belongs(stray: str, problem: str) -> None:
    """The sentence is spelled out, because it is what the person reading CI acts on."""
    problems = check_root_layout.root_layout_problems(["README.md", stray], ALLOWLIST)

    assert problems == (problem,)


def test_a_stray_root_directory_is_named_with_the_sentence_where_it_belongs() -> None:
    problems = check_root_layout.root_layout_problems(["README.md", "tooling/helper.py"], ALLOWLIST)

    assert problems == (
        "tooling/: a new top-level directory needs a named owner and an entry in "
        "scripts/check_root_layout.py",
    )


def test_only_the_symlink_mode_is_named_among_tracked_entries() -> None:
    entries = check_root_layout.parse_tracked_entries(
        [
            "100644 0000000000000000000000000000000000000000 0\tREADME.md",
            "100755 0000000000000000000000000000000000000000 0\tplugins/atelier/hooks/pre_commit_gate.sh",
            "120000 0000000000000000000000000000000000000000 0\tplugins/atelier/bin/uv",
        ]
    )

    assert check_root_layout.tracked_symlink_problems(entries) == (
        "plugins/atelier/bin/uv: a tracked symlink makes this repository unextractable for "
        "every consumer of its published action, because `uses:` checks the whole repository "
        "out; commit the content",
    )
