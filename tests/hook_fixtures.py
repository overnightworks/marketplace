"""Arrangement the hook tests and the fake-command tests share: a contract, the delegated line, a hook driver and fake executables."""

from __future__ import annotations

import io
import json
from pathlib import Path
from types import ModuleType

import pytest

DELEGATED_LINE = "Fixture brief opener: do only this brief."
CONTRACT_MARKER = "secret-contract-marker"


def contract_text(rule: str = "rule one") -> str:
    return (
        "# Contract\n\n## Head or helper\n\nWho is who.\n\n"
        "> Fixture brief opener:\n> do only this brief.\n\n"
        f"## Rules\n\n{CONTRACT_MARKER} {rule}\n"
    )


def fire_hook(
    hook: ModuleType, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], event: str, session: str, **fields: object
) -> str:
    """Run the hook once as the host does and return the context it injected, or an empty string."""
    payload = {"session_id": session, "hook_event_name": event, **fields}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    hook.main()
    printed = capsys.readouterr().out
    if not printed:
        return ""
    output = json.loads(printed)["hookSpecificOutput"]
    assert output["hookEventName"] == event
    return output["additionalContext"]


def install_fake(bin_directory: Path, name: str, script: str) -> None:
    fake = bin_directory / name
    fake.write_text(script)
    fake.chmod(0o755)
