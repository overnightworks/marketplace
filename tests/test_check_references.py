from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from script_under_test import load_script


check_references = load_script("check_references")

CONTRACT = """# Global contract

## How to work

- **Rulings bind, but not on faith.** Ruled sentences, specs and item
  bodies bind. Cases of one shape are *data* in the one owner.

## Code
"""
HEAD_CONTRACT = "## Lanes\n\n## Landing\n"


@pytest.fixture
def contract() -> dict:
    return {
        "AGENTS.md": check_references.parse_section(CONTRACT),
        "HEAD.md": check_references.parse_section(HEAD_CONTRACT),
    }


def problems_in(text: str, contract: dict) -> list[str]:
    return check_references.check_text("doc.md", text, contract, contract)


@pytest.mark.parametrize(
    "reference",
    [
        pytest.param('`instructions/AGENTS.md`, "How to work"', id="backticked-file-with-directory-and-quoted-heading"),
        pytest.param("instructions/HEAD.md, Lanes", id="plain-file-with-directory-and-plain-heading"),
        pytest.param("`AGENTS.md`, Rulings bind", id="bare-file-and-bold-lead-prefix"),
        pytest.param("`HEAD.md`: \"Lanes\", Trace before the claim", id="colon-separator-checks-the-first-quoted-target"),
        pytest.param('`instructions/HEAD.md`, sections "Lanes" and "Landing"', id="sections-list-of-two-quoted-names"),
        pytest.param("`instructions/HEAD.md`, sections\n  \"Lanes\" and \"Landing\"", id="reference-wrapped-over-a-line-break"),
        pytest.param("`AGENTS.md`, `README.md`", id="target-naming-another-file-is-no-reference"),
        pytest.param("AGENTS.md, for every agent", id="lower-case-description-is-no-reference"),
        pytest.param("`AGENTS.md`, Code ('Cases of one shape are data in the one owner')", id="quote-ignoring-emphasis"),
        pytest.param('`AGENTS.md`, Code ("Ruled sentences, specs and item\n bodies bind")', id="quote-ignoring-line-breaks"),
    ],
)
def test_resolving_reference_forms_raise_no_problem(reference: str, contract: dict) -> None:
    assert problems_in(f"See ({reference}) here.", contract) == []


@pytest.mark.parametrize(
    ("reference", "reason"),
    [
        pytest.param('`instructions/AGENTS.md`, "Missing part"', "has no section 'Missing part'", id="broken-quoted-heading"),
        pytest.param("HEAD.md, Landing zone", "has no section 'Landing zone'", id="broken-plain-heading"),
        pytest.param('HEAD.md, sections "Lanes" and "Gone"', "has no section 'Gone'", id="one-broken-name-in-a-sections-list"),
        pytest.param("`AGENTS.md`, Code ('A sentence nobody wrote')", "does not hold the quote 'A sentence nobody wrote'", id="misquoted-sentence"),
        pytest.param("OPERATORS.md, Anything", "OPERATORS.md is not in the checkout's root", id="bare-contract-file-missing-from-the-checkout"),
        pytest.param("instructions/OPERATORS.md, Anything", "OPERATORS.md is not in instructions/", id="contract-file-that-does-not-exist-yet"),
    ],
)
def test_broken_references_name_their_line_and_reason(reference: str, reason: str, contract: dict) -> None:
    found = problems_in(f"line one\nSee ({reference}).", contract)
    assert len(found) == 1
    assert found[0].startswith("doc.md:2: ")
    assert reason in found[0]


def test_bare_reference_in_another_checkout_resolves_against_its_own_file(contract: dict) -> None:
    local = {"AGENTS.md": check_references.parse_section("## Rules\n")}
    text = "(" + "AGENTS.md, Rules) and (" + "instructions/AGENTS.md, Rules)"
    assert check_references.check_text("doc.md", text, contract, local) == [
        "doc.md:1: AGENTS.md has no section 'Rules'"
    ]


def git_checkout(root: Path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text, encoding="utf-8")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    return root


def test_checkout_with_broken_heading_reference_fails_and_a_sound_one_passes(tmp_path: Path) -> None:
    contract_root = git_checkout(tmp_path / "contract", {"instructions/AGENTS.md": CONTRACT})
    sound = git_checkout(tmp_path / "sound", {"README.md": "(" + "instructions/AGENTS.md, Code)\n"})
    broken = git_checkout(tmp_path / "broken", {"README.md": "ok\n(" + "instructions/AGENTS.md, Gone)\n"})

    assert check_references.check_checkout(sound, contract_root) == []
    assert check_references.check_checkout(broken, contract_root) == [
        "README.md:2: AGENTS.md has no section 'Gone'"
    ]


def test_checkout_scan_skips_tracked_files_it_cannot_read_as_text(tmp_path: Path) -> None:
    contract_root = git_checkout(tmp_path / "contract", {"instructions/AGENTS.md": CONTRACT})
    checkout = git_checkout(tmp_path / "checkout", {"README.md": "ok\n", "gone.md": "x\n"})
    (checkout / "image.bin").write_bytes(b"\xff\xfe\x00")
    subprocess.run(["git", "-C", str(checkout), "add", "image.bin"], check=True)
    (checkout / "gone.md").unlink()

    assert check_references.check_checkout(checkout, contract_root) == []


def test_main_exits_one_on_a_problem_and_zero_on_a_clean_checkout(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    broken = git_checkout(tmp_path / "broken", {"README.md": "(" + "instructions/AGENTS.md, Gone)\n"})
    clean = git_checkout(tmp_path / "clean", {"README.md": "nothing\n"})

    assert check_references.main([str(broken)]) == 1
    assert "README.md:1" in capsys.readouterr().err
    assert check_references.main([str(clean)]) == 0
