---
name: sonar-distributor
description: Turn a repository's SonarCloud and CodeQL findings into exactly ONE distributor issue with the findings classified and sliced — never a fix-by-fix march and never an item flood. Use when asked what Sonar or CodeQL reports for a repository, when a repository is newly onboarded to SonarCloud or CodeQL default setup, when a quality gate or a security alert needs triage, and on the scheduled agent audit cadence (weekly). Read-only against the code; the run produces one issue, its class table, and its slices.
---

Classify findings by class, never by count. A scanner reports symptoms across a
whole tree at once; the cheap win is one exclusion or one won't-fix that
retires a whole class, and the expensive loss is a lane per finding. **This
skill reads scanners and writes one issue; it changes no source file.** Every
repository of the operator is on SonarCloud (Free plan, public projects,
organisation `flexor2`, project keys `FlexOr2_<repo>`) and on CodeQL default
setup (operator ruling 04.09.2026).

## Procedure

1. **Pull the numbers.** SonarCloud's public API needs no token for a public
   project:

   ```bash
   key=FlexOr2_<repo>
   curl -s "https://sonarcloud.io/api/measures/component?component=$key&metricKeys=ncloc,bugs,vulnerabilities,security_hotspots,code_smells,duplicated_lines_density,duplicated_blocks,cognitive_complexity,reliability_rating,security_rating,sqale_rating"
   curl -s "https://sonarcloud.io/api/issues/search?componentKeys=$key&statuses=OPEN&ps=500&p=1"
   gh api repos/<owner>/<repo>/code-scanning/alerts --paginate
   ```

   Page the issue search until you have `total` issues (`ps` maxes at 500).
   Then group the result twice — by `rule` and by top-level directory of
   `component`. Those two groupings are the whole triage: a rule with dozens of
   hits is one decision, not dozens.
2. **Classify every group** into the five classes below. A group belongs to
   exactly one class, and each class has one named action and one owner.
3. **Write ONE distributor issue** per repository (search the board first —
   `gh issue list --search` over open and recently closed — and sharpen an
   existing distributor rather than opening a twin).
4. **Cut slices** in corridor size, one owner each, and dispatch them one at a
   time from the distributor. A finding becomes its own issue only when it is
   dispatched.

## The five classes

Illustrated with the first atelier-2 run (04.09.2026, 131 open Sonar issues).

- **(a) Noise an exclusion removes** — mockups, vendored assets, generated
  artefacts, fixtures: trees the rules were never written for. Action: one
  `sonar-project.properties` with `sonar.exclusions`; a code change, so it is a
  slice. *Example: 52 of 131 findings sat in `docs/`, 35 of them accessibility
  smells (`Web:S6853`) in the single mockup file
  `docs/requirements/0003-ziel-ui-mockup-v8.html`.*
- **(b) A rule that does not fit this project** — the rule is right in general
  and wrong here. Action: **operator or head**, in the SonarCloud UI —
  won't-fix each hit with a one-line reason, or disable the rule in the quality
  profile when the whole class is wrong. Never a code change and never a
  builder's task. *Example: `githubactions:S8541`, `uv sync` without
  `--no-build`, 14 hits — the project installs itself, not third-party
  build scripts.*
- **(c) Frozen code** — code built ahead of its caller (AGENTS.md rule: frozen,
  not deleted; no hardening, no new tests). Action: the finding **stays open**,
  named against the item that will delete or pull that code, so the scanner
  stops being asked the question the board already owns. *Example:
  `pythonsecurity:S8707` in `src/atelier2/adapters/docker_carrier.py:925`.*
- **(d) Real and small** — the scanner is right and the fix is cheap. Action:
  one slice per owning module, cut **after the measurement week** so a lane is
  not spent on a rule that turns out to be class (b). *Example: `python:S5863`,
  six self-comparing assertions under `tests/domain/`.*
- **(e) Probably a false positive** — verify before you believe it. Action:
  read the line, then won't-fix with the reason, or move it to (d) if the doubt
  does not survive. *Examples: `python:S4790` on a SHA-256 used as an identity,
  not as a password digest (`src/atelier2/contracts/effect_requests.py:406`);
  `python:S5332` on loopback `http://` addresses (`src/atelier2/host/address.py:16`).*

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
  has compared them against the repository's own gates. Until then they inform;
  they do not block a landing.
- A review of a Sonar finding **needs the project context** — the owning item,
  the rulings, the frozen-code list. A finding reviewed without it is mostly
  rejection ware, and the reviewer will argue with the rule instead of the code.

## Cadence and closing

Re-run with the scheduled agent audit (weekly), and after any onboarding of a
new repository. Each run updates the existing distributor's metrics line and
class table rather than opening a second one. The distributor closes when every
finding is landed, folded into an owning item, or retired — and its rulings are
harvested into the owning repository document before it closes. If a run finds
no group outside classes (b) and (c), output `SCANNERS QUIET` and update only
the metrics line.
