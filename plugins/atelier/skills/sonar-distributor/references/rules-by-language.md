# Rules by language

Part of the sonar-distributor skill. Sections quoted by name ("API access", "Clean as You Code", the procedure) live in `../SKILL.md`.

## Python rules

Source: SonarCloud PR analysis, overnightworks/aco PR #116,
05.09.2026 (head 5884bdd, quality gate OK). `pythonsecurity:S8705` and
`python:S8786` carry no SonarCloud description text ("external rule, no
details available"), so this PR analysis is the only oracle for them.

Positive — cleared:
- `pythonsecurity:S8705` closed after routing the direct `gh` call through the
  validating client, `re.fullmatch(REPOSITORY_PATTERN, value)` at every
  repository guard, and an explicit `int(...)` / `_optional_issue_number`
  boundary in `main` for argparse-typed numbers.
- `python:S8786` closed for `FROZEN_LINE_PATTERN` by replacing
  `(?:>[ \t]*)*` with `(?:[ \t]{0,3}>)*[ \t]{0,3}`.
- `python:S8786` closed for `CLASSIFICATION_LINE_PATTERN` by capturing the
  value directly after the colon and trimming with `.strip(" \t")` in code.

Negative — tried and refused:
- A possessive quantifier did not clear `python:S8786` (tried in 0957f0d).
- The compiled-pattern method form `PATTERN.fullmatch(value)` was not accepted
  as validation — it brought the repository taint back in the analysis of
  4431370.
- Annotating a local with the expected type to satisfy `python:S5886` added
  `python:S5890` in the same PR analysis.
- The intermediate state `[ \t]*(?P<value>[^\r\n]*)$` with an `.rstrip()` was
  still flagged by `python:S8786`.

Analyzer coverage on test sources (measured overnightworks/aco #143/PR #145,
06.09.2026):
- `python:S1192` (duplicated string literal) does **not** run on test sources —
  a duplicated-literal probe placed in a test stays invisible to the gate.
- `python:S5778` (two raising calls inside one `pytest.raises` block) **does**
  run on test sources and is a reliable test-side probe finding.


## Shell rules

`shell:S8541` (package-manager command without `--no-build`) has no code route
in a packaged project, so it is class (b) there: `uv run --no-build` refuses to
install the workspace project itself — "can't be installed because it is marked
as `--no-build` but has no binary distribution" (uv 0.10.9, cold and warm
environment) — and the flag therefore blocks every command the project's own
code serves. A non-packaged project (`[tool.uv] package = false`) takes the flag,
and `uvx` keeps it legitimately because it installs no local project.
