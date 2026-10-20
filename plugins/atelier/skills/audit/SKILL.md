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

The dispatching seat spawns one read-only subagent per lens (per numbered
lens inside `architecture.md`) and never audits alone. A lens subagent reads
this file's shared rules, its own reference and any reference that one names
for a hand-off, and spawns nothing. A seat that is itself a lens subagent (for
example `code-auditor`) takes the lens or goal the parent names and reads the
same way.

## Shared rules

- **Scope.** Take it from the request: a change means the changed files first,
  a named file or directory means that target, otherwise enumerate the chosen
  scope. Name any scope, tool or evidence you could not reach; never hide it.
- **Guidance lookup.** Judge against the global contract's code policy
  (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` for Codex, or
  `instructions/AGENTS.md` "# Code policy" in the marketplace repository),
  then the repository's `AGENTS.md`, `CLAUDE.md` and `README.md` for its
  facts. Default when none exists: the conventions the code itself follows.
  A lens points at the code policy instead of restating it.
- **Refute before reporting.** Every subagent's mandate is to disprove the
  claim or suspicion, not confirm it. Confirm by reading the code, trace the
  path, then look for the check, bound or precondition that stops it. Report
  only what survives. Treat heuristic matches as false positives until the
  code proves otherwise.
- **Evidence.** A finding carries `file:line` and a reproduction or proof
  (command, measurement, import graph, commit). Every count cites the command
  that produced it. Never run against live operator state; copy stores into
  scratch.
- **Suspected, unproven.** A lead without proof goes into that section of the
  report, never into the findings.
- **Examined and kept.** Report refuted suspicions too ("tried to break X and
  could not", with what was tried) and what was examined and retained because
  it earns its place. These are what the next change must not casually destroy.
- **Severity.** One scale: `HIGH` is a defect, exposure, corruption or loss
  that matters under normal operation; `MEDIUM` is drift or a gap needing a
  precondition; `LOW` is localized or arguable. Each lens defines its own
  examples. For a change audit, against the global contract: `HIGH` is
  blocking; `MEDIUM` is blocking when it breaks a ruled sentence, a contract
  or a repository rule, or touches data safety, security, secrets or a public
  contract, otherwise follow-up; `LOW` is follow-up. On code the audit did not
  change everything is follow-up, and the head classifies it.
- **Report.** One heading per check that has findings, each finding as:

  ```text
  [SEVERITY] <check> - <file:line>
  What: <confirmed issue and its concrete path>
  Why: <rule or behaviour at risk>
  Fix: <concrete change>
  ```

  End with `CLEAN` when no `HIGH` or `MEDIUM` finding remains (for
  `deadweight` and `ownership` formats: no finding at all); then still list
  the examined-and-kept and suspected-unproven sections. A lens whose
  reference defines another finding format (`deadweight`, `ownership`) uses
  that format and this definition of `CLEAN`.
- **Distributor hand-off.** The audit returns the distributor text: the
  numbered findings list with evidence, ready to paste. The head searches the
  board (`gh issue list --state all --search "<subject>"`, or
  `aco board --json` where aco runs) for an owner, sharpens it, and writes the
  item; open no item per finding. A finding becomes an item only when
  dispatched.
- **Standing audit.** Due-ness is owned by the standing board item, never by
  anyone's memory: its body holds a line naming the last run's commit
  (`last run at commit X`; the repository's own language is fine). Find it
  with `gh issue list --state open --search "Standing-Audit in:title"` (or
  `aco board --json`) and take the one whose title names the audit's subject.
  Count landings since X with
  `git log --oneline --first-parent X..origin/<default>` (or the age `aco next`
  shows), or count the days. If no item is found, this is the first run: say
  so and tell the head to open the standing item. If one item covers two
  audits, they share its anchor: a run of either resets it, so the report
  names which audit ran. The head writes the new anchor from the report. Each
  lens reference gives its interval and subject.
- **Prevention check.** A lens whose reference names one closes its report
  with it: a gap in a guard is routed as a fix (flag, never edit), because an
  unguarded gap is how the defect class is born.

## Cleanup procedure

Make the code smaller without making it less proven. The audit produces one
ranked list of cuts and never executes them.

1. **Measure first.** Count non-blank src and test lines, the test:src ratio,
   and growth per area since a base commit. Use quality's scoreboard where
   the repository has it; otherwise state one counting rule (non-blank lines
   of tracked code files) and use it throughout. Without a named base, use
   the commit about 30 days back, or report "growth not measured". Count
   commits per file over the last 200 commits in the area, and how many files
   each of the last 10 non-merge commits touching production files in the
   area ("feature commits") touched. When the caller names no area, start the
   depth pass on files both hot and large; cite "feature commits touched K
   files" as locality evidence.
2. **Run the lenses in parallel** on the chosen area: `deadweight` (code that
   has not earned its place), `ownership` (several deciders for one question),
   `tests` (test size against proven behaviour), `depth` (shallow modules and
   unreal seams). A near-duplicate pair has one owner: a pair of deciders, or
   a rewrite instead of a reuse, goes to `ownership`; textual clones belong to
   quality's clone ratchet, and where the repository has none, report the pair
   under `ownership`.
3. **Merge** into one numbered list (defects, then concept candidates, then
   cuts). Drop duplicates across lenses and keep the strongest evidence.
   - **Defects.** When two deciders of one question disagree, trace one
     concrete input through each and state who gets which different result. A
     reachable divergence goes into a separate `suspected defects` list above
     the cut list, with the triggering input and the ruled sentence or
     document it contradicts. A divergence on a question the requirements
     list as open goes to that question's owner as evidence, not as a bug.
   - **Concepts.** Group the deciders of one domain concept (for example "the
     effective price") into one candidate that lists its members, the owner it
     should have, and the interface that owner would offer.
   - **Ranking.** Defects first, then concept candidates by structural
     leverage, then line-level cuts by lines saved. A pure test
     deduplication never outranks a finding on the production path.

   Each finding carries:
   - `file:line` evidence and its lens;
   - the proposed change and who survives it;
   - estimated lines saved (src and test apart) and a confidence;
   - the proven behaviour it touches.

   A finding that moves a boundary or reshapes an interface is marked
   `needs plan review`, never `cut now`. Test cuts follow the Test size rules
   in `references/tests.md`. Size, complexity and clone thresholds belong to
   quality's gate: point at the gate; do not restate or re-measure its rules.
4. **Report** the distributor text per the hand-off above; the head searches
   for an existing cleanup distributor and writes the item. Shape:

   ```text
   Measurements: <counts, counting rule, commands>
   Suspected defects: <numbered, with triggering input>
   Concept candidates: <members, owner, interface>
   Ranked cuts: <cut now | needs plan review>
   Examined and kept / Suspected and unproven:
   Totals: <estimated lines saved, src and test apart>
   ```
