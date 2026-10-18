---
name: sonar-distributor
description: Turn a repository's SonarCloud and CodeQL findings into exactly ONE distributor issue with the findings classified and sliced — never a fix-by-fix march and never an item flood. Use when asked what Sonar or CodeQL reports for a repository, when a repository is newly onboarded to SonarCloud or CodeQL default setup, when a quality gate or a security alert needs triage, and on the scheduled agent audit cadence (weekly). Read-only against the code; the run produces one issue, its class table, and its slices.
---

Classify findings by class, never by count. A scanner reports symptoms across a
whole tree at once; the cheap win is one exclusion or one versioned exception
that retires a whole class, and the expensive loss is a lane per finding. **This
skill reads scanners and writes one issue; it changes no source file.** Every
repository of the operator is on SonarCloud (organisation `overnightworks`,
project keys `overnightworks_<repo>`) and on CodeQL default setup (operator
ruling 04.09.2026).

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
rule-level exception moves to the CI scanner first. Read the mode of the
project at hand from the API above; it is not the same across the
organisation.

The two modes also give the findings gate (`.github/actions/sonar-findings-gate`,
below) a different guarantee, because Automatic Analysis runs asynchronously
after the push while a CI scanner step blocks on its own analysis first —
measured on claude-revive's own gate build (overnightworks/claude-revive#6, PR
#7): its pull request analysis landed three seconds into a twenty-five-second
run, comfortable, but its push of `54b9662` to `main` finished CI at 18:43:05
against an analysis timestamped 18:43:01 — four seconds of margin on the
fastest repository in the fleet.

- On a **pull request**, losing that race is loud: the gate proves the
  component resolves under the scope before believing any count, and a scope
  with no analysis answers 404, so the job fails with the resolution message
  and a re-run fixes it. Annoying, never a false clean.
- On a **push to the default branch**, losing it is quiet: the branch scope
  resolves against the previous commit's analysis, so the gate can report
  cleanly about the commit before the one just pushed. The next push corrects
  it, but for that window the green refers to older code.
- A repository that runs the scanner in CI has neither problem, because its
  scan step blocks on its own analysis before the gate reads it.

No retry loop was built for this: the gate is one script pinned and consumed
byte-identical across the fleet, so a wait is machinery every consumer pays
for, needing its own tests, against a race this narrow on the fastest
repository measured — revisit if a stale read ever produces a green that
mattered.

## Procedure

1. **Pull the numbers.** Without `$SONAR_TOKEN`, stop and ask the head for the
   token through the header-file route below; a run never falls back to an
   unauthenticated read, which answers zero about nothing. Read with the credential that produced the analysis
   and prove the scope, for the reason under "API access" below. The credential
   is basic auth — the token as user name, an empty password — and it goes to
   `curl` in a header file, never in an argument: `-u` and `-H` both put it in
   the command line, where any local process reads it out of `ps`, and base64
   is encoding, not concealment.

   ```bash
   key=overnightworks_<repo>
   header="$(mktemp)"
   trap 'rm -f "$header"' EXIT
   printf 'Authorization: Basic %s\n' "$(printf '%s:' "$SONAR_TOKEN" | base64 -w0)" > "$header"
   main="$(curl -s -H @"$header" "https://sonarcloud.io/api/project_branches/list?project=$key" | python3 -c 'import json,sys; print(next((b["name"] for b in json.load(sys.stdin)["branches"] if b["isMain"]), ""))')"
   [ -n "$main" ] || { echo "no main branch found for $key" >&2; exit 1; }
   scope="branch=$main"
   curl -s -H @"$header" "https://sonarcloud.io/api/measures/component?component=$key&$scope&metricKeys=ncloc,bugs,vulnerabilities,security_hotspots,code_smells,duplicated_lines_density,duplicated_blocks,cognitive_complexity,reliability_rating,security_rating,sqale_rating"
   curl -s -H @"$header" "https://sonarcloud.io/api/issues/search?componentKeys=$key&$scope&issueStatuses=OPEN,CONFIRMED,ACCEPTED,FALSE_POSITIVE&ps=500&p=1"
   gh api repos/<owner>/<repo>/code-scanning/default-setup --jq .state
   gh api repos/<owner>/<repo>/code-scanning/alerts --paginate
   ```

   Read the alerts only after code scanning is proven configured: default setup
   `state` is `configured`, or `gh api repos/<owner>/<repo>/code-scanning/analyses`
   lists at least one analysis. An empty alert list from an unconfigured
   scanner is the same silent zero.

   The measures call carries the same scope as the issue search on purpose: it
   is the proof that the query reached something. If it 404s, stop — the issue
   search would answer zero about nothing. The main branch is asked for, not
   assumed: a literal `branch=main` copied into a repository whose main branch
   is `master` is that silent zero.

   Page the issue search until you have `total` issues (`ps` maxes at 500).
   Then group the result twice — by `rule` and by top-level directory of
   `component`. Those two groupings are the whole triage: a rule with dozens of
   hits is one decision, not dozens.
2. **Classify every group** into the four classes below. A group belongs to
   exactly one class, and each class has one named action and one owner.
3. **Write ONE distributor issue** per repository (search the board first —
   `gh issue list --state all --search "distributor closed:>=<date 30 days ago>"`
   catches open and recently closed — and sharpen an
   existing distributor rather than opening a twin).
4. **Cut slices** in corridor size, one owner each, and dispatch them one at a
   time from the distributor. A finding becomes its own issue only when it is
   dispatched.
5. **Re-measure main after every landing** while the distributor is open — the
   default quality gate does not (measured agent-coordination #143/PR #145,
   06.09.2026: three green-merged landings added 16 findings on main
   unnoticed).

## The four classes

Illustrated with the first atelier-2 run (04.09.2026, 131 open Sonar issues)
and the 05.09.2026 measurement PR (PR overnightworks/agent-coordination#116).

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

A scoped `api/issues/search` answers HTTP 200 with `total: 0` and no `errors`
field whenever it was asked about nothing, and nothing in that response tells it
apart from a clean project. It answers that way for a private project queried
without a credential — where `api/measures/component` and `api/components/show`
say 404 "Project doesn't exist" while the issue search stays cheerfully empty —
and equally for a branch that was never analysed, a pull request number that
does not exist, and a mistyped component key. So: **a query that answered about
nothing must never read as clean.**

One call proves credential, key and scope together: `api/measures/component`
under the **same scope** as the issue search, 404 when any of the three does not
resolve. The gate step and every pull make it first, and its failure names both
causes — no analysis exists for this scope (an unanalysed branch, a pull request
that does not exist, a mistyped key), or the credential cannot see the project.
`api/components/show` cannot do the job because it is unscoped: it resolves
while the scope names nothing, and `api/authentication/validate` proves nothing
at all — it answers `valid: true` anonymously.

Success says so, in one shape across the fleet, because a step that prints
nothing on success cannot be shown to have run:
`SonarCloud clean for '<key>' (<scope>): <n> open finding(s)`.

The rule is therefore not "authenticate when the project is private": **read
with the same credential that produced the analysis you are reading, and assert
the scope always.** A repository whose CI carries the scanner has Automatic
Analysis off, so a fork pull request produces no analysis at all, and the
question is never who may read but whether anything was written.

Scopes come from the repository, never from a literal: `${GITHUB_REF_NAME}` in
a workflow, and `api/project_branches/list` (`isMain`) in a pull. A copied
`branch=main` in a repository whose main branch is `master` is the trap. **A
derived scope is encoded into the query, never interpolated into it.** A ref
name may legally carry a `+`, which a query string decodes as a space — the
scope proof catches that one, because a branch nobody named does not resolve.
The sharper case is a `%` that starts no valid escape: measured against the
live service on 07.09.2026, `api/measures/component` answered such a scope 200
with the project's measures, so the assertion passes and the findings query
drops the scope it could not read — a zero that this section forbids reading as
clean, waved through by the very call that exists to stop it. The scope proof
is not the safety net here; the encoding is.

**Every call carries a timeout, and the step carries a ceiling.** A SonarCloud
that accepts the connection and then stops answering would otherwise hold the
step until the runner's six-hour ceiling, burning a private repository's
minutes while looking fine. The per-call timeout is what fails loudly: it names
the timeout as the cause, apart from an unresolved scope and from open
findings, and says to re-run before investigating, because a transient blip
should not read as a verdict. It does not bound the step, though — the step
pages, so a per-call bound multiplies by the page count — which is why the step
carries a `timeout-minutes` of its own as the hard limit.

A third way to read clean escapes both the credential and the scope proof: a
**skipped job**. Where a fork pull request has no token, the scan step does not
run, so nothing is analysed and nothing is asserted — and a skipped check does
not block, even where the gate is required. A fork's code is measured when it
runs from a branch in the repository.

Every query asks for `issueStatuses=OPEN,CONFIRMED,ACCEPTED,FALSE_POSITIVE`,
never the legacy `statuses` parameter, whose vocabulary drops an issue a person
accepts or marks false positive in the UI — a finding still in the code that no
query sees. The two holes compound, so the two fixes ship together: an
authenticated gate still querying `statuses=OPEN` is blind in exactly that way,
and a reader who repairs only the authentication is not done.

`issues/search` cannot answer for security hotspots at all: it rejects
`types=SECURITY_HOTSPOT` with "must be one of: [CODE_SMELL, BUG,
VULNERABILITY]". "Zero open findings" therefore excludes a class that a person
can also silence in the interface.

A project's SonarCloud visibility is its own: SonarCloud follows the GitHub
repository only when it auto-creates the project, and either can change
afterwards. Read it from the API for the project at hand rather than inferring
it.

### Reading a pull request's own new findings without a token

A builder without a SonarCloud token reads the findings its own pull request
introduced from the GitHub check-run annotations, with its GitHub credential.
Zero annotations mean no new finding, never a clean project. The route, its
guards and its limits: [references/pr-annotation.md](references/pr-annotation.md).

### Last resort, and it writes: a whole tree's findings when the branch scope is refused

Land the change and re-measure main (step 5) first. Only when the answer must
exist before the landing, on a pull request you own, does a local scan replace
that pull request's analysis and decorations. Costs, command and refusals:
[references/write-route.md](references/write-route.md).

### Language rules

Cleared and refused fixes measured per analyzer (Python `S8705`/`S8786`, shell
`S8541`): [references/rules-by-language.md](references/rules-by-language.md).

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
  adding findings — three landings added 16 unnoticed (measured agent-coordination
  #143/PR #145, 06.09.2026). The control is a CI step in the sonar job, after
  `sonar.qualitygate.wait=true`, that pages
  `api/issues/search?componentKeys=<key>&pullRequest=<n>` with the
  `issueStatuses`, the authentication, the scope proof, the timeout and the
  scope encoding of "API access" above, and fails on any result — proven red
  with a probe finding and green without one. That logic is owned once, by the
  composite action overnightworks/marketplace publishes at
  `.github/actions/sonar-findings-gate`, because a heredoc inside YAML is
  reached by no rule and measured by no coverage: three reviews found defects
  in it by reading, and the first scan of the extracted script found a fourth.
  A repository on the CI scanner **uses** that action and copies nothing:

  ```yaml
  - name: SonarCloud open findings
    # A composite action's steps take no timeout-minutes, so the ceiling over
    # the gate's paging lives here.
    timeout-minutes: 5
    uses: overnightworks/marketplace/.github/actions/sonar-findings-gate@<commit>
    with:
      sonar-token: ${{ secrets.SONAR_TOKEN }}
  ```

  The pin is an **exact commit SHA, never a tag or a branch**: a mutable
  reference on the step that guards security findings is both a supply-chain
  hole — whoever can move the ref runs code in every consumer's job — and a
  silent change of what the gate asserts, which is the one thing a gate may
  never do quietly. Write the version beside it as a comment, the way the
  fleet pins every other action. The action reads the project key from the
  consumer's own `sonar-project.properties` through `GITHUB_WORKSPACE`, so a
  distributor's Done when names the step and that file, not a copied script.
  A floor
  stronger than the server gate's new-code judgement — zero open findings, a
  coverage fail-under — lives in the repository's own tooling, so a green build
  is evidence only once you know what that repository asserts.

## Cadence and closing

Re-run with the scheduled agent audit (weekly), and after any onboarding of a
new repository. Each run updates the existing distributor's metrics line and
class table rather than opening a second one. The distributor closes when every
finding is landed, folded into an owning item, or retired — and its rulings are
harvested into the owning repository document before it closes. If a run finds
no group outside classes (b) and (c) and both scanners were read (Sonar scope
proven, CodeQL configured), output `SCANNERS QUIET` and update only the metrics
line. A scanner that was not read makes the run unfinished, never quiet: say
which one and why.
