from __future__ import annotations

from pathlib import Path

import pytest

from script_under_test import load_script


check_skills = load_script("check_skills")

VALID_FRONTMATTER = "name: sample\ndescription: Does a sample job. Use when sampling."


def write_skill(
    root: Path,
    name: str = "sample",
    frontmatter: str = VALID_FRONTMATTER,
    body: str = "Body.\n",
    document: str | None = None,
) -> Path:
    directory = root / "plugins" / "atelier" / "skills" / name
    directory.mkdir(parents=True)
    text = document if document is not None else f"---\n{frontmatter}\n---\n{body}"
    (directory / "SKILL.md").write_text(text, encoding="utf-8")
    return directory


def lines(count: int) -> str:
    return "line\n" * count


@pytest.mark.parametrize(
    ("frontmatter", "body", "problems"),
    [
        (VALID_FRONTMATTER, "Body.\n", ()),
        (VALID_FRONTMATTER + "\nversion: 2", "Body.\n", ("sample: frontmatter field 'version' is not a known field",)),
        ("name: sample\ndescription: [a, b]", "Body.\n", ("sample: unsupported value for frontmatter field 'description': '[a, b]'",)),
        ("name: sample\n  description: indented", "Body.\n", ("sample: unsupported frontmatter line '  description: indented'",)),
        ("name: Sample_1\ndescription: ok", "Body.\n", ("sample: name 'Sample_1' does not match [a-z0-9-]{1,64}", "sample: name 'Sample_1' differs from its directory 'sample'")),
        ("name: " + "a" * 65 + "\ndescription: ok", "Body.\n", (f"sample: name '{'a' * 65}' does not match [a-z0-9-]{{1,64}}", f"sample: name '{'a' * 65}' differs from its directory 'sample'")),
        ("name: claude-helper\ndescription: ok", "Body.\n", ("sample: name 'claude-helper' contains the reserved word 'claude'", "sample: name 'claude-helper' differs from its directory 'sample'")),
        ("name: anthropic-helper\ndescription: ok", "Body.\n", ("sample: name 'anthropic-helper' contains the reserved word 'anthropic'", "sample: name 'anthropic-helper' differs from its directory 'sample'")),
        ("name: other\ndescription: ok", "Body.\n", ("sample: name 'other' differs from its directory 'sample'",)),
        ("name: sample\ndescription:", "Body.\n", ("sample: unsupported value for frontmatter field 'description': ''",)),
        ("name: sample\ndescription: >-", "Body.\n", ("sample: description is empty",)),
        ("name: sample\ndescription: " + "d" * 1025, "Body.\n", ("sample: description has 1025 characters > 1024",)),
        ("name: sample\ndescription: Use <b>bold text", "Body.\n", ("sample: description contains the XML tag '<b>'",)),
        (VALID_FRONTMATTER, "See [the guide](references/guide.md).\n", ("sample: link 'references/guide.md' does not resolve to a file",)),
        (VALID_FRONTMATTER, "```\n[x](references/none.md)\n```\n~~~\n[y](references/none.md)\n~~~\n", ()),
        (VALID_FRONTMATTER, "```\ncode\n```\nSee [the guide](references/guide.md).\n", ("sample: link 'references/guide.md' does not resolve to a file",)),
        ("name: sample\ndescription: >-\n  First half\n  second half.\nlicense: MIT", "Body.\n", ()),
        (VALID_FRONTMATTER, "See [web](https://example.com/a) and [here](#top) and `references/none.md`.\n", ()),
    ],
    ids=[
        "valid skill",
        "unknown field",
        "flow sequence value",
        "indented line outside a folded block",
        "name with a forbidden character",
        "name over 64 characters",
        "name with claude",
        "name with anthropic",
        "name differing from the directory",
        "empty plain description",
        "empty folded description",
        "description over 1024 characters",
        "description with an XML tag",
        "broken relative link",
        "links inside fenced blocks",
        "link after a closed fenced block",
        "folded description followed by another field",
        "web link, anchor and inline code path",
    ],
)
def test_each_skill_rule_names_the_skill_and_the_value(
    tmp_path: Path, frontmatter: str, body: str, problems: tuple[str, ...]
) -> None:
    write_skill(tmp_path, frontmatter=frontmatter, body=body)

    report = check_skills.check_skills(tmp_path)

    assert report == problems


def test_a_folded_description_and_an_existing_relative_link_pass(tmp_path: Path) -> None:
    directory = write_skill(
        tmp_path,
        frontmatter="name: sample\ndescription: >-\n  First half\n  second half.",
        body="See [the guide](references/guide.md#part).\n",
    )
    (directory / "references").mkdir()
    (directory / "references" / "guide.md").write_text("guide\n", encoding="utf-8")

    assert check_skills.check_skills(tmp_path) == ()


def test_a_skill_name_may_start_with_a_digit(tmp_path: Path) -> None:
    write_skill(tmp_path, name="1sample", frontmatter=VALID_FRONTMATTER.replace("name: sample", "name: 1sample"))

    assert check_skills.check_skills(tmp_path) == ()


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("name: sample\n", "frontmatter must start with a '---' line"),
        ("---\nname: sample\n", "frontmatter has no closing '---' line"),
        ("---\nname: a\nname: b\n---\n", "frontmatter field 'name' appears twice"),
    ],
    ids=["no opening fence", "no closing fence", "duplicate field"],
)
def test_malformed_frontmatter_fails_loudly(tmp_path: Path, text: str, problem: str) -> None:
    write_skill(tmp_path, document=text)

    assert check_skills.check_skills(tmp_path) == (f"sample: {problem}",)


@pytest.mark.parametrize(
    ("body_lines", "problems"),
    [
        (500, ()),
        (501, ("sample: body has 501 lines > 500; split the skill",)),
    ],
    ids=["at the limit", "one line over"],
)
def test_a_skill_body_over_500_lines_fails_with_a_request_to_split_it(
    tmp_path: Path, body_lines: int, problems: tuple[str, ...]
) -> None:
    write_skill(tmp_path, body=lines(body_lines))

    assert check_skills.check_skills(tmp_path) == problems


@pytest.fixture
def repository_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(check_skills, "REPOSITORY_ROOT", tmp_path)
    return tmp_path


def test_the_command_passes_a_clean_tree(repository_root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    write_skill(repository_root)

    assert check_skills.main() == 0
    assert "skill check passed: 1 skills" in capsys.readouterr().out


def test_the_command_exits_non_zero_and_names_the_failure(
    repository_root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write_skill(repository_root, frontmatter="name: other\ndescription: ok")

    assert check_skills.main() == 1
    assert "sample: name 'other' differs from its directory 'sample'" in capsys.readouterr().err


def test_every_skill_of_this_repository_passes() -> None:
    assert check_skills.check_skills(check_skills.REPOSITORY_ROOT) == ()
