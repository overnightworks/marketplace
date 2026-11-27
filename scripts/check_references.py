#!/usr/bin/env python3
"""The reference gate: every reference to a contract section or sentence must still resolve.

A reference is `(<contract file>, <target>)`: the file is a Markdown file of
`instructions/`, spelled with or without `instructions/` and backticks, and the target is a
section name, plain or in double quotes, or `sections "A" and "B"`. It resolves when the
contract file has a heading of that name or a paragraph whose bold lead starts with it. A
quote in single or double quotes right after the reference, as in
`(AGENTS.md`, a comma, a section name and then `('a sentence')`, resolves when the contract file holds it verbatim, line
breaks and Markdown emphasis ignored. A target that names another file is no reference.

The accepted forms are the patterns in TARGET_FORMS and QUOTE_FORM, so a new form is an
addition there. Known gap: a form they do not match is not checked, so a reference spelled in
prose, a bare section name with no contract file beside it, a plain target that starts in lower
case, a second or later target of a list that is not `sections "A" and "B"`, or a quote that does
not follow its reference directly passes unseen.

Usage: check_references.py [CHECKOUT]. A reference spelled with `instructions/` resolves against
this repository's contract; one spelled bare resolves against the contract here and against the
checkout's own root file in another checkout, where it means that repository's own AGENTS.md.
CHECKOUT (default: this repository) names a directory of the checkout whose tracked text files to scan.
"""
# ruff: noqa: T201 - the reference gate reports its findings

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DIRECTORY = "instructions"


# Each form captures the whole target text as `target`; the first matching form wins.
QUOTED = r'"[^"]+"'
TARGET_FORMS = (
    re.compile(rf"sections\s+(?P<target>{QUOTED}(?:\s*(?:,|and)\s*{QUOTED})*)"),
    re.compile(r"\"(?P<target>[^\"]+)\""),
    re.compile(r"(?P<target>[A-Z][^(),\"]*)"),
)
QUOTE_FORM = re.compile(r"\s*\(\s*(?P<mark>['\"])(?P<quote>.+?)(?P=mark)\s*\)", re.DOTALL)
QUOTED_NAME = re.compile(r"\"([^\"]+)\"")
FILE_NAME = re.compile(r"\.[a-z]{2,4}\b")
HEADING = re.compile(r"^#+[ \t]+(?P<name>\S.*)$", re.MULTILINE)
BOLD_LEAD = re.compile(r"^(?:[-*]\s+|\d+\.\s+)?\*\*(?P<name>.+?)\*\*", re.MULTILINE)
EMPHASIS = re.compile(r"[*_`]")


@dataclass(frozen=True)
class Reference:
    line: int
    file: str
    explicit: bool
    targets: tuple[str, ...]
    quote: str | None


@dataclass(frozen=True)
class Section:
    headings: frozenset[str]
    leads: tuple[str, ...]
    text: str


def reference_opening(names: Iterable[str]) -> re.Pattern[str]:
    files = "|".join(map(re.escape, sorted(names)))
    explicit = rf"{CONTRACT_DIRECTORY}/(?P<explicit_file>{files}|[A-Z][A-Z0-9_-]*\.md)"
    return re.compile(rf"\(\s*`?(?:(?P<explicit>{explicit})|(?P<file>{files}))`?\s*[,:]\s*")


def squeeze(text: str) -> str:
    return " ".join(EMPHASIS.sub("", text).split())


def parse_section(contract_text: str) -> Section:
    return Section(
        headings=frozenset(squeeze(match["name"]) for match in HEADING.finditer(contract_text)),
        leads=tuple(squeeze(match["name"]) for match in BOLD_LEAD.finditer(contract_text)),
        text=squeeze(contract_text),
    )


def parse_targets(text: str) -> tuple[tuple[str, ...], int] | None:
    for form in TARGET_FORMS:
        match = form.match(text)
        if match:
            target = match["target"]
            names = [squeeze(name) for name in QUOTED_NAME.findall(target) or [target]]
            return None if any(FILE_NAME.search(name) for name in names) else (tuple(names), match.end())
    return None


def find_references(text: str, contract_names: Iterable[str]) -> list[Reference]:
    references = []
    for opening in reference_opening(contract_names).finditer(text):
        rest = text[opening.end() :]
        parsed = parse_targets(rest)
        if parsed is None:
            continue
        targets, form_end = parsed
        quote = QUOTE_FORM.match(rest, form_end)
        references.append(
            Reference(
                line=text.count("\n", 0, opening.start()) + 1,
                file=opening["explicit_file"] or opening["file"],
                explicit=opening["explicit"] is not None,
                targets=targets,
                quote=squeeze(quote["quote"]) if quote else None,
            )
        )
    return references


def resolve(reference: Reference, contract: dict[str, Section], local: dict[str, Section]) -> list[str]:
    section = (contract if reference.explicit else local).get(reference.file)
    if section is None:
        side = f"{CONTRACT_DIRECTORY}/" if reference.explicit else "the checkout's root"
        return [f"{reference.file} is not in {side}"]
    problems = [
        f"{reference.file} has no section '{target}'"
        for target in reference.targets
        if target not in section.headings and not any(lead.startswith(target) for lead in section.leads)
    ]
    if reference.quote is not None and reference.quote not in section.text:
        problems.append(f"{reference.file} does not hold the quote '{reference.quote}'")
    return problems


def check_text(path: str, text: str, contract: dict[str, Section], local: dict[str, Section]) -> list[str]:
    return [
        f"{path}:{reference.line}: {problem}"
        for reference in find_references(text, contract)
        for problem in resolve(reference, contract, local)
    ]


def load_sections(paths: Iterable[Path]) -> dict[str, Section]:
    return {path.name: parse_section(path.read_text(encoding="utf-8")) for path in paths}


def git_output(directory: Path, *arguments: str) -> str:
    return subprocess.run(  # noqa: S603 - argv is fixed words
        ["git", *arguments],  # noqa: S607 - git is found on PATH
        cwd=directory,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def repository_root(directory: Path) -> Path:
    return Path(git_output(directory, "rev-parse", "--show-toplevel").strip())


def tracked_text_files(checkout: Path) -> list[Path]:
    return [checkout / name for name in git_output(checkout, "ls-files", "-z").split("\0") if name]


def check_checkout(checkout: Path, contract_root: Path = REPOSITORY_ROOT) -> list[str]:
    contract_directory = contract_root / CONTRACT_DIRECTORY
    contract = load_sections(sorted(contract_directory.glob("*.md")))
    if "AGENTS.md" not in contract:
        raise FileNotFoundError(f"{contract_directory} holds no AGENTS.md")
    if checkout.resolve() == contract_root.resolve():
        local = contract
    else:
        local_paths = [checkout / name for name in contract if (checkout / name).is_file()]
        local = load_sections(local_paths)
    problems = []
    for path in tracked_text_files(checkout):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        problems += check_text(str(path.relative_to(checkout)), text, contract, local)
    return problems


def main(arguments: list[str]) -> int:
    checkout = repository_root(Path(arguments[0])) if arguments else REPOSITORY_ROOT
    problems = check_checkout(checkout)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"reference check passed: {checkout}")
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point, no logic of its own
    raise SystemExit(main(sys.argv[1:]))
