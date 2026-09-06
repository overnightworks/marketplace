from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPOSITORY_ROOT / "scripts" / "sync_agents.py"


def _load_sync_agents_module():
    spec = importlib.util.spec_from_file_location("sync_agents_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


sync_agents = _load_sync_agents_module()


DEFAULT_FRONTMATTER_LINES = [
    "name: demo-agent",
    "",
    'description: "Demo agent for tests."',
]
DEFAULT_TOOLS = list(sync_agents.READ_TOOLS)
DEFAULT_METADATA = {
    "codex_name": "demo_agent",
    "codex_sandbox_mode": "read-only",
    "codex_model_reasoning_effort": "medium",
    "codex_nickname_candidates": ["Ada", "Grace"],
}
DEFAULT_INSTRUCTIONS = "Purpose:\n- Demonstrate the fixture agent."


def metadata_overrides(**overrides: object) -> dict[str, object]:
    merged = dict(DEFAULT_METADATA)
    merged.update(overrides)
    return merged


def metadata_without(*keys: str) -> dict[str, object]:
    return {key: value for key, value in DEFAULT_METADATA.items() if key not in keys}


def agent_markdown(
    *,
    frontmatter_lines: list[str] | None = None,
    tools: list[str] | str | None = None,
    metadata: dict[str, object] | None = None,
    metadata_raw: str | None = None,
    instructions: str | None = DEFAULT_INSTRUCTIONS,
) -> str:
    lines = ["---", *(DEFAULT_FRONTMATTER_LINES if frontmatter_lines is None else frontmatter_lines)]
    resolved_tools = DEFAULT_TOOLS if tools is None else tools
    if isinstance(resolved_tools, list):
        lines.append("tools:")
        lines.extend(f"  - {tool}" for tool in resolved_tools)
    else:
        lines.append(f"tools: {resolved_tools}")
    lines.append("---")
    lines.append("")
    if metadata_raw is not None:
        lines.append(metadata_raw)
    else:
        resolved_metadata = DEFAULT_METADATA if metadata is None else metadata
        lines.append(f"{sync_agents.METADATA_PREFIX}{json.dumps(resolved_metadata)}{sync_agents.METADATA_SUFFIX}")
    if instructions is not None:
        lines.append("")
        lines.append(instructions)
    return "\n".join(lines)


MALFORMED_AGENT_CASES = [
    (
        "missing_frontmatter_start",
        "No frontmatter marker here.\n",
        "must start with YAML frontmatter",
    ),
    (
        "missing_closing_marker",
        "---\nname: demo-agent\n",
        "is missing closing frontmatter marker",
    ),
    (
        "orphan_list_item",
        "---\nname: demo-agent\n  - orphan\n---\n\nbody",
        "has a list item without a key",
    ),
    (
        "line_without_colon",
        "---\nname: demo-agent\nno colon here\n---\n",
        "has unsupported frontmatter line",
    ),
    (
        "missing_name",
        agent_markdown(frontmatter_lines=['description: "Demo agent for tests."']),
        "frontmatter `name` must be a non-empty string",
    ),
    (
        "missing_description",
        agent_markdown(frontmatter_lines=["name: demo-agent"]),
        "frontmatter `description` must be a non-empty string",
    ),
    (
        "invalid_name_case",
        agent_markdown(frontmatter_lines=["name: Bad_Name", 'description: "Demo agent for tests."']),
        "must be lower hyphen-case",
    ),
    (
        "tools_not_list",
        agent_markdown(tools="Read"),
        "field `tools` must be a list of strings",
    ),
    (
        "missing_metadata_prefix",
        agent_markdown(metadata_raw=""),
        f"must include an `{sync_agents.METADATA_PREFIX.strip()}` metadata comment",
    ),
    (
        "unterminated_metadata",
        agent_markdown(
            metadata_raw=f'{sync_agents.METADATA_PREFIX}{{"codex_name": "demo_agent"}}',
            instructions=None,
        ),
        "has an unterminated metadata comment",
    ),
    (
        "invalid_metadata_json",
        agent_markdown(metadata_raw=f"{sync_agents.METADATA_PREFIX}{{not json}}{sync_agents.METADATA_SUFFIX}"),
        "has invalid agent metadata JSON",
    ),
    (
        "metadata_not_object",
        agent_markdown(
            metadata_raw=f'{sync_agents.METADATA_PREFIX}["a", "list"]{sync_agents.METADATA_SUFFIX}'
        ),
        "metadata must be a JSON object",
    ),
    (
        "missing_instructions",
        agent_markdown(instructions=None),
        "must include agent instructions after metadata",
    ),
    (
        "missing_codex_name",
        agent_markdown(metadata=metadata_without("codex_name")),
        "metadata `codex_name` must be a non-empty string",
    ),
    (
        "missing_sandbox_mode",
        agent_markdown(metadata=metadata_without("codex_sandbox_mode")),
        "metadata `codex_sandbox_mode` must be a non-empty string",
    ),
    (
        "missing_reasoning_effort",
        agent_markdown(metadata=metadata_without("codex_model_reasoning_effort")),
        "metadata `codex_model_reasoning_effort` must be a non-empty string",
    ),
    (
        "invalid_nickname_candidates",
        agent_markdown(metadata=metadata_overrides(codex_nickname_candidates=["Ada", 5])),
        "metadata `codex_nickname_candidates` must be strings",
    ),
    (
        "name_mismatch",
        agent_markdown(metadata=metadata_overrides(codex_name="other_agent")),
        "name mismatch: frontmatter name",
    ),
    (
        "tools_sandbox_mismatch",
        agent_markdown(tools=list(sync_agents.WRITE_TOOLS)),
        "do not match sandbox mode",
    ),
    (
        "unsupported_sandbox_mode",
        agent_markdown(metadata=metadata_overrides(codex_sandbox_mode="sandboxed")),
        "Unsupported codex_sandbox_mode",
    ),
]


@pytest.fixture
def agent_tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    source_dir = tmp_path / "agents"
    target_dir = tmp_path / "codex-agents"
    source_dir.mkdir()
    monkeypatch.setattr(sync_agents, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(sync_agents, "SOURCE_DIR", source_dir)
    monkeypatch.setattr(sync_agents, "CODEX_TARGET_DIR", target_dir)
    return source_dir, target_dir


def write_source_agent(source_dir: Path, markdown_text: str, filename: str = "demo-agent.md") -> None:
    (source_dir / filename).write_text(markdown_text, encoding="utf-8")


def run_main(monkeypatch: pytest.MonkeyPatch, *args: str) -> int:
    monkeypatch.setattr(sys, "argv", ["sync_agents.py", *args])
    return sync_agents.main()


@pytest.mark.parametrize(
    ("case_id", "markdown_text", "expected_fragment"),
    MALFORMED_AGENT_CASES,
    ids=[case[0] for case in MALFORMED_AGENT_CASES],
)
def test_main_rejects_malformed_agent_source(
    agent_tree: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
    case_id: str,
    markdown_text: str,
    expected_fragment: str,
) -> None:
    source_dir, _ = agent_tree
    write_source_agent(source_dir, markdown_text)
    monkeypatch.setattr(sys, "argv", ["sync_agents.py"])

    with pytest.raises(SystemExit) as excinfo:
        sync_agents.main()

    assert expected_fragment in str(excinfo.value)


def test_main_rejects_empty_source_directory(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "argv", ["sync_agents.py"])

    with pytest.raises(SystemExit) as excinfo:
        sync_agents.main()

    assert "No source agents found in" in str(excinfo.value)


def test_generation_mode_writes_expected_codex_files(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    write_source_agent(
        source_dir,
        agent_markdown(
            frontmatter_lines=["name: demo-writer", 'description: "Demo writer agent."'],
            tools=list(sync_agents.WRITE_TOOLS),
            metadata=metadata_overrides(codex_name="demo_writer", codex_sandbox_mode="workspace-write"),
        ),
        filename="demo-writer.md",
    )

    exit_code = run_main(monkeypatch)
    output = capsys.readouterr().out

    assert exit_code == 0
    assert "Synced Codex agent translations:" in output

    read_only_toml = (target_dir / "demo-agent.toml").read_text(encoding="utf-8")
    assert sync_agents.GENERATED_MARKER in read_only_toml
    assert 'sandbox_mode = "read-only"' in read_only_toml

    write_toml = (target_dir / "demo-writer.toml").read_text(encoding="utf-8")
    assert 'sandbox_mode = "workspace-write"' in write_toml


def test_generation_mode_second_run_reports_already_in_sync(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, _ = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()

    exit_code = run_main(monkeypatch)
    output = capsys.readouterr().out

    assert exit_code == 0
    assert output.strip() == "Generated Codex agents already in sync."


def test_check_mode_reports_in_sync_when_generated_files_current(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, _ = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()

    exit_code = run_main(monkeypatch, "--check")
    output = capsys.readouterr().out

    assert exit_code == 0
    assert output.strip() == "Generated Codex agents are in sync."


def test_check_mode_detects_drift_without_writing(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()
    generated_path = target_dir / "demo-agent.toml"
    original_content = generated_path.read_text(encoding="utf-8")

    write_source_agent(
        source_dir,
        agent_markdown(frontmatter_lines=["name: demo-agent", "", 'description: "Updated description."']),
    )

    exit_code = run_main(monkeypatch, "--check")
    error_output = capsys.readouterr().err

    assert exit_code == 1
    assert "Generated Codex agents are out of sync." in error_output
    assert f"- update required: {sync_agents.relative(generated_path)}" in error_output
    assert generated_path.read_text(encoding="utf-8") == original_content


def test_generation_mode_removes_stale_generated_file_and_reports_it(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    target_dir.mkdir(parents=True)
    stale_path = target_dir / "ghost-agent.toml"
    stale_path.write_text(
        f"{sync_agents.GENERATED_MARKER}old-source.md. Do not edit by hand.\n", encoding="utf-8"
    )

    exit_code = run_main(monkeypatch)
    output = capsys.readouterr().out

    assert exit_code == 0
    assert not stale_path.exists()
    assert f"- {sync_agents.relative(stale_path)}" in output


def test_check_mode_reports_stale_generated_file_without_removing(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()
    stale_path = target_dir / "ghost-agent.toml"
    stale_path.write_text(
        f"{sync_agents.GENERATED_MARKER}old-source.md. Do not edit by hand.\n", encoding="utf-8"
    )

    exit_code = run_main(monkeypatch, "--check")
    error_output = capsys.readouterr().err

    assert exit_code == 1
    assert f"- stale generated file: {sync_agents.relative(stale_path)}" in error_output
    assert stale_path.exists()


def test_stale_detection_ignores_hand_authored_toml_without_marker(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()
    hand_authored = target_dir / "hand-authored.toml"
    hand_authored.write_text('name = "hand-authored"\n', encoding="utf-8")

    exit_code = run_main(monkeypatch, "--check")
    output = capsys.readouterr().out

    assert exit_code == 0
    assert output.strip() == "Generated Codex agents are in sync."
    assert hand_authored.exists()


def test_stale_detection_skips_unreadable_entries(
    agent_tree: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    source_dir, target_dir = agent_tree
    write_source_agent(source_dir, agent_markdown())
    run_main(monkeypatch)
    capsys.readouterr()
    dangling_symlink = target_dir / "dangling.toml"
    dangling_symlink.symlink_to(target_dir / "does-not-exist.toml")

    exit_code = run_main(monkeypatch, "--check")
    output = capsys.readouterr().out

    assert exit_code == 0
    assert output.strip() == "Generated Codex agents are in sync."
    assert dangling_symlink.is_symlink()
