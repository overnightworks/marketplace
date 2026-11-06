#!/usr/bin/env python3
"""The skill gate: the rules a machine can check on every plugin skill.

A skill is the text an agent loads to do a job, so a malformed one fails
silently: an unknown frontmatter field is ignored, a broken link sends the
agent to a file that is not there, and an oversize body costs context on every
load. The rules come from the Claude Code skills documentation and the Agent
Skills best practices; the gate holds them where review would otherwise have to
remember them.

The body limit is a fixed 500 lines, the operator's standard for every skill.

The frontmatter reader knows exactly two forms, `key: value` and a folded `>-`
block, because those are the forms the skills use and a YAML dependency would
cost more than it removes. Anything else fails loudly instead of being guessed.
"""
# ruff: noqa: T201 - the skill gate reports its findings

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SKILL_PATTERN = "plugins/*/skills/*/SKILL.md"

KNOWN_FIELDS = frozenset(
    {
        "name",
        "description",
        "when_to_use",
        "license",
        "compatibility",
        "metadata",
        "allowed-tools",
        "disable-model-invocation",
        "argument-hint",
        "model",
    }
)
# Skill names follow the Agent Skills name limits: lowercase letters, digits, hyphens, 64 characters; a digit may come first, unlike agent names.
SKILL_NAME_PATTERN = re.compile(r"[a-z0-9-]{1,64}")
RESERVED_NAME_WORDS = ("anthropic", "claude")
DESCRIPTION_LIMIT = 1024
BODY_LINE_LIMIT = 500

FRONTMATTER_FENCE = "---"
FOLDED_BLOCK_MARKER = ">-"
FIELD_LINE = re.compile(r"(?P<key>[A-Za-z][A-Za-z0-9_-]*):(?: (?P<value>.*))?")
UNSUPPORTED_VALUE_START = ('"', "'", "[", "{", "|", ">", "&", "*", "!")
XML_TAG = re.compile(r"</?[A-Za-z][^>]*>")
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\((?P<target>[^)\s]+)\)")
CODE_FENCE_MARKERS = ("```", "~~~")
URL_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")


class FrontmatterError(ValueError):
    pass


@dataclass(frozen=True)
class Skill:
    name: str
    directory: Path
    frontmatter: dict[str, str]
    body: str

    @property
    def body_line_count(self) -> int:
        return len(self.body.splitlines())


def split_frontmatter(text: str) -> tuple[list[str], str]:
    lines = text.splitlines()
    if not lines or lines[0] != FRONTMATTER_FENCE:
        raise FrontmatterError(f"frontmatter must start with a '{FRONTMATTER_FENCE}' line")
    try:
        closing = lines.index(FRONTMATTER_FENCE, 1)
    except ValueError:
        raise FrontmatterError(f"frontmatter has no closing '{FRONTMATTER_FENCE}' line") from None
    return lines[1:closing], "\n".join(lines[closing + 1 :])


def read_frontmatter(lines: list[str]) -> dict[str, str]:
    """Read `key: value` lines and folded `>-` blocks; refuse every other form."""
    fields: dict[str, str] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        match = FIELD_LINE.fullmatch(line)
        if match is None:
            raise FrontmatterError(f"unsupported frontmatter line {line!r}")
        key, value = match["key"], match["value"] or ""
        if key in fields:
            raise FrontmatterError(f"frontmatter field {key!r} appears twice")
        if value == FOLDED_BLOCK_MARKER:
            folded = []
            while index < len(lines) and lines[index].startswith(" "):
                folded.append(lines[index].strip())
                index += 1
            value = " ".join(folded)
        elif not value or value.startswith(UNSUPPORTED_VALUE_START):
            raise FrontmatterError(f"unsupported value for frontmatter field {key!r}: {value!r}")
        fields[key] = value
    return fields


def parse_skill(skill_file: Path) -> Skill:
    lines, body = split_frontmatter(skill_file.read_text(encoding="utf-8"))
    return Skill(skill_file.parent.name, skill_file.parent, read_frontmatter(lines), body)


def frontmatter_problems(skill: Skill) -> list[str]:
    return [
        f"{skill.name}: frontmatter field {field!r} is not a known field"
        for field in skill.frontmatter
        if field not in KNOWN_FIELDS
    ]


def name_problems(skill: Skill) -> list[str]:
    declared = skill.frontmatter.get("name", "")
    problems = []
    if not SKILL_NAME_PATTERN.fullmatch(declared):
        problems.append(f"{skill.name}: name {declared!r} does not match {SKILL_NAME_PATTERN.pattern}")
    for word in RESERVED_NAME_WORDS:
        if word in declared:
            problems.append(f"{skill.name}: name {declared!r} contains the reserved word {word!r}")
    if declared != skill.name:
        problems.append(f"{skill.name}: name {declared!r} differs from its directory {skill.name!r}")
    return problems


def description_problems(skill: Skill) -> list[str]:
    description = skill.frontmatter.get("description", "")
    problems = []
    if not description.strip():
        problems.append(f"{skill.name}: description is empty")
    if len(description) > DESCRIPTION_LIMIT:
        problems.append(f"{skill.name}: description has {len(description)} characters > {DESCRIPTION_LIMIT}")
    for tag in XML_TAG.findall(description):
        problems.append(f"{skill.name}: description contains the XML tag {tag!r}")
    return problems


def is_relative_file_link(target: str) -> bool:
    return not target.startswith("#") and URL_SCHEME.match(target) is None


def text_outside_code_fences(body: str) -> str:
    prose, inside_fence = [], False
    for line in body.splitlines():
        if line.lstrip().startswith(CODE_FENCE_MARKERS):
            inside_fence = not inside_fence
        elif not inside_fence:
            prose.append(line)
    return "\n".join(prose)


def link_problems(skill: Skill) -> list[str]:
    problems = []
    for match in MARKDOWN_LINK.finditer(text_outside_code_fences(skill.body)):
        target = match["target"]
        if is_relative_file_link(target) and not (skill.directory / target.partition("#")[0]).exists():
            problems.append(f"{skill.name}: link {target!r} does not resolve to a file")
    return problems


def skill_problems(skill: Skill) -> list[str]:
    return (
        frontmatter_problems(skill)
        + name_problems(skill)
        + description_problems(skill)
        + link_problems(skill)
        + size_problems(skill)
    )


def size_problems(skill: Skill) -> list[str]:
    if skill.body_line_count <= BODY_LINE_LIMIT:
        return []
    return [f"{skill.name}: body has {skill.body_line_count} lines > {BODY_LINE_LIMIT}; split the skill"]


def skill_files(repository_root: Path) -> list[Path]:
    return sorted(repository_root.glob(SKILL_PATTERN))


def check_skills(repository_root: Path) -> tuple[str, ...]:
    problems: list[str] = []
    for skill_file in skill_files(repository_root):
        try:
            skill = parse_skill(skill_file)
        except FrontmatterError as error:
            problems.append(f"{skill_file.parent.name}: {error}")
            continue
        problems.extend(skill_problems(skill))
    return tuple(problems)


def main() -> int:
    problems = check_skills(REPOSITORY_ROOT)
    if problems:
        print("skill check failed:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    print(f"skill check passed: {len(skill_files(REPOSITORY_ROOT))} skills")
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main())
