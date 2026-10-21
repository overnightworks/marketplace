from __future__ import annotations

import json
import sys
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


@pytest.fixture
def machine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Machine:
    return Machine(tmp_path, monkeypatch)


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

    assert not any(command.startswith("claude") for command in machine.commands())
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
