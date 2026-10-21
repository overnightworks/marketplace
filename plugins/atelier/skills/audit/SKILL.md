---
name: audit
description: Audit a codebase through read-only lenses, chosen by goal. Use when asked to clean up, slim down or shrink code, find dead or unnecessary code or the wrong architecture; to check architecture, module boundaries, ownership or duplicate deciders (who decides X); to review security, performance, leaks or concurrency; to audit a change for code smells, readability, test quality or coverage, brittle tests; or to run a scheduled standing audit, and after any structural change or replacement (check that a replacement left no predecessor). Returns a ranked, evidenced report and the distributor text; changes nothing. For plans use plan-review, for documentation trees docs-cleanup, for AGENTS.md, skills and agents agent-documentation. Not the built-in security-review (pending branch changes) or simplify (applies edits).
---

An audit judges code against its own claims and the repository's rules.
**Strictly read-only: it produces a report and never edits, fixes, files an
item or executes a cut.** Pick the goal, run its lenses, return one report.

## Goal to lenses

| Goal | Lenses (`references/<lens>.md`) |
|---|---|
| Cleanup: smaller and more maintainable | `deadweight`, `ownership`, `tests`, `depth`; procedure below |
| Architecture check | `architecture`, plus `depth` whenever modules or tests are in question |
| Security review | `security` |
| Runtime and performance: leaks, blocking, growth, races | `runtime` |
| Change audit: hygiene and tests on a diff | `hygiene`, `tests` |
| Scheduled standing audit | `architecture`, `deadweight` (with the `tests` Test size check) or `ownership`, each on its own cadence |

## Dispatch

The dispatching seat spawns one read-only `atelier:code-auditor` subagent per
lens (per numbered lens inside `architecture.md`) and never audits alone. A lens
subagent reads exactly this file's shared rules, its own reference and the
references on that reference's `Hand-offs:` line, and spawns nothing. A
`Hand-offs:` line names where a lead goes, not a lens the goal must run; a
lead from a lens the goal does not run goes to that lens's owner list or to
"suspected and unproven". A threshold a lens words as judgement ("heavy",
"well above") is a judgement call: the lens names the call and its reason.

## Shared rules

- **Scope.** A change means the changed files first, a named file or
  directory that target, otherwise enumerate the chosen scope. Name any scope,
  tool or evidence you could not reach.
- **Guidance lookup.** Judge against the global contract's code policy
  (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` for Codex, or
  `instructions/AGENTS.md` "# Code policy" in the marketplace repository),
  then the repository's `AGENTS.md`, `CLAUDE.md` and `README.md` for its
  facts, and `docs/ARCHITECTURE.md` (its Trust paragraph) for the trust
  model. Default when none exists: the conventions the code itself follows.
  A lens points at the code policy instead of restating it.
- **Trust model.** Only the Trust paragraph in `docs/ARCHITECTURE.md`
  section 5 (Crosscutting Concepts) declares a repository's trust model: for
  each boundary, who can reach it, what they control, and what the system
  trusts. Boundary statements elsewhere, such as a README's "local-only", are
  leads for drafting it. A Trust paragraph narrows the default only when it
  cites the operator ruling that blessed it; otherwise the lenses use the
  default and name the draft. The default:
  assume that every input from outside the process (files it did not write,
  network responses, user text, and any argument or environment value that
  carries external content) is untrusted, and that the repository's own
  checked-in files and operator-supplied settings, including arguments and
  environment, are trusted. The Trust paragraph points to the components that
  the tripwire ruling (global contract, "Every review finding is marked ...")
  declares and does not restate them. A report that ran `security` or
  `deadweight` names the model it used: declared (with the ruling), or
  default.
- **Quality gate.** With `quality/config.toml` and a workflow using
  `overnightworks/quality/.github/workflows/gate.yml`, the shared gate owns
  the thresholds only (its `size` rule); point at it. Its `quality scoreboard`
  is a weekly CI summary of public repositories, not a measurement of this
  area: measure with your own commands and say so.
- **Refute before reporting.** Every subagent's mandate is to disprove the
  claim or suspicion: read the code, trace the path, then look for the check,
  bound or precondition that stops it. Report only what survives; heuristic
  matches are false positives until the code proves otherwise. Before
  reporting a concept or a cut, search the closed items and rulings for it;
  one a closed item retired is examined and kept, citing that item.
- **Evidence.** A finding carries `file:line` and a reproduction or proof
  (command, measurement, import graph, commit); every count cites its command.
  Never run against live operator state; copy stores into scratch.
- **Suspected, unproven and examined, kept.** A lead without proof goes into
  the report's suspected-unproven section, never into the findings. Report
  refuted suspicions ("tried to break X and could not", with what was tried)
  and what was examined and retained because it earns its place.
- **Severity.** `HIGH` is a defect, exposure, corruption or loss that matters
  under normal operation; `MEDIUM` is drift or a gap needing a precondition;
  `LOW` is localized or arguable. Each lens adds examples; `ownership` and
  `deadweight` grade by the scale as worded. For a change audit, against the
  global contract: `HIGH` is blocking; `MEDIUM` is blocking when it breaks a
  ruled sentence, a contract or a repository rule, or touches data safety,
  security, secrets or a public contract, otherwise follow-up; `LOW` is
  follow-up. On code the audit did not change everything is follow-up, and
  the head classifies it.
- **Finding record.** Every lens emits this record under a heading per check
  that has findings; a lens reference adds only its named extra fields.

  ```text
  [SEVERITY] <lens>/<check> - <file:line>
  Evidence: <confirmed issue, its concrete path, the proof command>
  Why: <rule or behaviour at risk>
  Change: <concrete change and who survives it>
  Saves: <src lines> src, <test lines> test (cleanup goal: every lens; else `deadweight` only)
  Confidence: high | medium | low (same scope as Saves)
  ```

  `high` is a claim reproduced at the code, `medium` is evidence read but not
  reproduced, `low` is an inference.
- **CLEAN.** Per run: no `HIGH` or `MEDIUM` finding across all lenses. A lens
  without findings prints `<lens>: no findings`. After `CLEAN` still list the
  examined-and-kept and suspected-unproven sections.
- **Distributor hand-off.** The audit returns the distributor text: the
  numbered findings list with evidence, ready to paste. The head searches the
  board (`gh issue list --state all --search "<subject>"`, or
  `aco board --json`) for an owner, sharpens it, and writes the item; no item
  per finding. A finding becomes an item only when dispatched.
- **Standing audit.** Only the scheduled standing audit uses this anchor and
  cadence. The standing board item owns due-ness: its body holds a line naming
  the last run's commit (`last run at commit X`). Find the one whose title
  names the audit's subject with
  `gh issue list --state open --search "Standing-Audit in:title"` (or
  `aco board --json`). Count landings with
  `git log --oneline --first-parent X..origin/<default>` (or the age `aco next`
  shows), or count the days. With no item, say it is the first run and tell
  the head to open the standing item. One item covering two audits shares its
  anchor: a run of either resets it, so the report names which ran. The head
  writes the new anchor from the report. Each lens reference gives its
  interval and subject.
- **Prevention check.** A lens whose reference names one closes its report
  with it: a gap in a guard is routed as a fix (flag, never edit), because an
  unguarded gap is how the defect class is born.

## Cleanup procedure

Make the code smaller without making it less proven. The audit produces one
ranked list of cuts and never executes them.

1. **Measure first.** The dispatching seat measures before dispatch with its
   own commands and one stated rule (non-blank lines of tracked code files):
   src and test lines and the test:src ratio per area. Where there is no
   src/test split, src is the area's code files and tests are the files under
   the repository's test directories that import its modules. Growth is
   required: src and test lines at base and now. The base is the caller's base
   commit, else `git log -1 --before="30 days ago"`; the area at base is every
   code file under its paths at that commit, files since deleted included.
   Write "growth not measured" only when no base commit exists. Count commits
   per file over the last 200 commits touching the area, and how many files
   each of the last 10 non-merge commits touching its production files
   ("feature commits") touched, every file counted. When the caller names no
   area, start the depth pass on files both hot and large; cite "feature
   commits touched K files" as locality evidence.
2. **Run the lenses in parallel** on the chosen area: `deadweight`,
   `ownership`, `tests`, `depth`. A near-duplicate pair has one owner: a pair
   of deciders, or a rewrite instead of a reuse, goes to `ownership`; textual
   clones belong to the repository's clone check, and where it has none,
   report the pair under `ownership`.
3. **Merge** the records into one numbered list (defects, then concept
   candidates, then cuts). Drop duplicates across lenses and keep the
   strongest evidence. Link a `tests` coverage finding to the `deadweight`
   cut that would delete its code; the finding stands until that cut lands.
   - **Defects.** A defect is any confirmed wrong behaviour; two deciders of
     one question giving different results for one input is one kind: trace
     one concrete input through each and state who gets which result. A
     reachable defect goes into a separate `suspected defects` list above the
     cut list, with the triggering input and the ruled sentence or document it
     contradicts. A divergence on a question the requirements list as open
     goes to that question's owner as evidence, not as a bug.
   - **Concepts.** Group the deciders of one domain concept (for example
     "the effective price") into one candidate (its own list, not a ranked
     cut) that lists its members, the owner it should have, the interface
     that owner would offer, and its estimated saving.
   - **Ranking.** Defects first, then concept candidates by structural
     leverage, then line-level cuts by lines saved. A pure test
     deduplication never outranks a finding on the production path.

   Each record also names the proven behaviour it touches. A finding that
   moves a boundary or reshapes an interface is marked `needs plan review`,
   never `cut now`. Test cuts follow the Test size rules in
   `references/tests.md`.
4. **Report** the distributor text. The head searches for an open item whose
   title starts "Distributor:" and names the goal, or the standing-audit
   anchor item; if none exists it opens a new distributor. Shape:

   ```text
   Measurements: <counts, counting rule, commands, growth per area>
   Suspected defects: <finding records, with triggering input>
   Concept candidates: <members, owner, interface, estimated saving>
   Ranked cuts: <finding records, each cut now | needs plan review>
   Examined and kept / Suspected and unproven:
   Totals: <lines saved by line-level cuts, src and test apart>
   ```
