from __future__ import annotations

import json
from pathlib import Path

import pytest

from script_under_test import REPOSITORY_ROOT

MANIFESTS = {
    "claude-marketplace": Path(".claude-plugin/marketplace.json"),
    "claude-plugin": Path("plugins/atelier/.claude-plugin/plugin.json"),
    "codex-plugin": Path("plugins/atelier/.codex-plugin/plugin.json"),
}


def declared_versions(manifest: dict) -> list[str]:
    entries = [manifest, *manifest.get("plugins", [])]
    return [entry["version"] for entry in entries if "version" in entry]


@pytest.mark.parametrize("path", MANIFESTS.values(), ids=MANIFESTS.keys())
def test_manifest_carries_no_version(path: Path) -> None:
    manifest = json.loads((REPOSITORY_ROOT / path).read_text(encoding="utf-8"))

    assert declared_versions(manifest) == [], (
        f"{path} pins a version, which freezes Claude Code updates at it"
    )
