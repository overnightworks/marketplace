from __future__ import annotations

import sys
from pathlib import Path

import pytest

from script_under_test import load_script


sync_agents_baseline = load_script("sync_agents_baseline")

PREAMBLE = """\
<!-- Seed template, generated. -->

Name the repository's entry points here.
"""
REPOSITORY_SPECIFIC_LINE = "`README.md` owns the plugin layout."
REUSABLE_LINE = "Reuse an existing owner before creating one."
POLICY = f"""\
<!-- baseline-skip-start: repository-specific -->
{REPOSITORY_SPECIFIC_LINE}
<!-- baseline-skip-end -->

## Growth

{REUSABLE_LINE}
"""


@pytest.fixture
def policy_repository(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A repository holding the policy and its preamble, with no baseline yet.

    The generator's paths are pinned to it so a test never writes into the
    repository it runs from, and `relative()` keeps resolving for messages.
    """
    (tmp_path / "scripts").mkdir()
    (tmp_path / "skill").mkdir()
    policy = tmp_path / "AGENTS.md"
    preamble = tmp_path / "scripts" / "agents_baseline_preamble.md"
    baseline = tmp_path / "skill" / "AGENTS.baseline.md"
    policy.write_text(POLICY, encoding="utf-8")
    preamble.write_text(PREAMBLE, encoding="utf-8")
    monkeypatch.setattr(sync_agents_baseline, "REPOSITORY_ROOT", tmp_path)
    monkeypatch.setattr(sync_agents_baseline, "POLICY_PATH", policy)
    monkeypatch.setattr(sync_agents_baseline, "PREAMBLE_PATH", preamble)
    monkeypatch.setattr(sync_agents_baseline, "BASELINE_PATH", baseline)
    monkeypatch.setattr(sys, "argv", ["sync_agents_baseline.py"])
    return tmp_path


def baseline_of(repository: Path) -> Path:
    return repository / "skill" / "AGENTS.baseline.md"


def check_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["sync_agents_baseline.py", "--check"])


def test_the_seed_carries_the_reusable_policy_under_the_seed_preamble(policy_repository: Path) -> None:
    assert sync_agents_baseline.main() == 0

    seed = baseline_of(policy_repository).read_text(encoding="utf-8")
    assert seed.startswith(PREAMBLE.rstrip())
    assert REUSABLE_LINE in seed


def test_the_seed_drops_what_the_policy_says_about_this_repository_alone(policy_repository: Path) -> None:
    """A seeded repository must not inherit the marketplace's own entry points."""
    sync_agents_baseline.main()

    seed = baseline_of(policy_repository).read_text(encoding="utf-8")
    assert REPOSITORY_SPECIFIC_LINE not in seed
    assert sync_agents_baseline.SKIP_START not in seed


def test_a_drifted_seed_is_rewritten_from_the_policy(policy_repository: Path) -> None:
    baseline_of(policy_repository).write_text("a hand-edited copy\n", encoding="utf-8")

    assert sync_agents_baseline.main() == 0
    assert REUSABLE_LINE in baseline_of(policy_repository).read_text(encoding="utf-8")


def test_the_check_names_the_drift_and_leaves_the_seed_alone(
    policy_repository: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """CI reads the exit code; a person reads the command that repairs it."""
    stale = "a hand-edited copy\n"
    baseline_of(policy_repository).write_text(stale, encoding="utf-8")
    check_argv(monkeypatch)

    assert sync_agents_baseline.main() == 1
    assert sync_agents_baseline.REGENERATE_COMMAND in capsys.readouterr().err
    assert baseline_of(policy_repository).read_text(encoding="utf-8") == stale


def test_the_check_passes_on_a_generated_seed(
    policy_repository: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sync_agents_baseline.main()
    check_argv(monkeypatch)

    assert sync_agents_baseline.main() == 0
    assert "in sync" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("policy", "complaint"),
    [
        ("<!-- baseline-skip-start -->\nrepository-specific\n", "leaves a baseline skip open"),
        ("<!-- baseline-skip-end -->\n", "closes a baseline skip that never opened"),
    ],
    ids=["unclosed region", "unopened region"],
)
def test_a_broken_skip_region_fails_loud(policy_repository: Path, policy: str, complaint: str) -> None:
    """A silently mis-parsed marker would seed the wrong text into every new repository."""
    (policy_repository / "AGENTS.md").write_text(policy, encoding="utf-8")

    with pytest.raises(SystemExit, match=complaint):
        sync_agents_baseline.main()
