---
name: sonar-distributor
description: Turn a repository's SonarCloud and CodeQL findings into exactly ONE distributor issue with the findings classified and sliced — never a fix-by-fix march and never an item flood. Use when asked what Sonar or CodeQL reports for a repository, when a repository is newly onboarded to SonarCloud or CodeQL default setup, when a quality gate or a security alert needs triage, and on the scheduled agent audit cadence (weekly). Read-only against the code; the run produces one issue, its class table, and its slices.
---

Classify findings by class, never by count. A scanner reports symptoms across a
whole tree at once; the cheap win is one exclusion or one versioned exception
that retires a whole class, and the expensive loss is a lane per finding. **This
skill reads scanners and writes one issue; it changes no source file.** Every
repository of the operator is on SonarCloud (Free plan, public projects,
organisation `overnightworks`, project keys `overnightworks_<repo>`) and on CodeQL default
setup (operator ruling 04.09.2026).

## Analysis mode

SonarCloud runs exactly one analysis mode per project. A repository whose CI
carries the scanner (`SonarSource/sonarqube-scan-action` with `SONAR_TOKEN`,
coverage reports fed) has Automatic Analysis OFF; a repository without a CI
scanner keeps Automatic Analysis ON. Both on at once makes every CI scan fail
with a conflict, and both off means no analysis. Check and set it through the
API, never by hand in the UI: `GET
https://sonarcloud.io/api/navigation/component?component=<org>_<repo>` reads
the `autoscanEnabled` field; `POST
https://sonarcloud.io/api/autoscan/activation` (form fields `projectKey`,
`enable=true|false`) sets it, with the token from the operator's configured
SonarCloud credential, never printed. Automatic Analysis ignores
`sonar-project.properties`; a repository that needs an exclusion or a
rule-level exception moves to the CI scanner first. State of 05.09.2026 in
`overnightworks`: CI scanner and Automatic Analysis off — `atelier-2`,
`agent-claim`, `hopin`, `songmaker`; Automatic Analysis on — `marketplace`,
`claude-revive`.

## Procedure

1. **Pull the numbers.** `SONAR_TOKEN` carries the operator's SonarCloud
   credential, never printed; an unauthenticated pull is unsafe for the reason
   under "API access" below. The credential travels in the header, as basic
   auth with the token as user name and an empty password, so it stays out of
   the process list:

   ```bash
   key=overnightworks_<repo>
   auth="Authorization: Basic $(printf '%s:' "$SONAR_TOKEN" | base64 -w0)"
   curl -s -H "$auth" "https://sonarcloud.io/api/components/show?component=$key"
   curl -s -H "$auth" "https://sonarcloud.io/api/measures/component?component=$key&metricKeys=ncloc,bugs,vulnerabilities,security_hotspots,code_smells,duplicated_lines_density,duplicated_blocks,cognitive_complexity,reliability_rating,security_rating,sqale_rating"
   curl -s -H "$auth" "https://sonarcloud.io/api/issues/search?componentKeys=$key&issueStatuses=OPEN,CONFIRMED,ACCEPTED,FALSE_POSITIVE&ps=500&p=1"
   gh api repos/<owner>/<repo>/code-scanning/alerts --paginate
   ```

   The first call proves the key resolved; a pull that skips it can report a
   clean repository it never reached.

   Page the issue search until you have `total` issues (`ps` maxes at 500).
   Then group the result twice — by `rule` and by top-level directory of
   `component`. Those two groupings are the whole triage: a rule with dozens of
   hits is one decision, not dozens.
2. **Classify every group** into the four classes below. A group belongs to
   exactly one class, and each class has one named action and one owner.
3. **Write ONE distributor issue** per repository (search the board first —
   `gh issue list --search` over open and recently closed — and sharpen an
   existing distributor rather than opening a twin).
4. **Cut slices** in corridor size, one owner each, and dispatch them one at a
   time from the distributor. A finding becomes its own issue only when it is
   dispatched.
5. **Re-measure main after every landing** while the distributor is open — the
   default quality gate does not (measured agent-claim #143/PR #145,
   06.09.2026: three green-merged landings added 16 findings on main
   unnoticed).

## The four classes

Illustrated with the first atelier-2 run (04.09.2026, 131 open Sonar issues)
and the 05.09.2026 measurement PR (PR overnightworks/agent-claim#116).

- **(a) Noise an exclusion removes** — mockups, vendored assets, generated
  artefacts, fixtures: trees the rules were never written for. Action: one
  `sonar-project.properties` with `sonar.exclusions`; a code change, so it is a
  slice. *Example: 52 of 131 findings sat in `docs/`, 35 of them accessibility
  smells (`Web:S6853`) in the single mockup file
  `docs/requirements/0003-ziel-ui-mockup-v8.html`.*
- **(b) Tried and refused** — a finding whose code route was tried and
  measured; the PR's own SonarCloud analysis is the instrument, never a guess.
  The fix failed, or fixing it is judged counterproductive. This skill never
  assigns (b) from a scan; a finding enters (b) only from a (d) slice whose PR
  analysis proves the route failed, and the head records that judgement on the
  distributor before the builder versions the exception. Action: a
  **builder** versions the exception in the repository, next to its reason —
  never a SonarCloud UI won't-fix, never a file-wide ignore that hides future
  hits. A rule-level `sonar.issue.ignore.multicriteria` entry in
  `sonar-project.properties` only when a stronger owner is named and
  scheduled to take the check over; until that owner's gate
  is in CI, the entry carries the item number, and a builder must not copy the
  pattern for a rule without such a named, scheduled owner. For a single
  finding the mechanism is a rule-specific marker on the line —
  `# NOSONAR(S8786) reason`, never a bare `# NOSONAR`, which silences every
  rule on the line. The reason is written next to the entry and on the
  distributor. *Example: `python:S5886`/`S5890` — the rule-level entry in
  `sonar-project.properties` is allowed because pyright (#114, a planned CI
  gate) is named and scheduled as the stronger owner for type consistency; the
  entry carries `#114` next to it until that gate is actually in CI.*
- **(c) Frozen code** — code built ahead of its caller (AGENTS.md rule: frozen,
  not deleted; no hardening, no new tests). Action: the finding **stays open**,
  named against the item that will delete or pull that code, so the scanner
  stops being asked the question the board already owns. *Example:
  `pythonsecurity:S8707` in `src/atelier2/adapters/docker_carrier.py:925`.*
- **(d) Real and small** — the scanner is right and the fix is cheap. Action:
  one slice per owning module; the first (d) slice is the measurement; the
  rest are cut after it. *Example:
  `python:S5863`, six self-comparing assertions under `tests/domain/`.*

## Results: what the SonarCloud analyzers accept

### Marker grammar

- The rule key in a marker is bare — `# NOSONAR(S7503) reason`. A
  `language:`-prefixed key is not parsed as a key: the prefixed form raised
  `python:S7632` ("Fix the syntax of this issue suppression comment.") three
  times in overnightworks/hopin PR #8 and left `python:S7503` open, where the
  repository's own zero-findings step caught it; the bare form cleared both.
- The shell analyzer honours the same `# NOSONAR(<key>) reason` grammar —
  measured in this repository's PR #24 on
  `plugins/atelier/hooks/pre_commit_gate.sh`, where the marker took
  `shell:S8541` out of the PR analysis.

### API access

An anonymous `api/issues/search` against a **private** SonarCloud project
answers HTTP 200 with `total: 0` and no `errors` field — a response nothing can
tell apart from a genuinely clean project (measured 06.09.2026 on
`overnightworks_claudebot`: anonymous 0, authenticated 12). A tokenless gate on
a private project therefore never goes red: the repository reads clean forever
while its findings pile up. Checking the visibility first does not rescue it,
because that probe is blind without a token too — anonymous
`api/navigation/component` and `api/components/show` both answer 404 "Project
doesn't exist" for the same project. SonarCloud also auto-creates a project as
private when the GitHub repository is private, so a repository arrives in this
state without anyone choosing it. The rule is therefore not endpoint-specific:
**a query that answered about nothing must never read as clean.**

So the gate step and every pull **authenticate always** and prove the component
resolved before reading a zero as clean: `api/components/show?component=<key>`
returns the component and its key when authorized. An `errors` field, a missing
component, or a key differing from `sonar.projectKey` fails the step by name.
`api/issues/search` cannot carry that assertion itself — its `components` array
is empty for an authenticated clean project as well.

Every query asks for `issueStatuses=OPEN,CONFIRMED,ACCEPTED,FALSE_POSITIVE`,
never the legacy `statuses` parameter, whose vocabulary drops an issue a person
accepts or marks false positive in the UI — a finding still in the code that no
query sees. The two holes compound, so the two fixes ship together: an
authenticated gate still querying `statuses=OPEN` is blind in exactly that way,
and a reader who repairs only the authentication is not done.

The measurement that produced this, 06.09.2026 in `overnightworks`: private
SonarCloud projects — `marketplace` (behind a public GitHub repository),
`claudebot`, `gmail-cleanup`; public — `hopin`, `agent-claim`, `atelier-2`,
`songmaker`, `agent-presentator`. A repository's SonarCloud visibility is its
own; the GitHub repository's says nothing about it.

### Quality gate scope

On the free plan a project cannot be given a custom quality gate:
`api/qualitygates/select` answers 403 (measured 06.09.2026). The server-side
gate is the built-in one, which judges new code only, so any stronger floor is
the repository's own tooling — a coverage fail-under, a findings query, or
both.
A distributor run reads a green build as evidence only after checking which of
those the repository actually has.

What each repository asserted on 06.09.2026: `marketplace` and `hopin` run the
zero-findings query; `claudebot` and `gmail-cleanup` carry the step but it
self-skips while they are private without a token, leaving Automatic Analysis as
their only measurement; `agent-claim` and `atelier-2` are repairing their step
under their own items; `songmaker` scans with `continue-on-error` and asserts
nothing about main; `agent-presentator` scans only, against the server gate,
and its floor is a 100 % coverage fail-under plus Vitest thresholds.

### Python rules

Source: SonarCloud PR analysis, overnightworks/agent-claim PR #116,
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

Analyzer coverage on test sources (measured agent-claim #143/PR #145,
06.09.2026):
- `python:S1192` (duplicated string literal) does **not** run on test sources —
  a duplicated-literal probe placed in a test stays invisible to the gate.
- `python:S5778` (two raising calls inside one `pytest.raises` block) **does**
  run on test sources and is a reliable test-side probe finding.

### Shell rules

`shell:S8541` (package-manager command without `--no-build`) has no code route
in a packaged project, so it is class (b) there: `uv run --no-build` refuses to
install the workspace project itself — "can't be installed because it is marked
as `--no-build` but has no binary distribution" (uv 0.10.9, cold and warm
environment) — and the flag therefore blocks every command the project's own
code serves. A non-packaged project (`[tool.uv] package = false`) takes the flag,
and `uvx` keeps it legitimately because it installs no local project. A hook or
script whose tests stub the package manager proves nothing about this: green
checks are not evidence, the real invocation is.

## The distributor issue

One issue, this shape:

```text
Metrics: ncloc <n> | bugs <n> | vulnerabilities <n> | hotspots <n> |
         smells <n> | duplication <n>% (<n> blocks) | ratings R<x>/S<x>/M<x>
         + CodeQL open alerts <n>              (pulled <date>)

| Class | Rules | Count | Example (file:line) | Action | Owner |
```

Below the table: the slices in corridor size with their done-when, and the
standing rulings, which every review of a Sonar finding inherits:

- The quality gate applies to **new code only** ("Clean as You Code"). The
  rating of the legacy is never chased; a legacy rating of D is a measurement,
  not a defect list.
- SonarCloud and CodeQL are **not required checks** until a measurement week
  has compared them against the repository's own gates. Until then, a gate red
  on a finding whose code route was tried and refused (its exception lands in
  the same PR) is not a merge blocker; a gate red on a finding whose code
  route was never tried is one: try the code route first (operator ruling
  05.09.2026).
- A review of a Sonar finding **needs the project context** — the owning item,
  the rulings, the frozen-code list. A finding reviewed without it is mostly
  rejection ware, and the reviewer will argue with the rule instead of the code.
- The quality gate checks **ratings, not counts**: a PR can merge green while
  adding findings — three landings added 16 unnoticed (measured agent-claim
  #143/PR #145, 06.09.2026). The control is a CI step in the sonar job, after
  `sonar.qualitygate.wait=true`, that pages
  `api/issues/search?componentKeys=<key>&pullRequest=<n>` with the
  `issueStatuses`, the authentication, and the resolution check of "API access"
  above, and fails on any result — proven red with a probe finding and green
  without one.
  Every repository on the CI scanner copies this step, and a distributor's
  Done when includes it.

## Cadence and closing

Re-run with the scheduled agent audit (weekly), and after any onboarding of a
new repository. Each run updates the existing distributor's metrics line and
class table rather than opening a second one. The distributor closes when every
finding is landed, folded into an owning item, or retired — and its rulings are
harvested into the owning repository document before it closes. If a run finds
no group outside classes (b) and (c), output `SCANNERS QUIET` and update only
the metrics line.
