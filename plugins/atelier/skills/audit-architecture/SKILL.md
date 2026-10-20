---
name: audit-architecture
description: Adversarial multi-agent architecture audit — verify that the claimed architecture is the real one, that its guards actually guard, and that its costs are measured, not assumed. Use when asked to audit architecture, check module boundaries, verify ownership, or judge structural drift, and after any structural change (new package, moved boundary, new enforcement tool). The dispatching seat spawns parallel read-only auditor subagents; it never audits alone.
---

Judge whether the architecture the documents describe is the architecture the
code enforces. **Strictly read-only: findings become work items through the
head; the audit itself changes nothing.** One seat dispatches;
independent subagents audit through disjoint lenses; every subagent's mandate
is to REFUTE the system's claims, not to confirm them.

## Cadence and anchor

Run after every ~100 trunk landings or weekly, whichever comes first.
Due-ness is owned by the standing board item, never by anyone's memory: its
body holds a line naming the last run's commit (for example
`last run at commit X`; the repository's own language is fine). Find the item
with `gh issue list --state open --search "Standing-Audit in:title"` in the
repository's work-item board (GitHub issues, or `aco board --json` where aco
runs) and take the one whose title, in the repository's language, names
this audit's subject (architecture: layers, boundaries, owner modules).
Count landings since X with
`git log --oneline --first-parent X..origin/<default>` (or the age `aco next`
shows where aco runs), or count the days since the run. If no item is found,
this is the first run: say so in the report and tell the head to open the
standing item. The audit stays read-only; the head writes the new anchor into
that item from the report.

## Why subagents, and why adversarial

A single reviewer inherits the system's own story. Each lens is independent,
is told to disprove a specific claim, and sees none of the others' work.
Dispatch the lenses below as read-only auditor agents in parallel (at least
three; the depth pass whenever modules or tests are in question):

1. **Boundaries and enforcement.** Do the declared owners hold IN CODE — and,
   **does the enforcement tool actually run the checks everyone believes it
   runs?** Gates are the CI workflows
   (`.github/workflows/*.yml`) or the repository's equivalent. Invoke the
   gate's exact command from there, then the same tool with its widest
   documented scope (`--help`: all files, no baseline, no diff filter), and
   compare failure counts. If the tool has no wider form, report that as the
   finding. A guard that has never fired is indistinguishable from one that
   always passes; prove which you have.
2. **Abstraction honesty.** For every claimed port: how many real
   implementations, what adding a third would cost (count the files it must
   touch), and which abstractions are speculative (zero production callers —
   check tests-only liveness). For every claimed concentration ("X lives only
   in owner Y"): count ALL call sites and name the outliers.
3. **Durable core and cost.** Are the safety invariants enforced at the
   durable WRITE (a named function as precondition of the append — not a
   label), and can a real race break them? Find the store in the
   repository guidance or the storage configuration; probe with real
   concurrent writers against a COPY of it, never the live one. With no
   durable store, state that and audit the nearest shared state (files,
   caches) instead. Then MEASURE the read
   path on that copy: wall-clock per endpoint, scaling with page size and
   history. An invariant without an enforcing function and a cost without a
   measurement are both findings.
4. **Depth.** Judge each module by what a caller must learn (invariants,
   ordering, errors, configuration, performance) against the behaviour it
   gives. A deep module has a small interface over much behaviour; a shallow
   one costs nearly as much to learn as it does. Do not score it as a line
   ratio. Per suspect module:
   - **Deletion test.** Imagine it removed: complexity that vanishes means a
     pass-through; complexity that reappears across its callers means it
     earned its place.
   - **Test surface.** Tests should need only the interface. Tests that reach
     past it, or need heavy arrangement, show the wrong shape. For each
     production entry point, check whether tests drive it or a test-only
     sibling (a function with no production caller, a copy of a worker
     script, a fake that re-implements a production step); report the shipped
     path as unproven and name the real adapter the tests should move onto.
   - **Seam count.** One adapter behind a port is a hypothetical seam; two
     real ones make a seam. Lens 2 counts them.
   - **Enforcement.** When an interface carries an ordering or "callers must
     not" rule only in a docstring or an assert, look for a caller that
     already breaks it (a flush defeats a dirty-session assert). A broken
     rule goes on the defects list.

   Findings that reshape an interface are `needs plan review`. Concepts after
   mattpocock/skills, `engineering/codebase-design` and
   `engineering/improve-codebase-architecture`
   (https://github.com/mattpocock/skills, MIT licence).

Add a lens when the change under audit touches an area no lens above covers:
security posture before an exposure change, frontend structure after UI
growth.

## The checklist each lens works

- Source of truth: authoritative state owned in one place, not mirrored in
  globals, side files, or duplicated stores.
- Ownership: decisions and writes live with the module that owns the concept.
- Dependency direction: imports follow the configured contracts.
- External effects: filesystem, process, network, clock, randomness, services
  behind explicit boundaries.
- Types over primitives: closed sets and identifiers as named types; watch
  for type erasure across codecs (validated on encode, bare on decode).
- Configuration: tunables and provider choices from the configured owner, no
  hidden literals; no self-discovered binaries where siblings take config.
- Signal channels: outcomes read from the documented contract, not inferred
  from an incidental side channel.
- Failure behavior: invariant, data, security, and process failures surface
  visibly. Docstrings are claims, not evidence — when one promises an
  invariant, find the enforcing line or report the gap.
- Concurrency: shared state and claims atomic or guarded where parallel work
  interleaves; prove the guard rests on the store, not on a read window.

## Rules for every subagent

- Findings carry file:line and a reproduction (command, measurement, or
  race). A lead without proof goes into "suspected, unproven" — never the
  findings list.
- Report refuted suspicions too ("tried to break X and could not", with what
  was tried). Confirmed strengths matter: they are what the next change must
  not casually destroy.
- Never run against live operator state; copy stores into scratch.

## Output and follow-through

The dispatcher merges the reports into one scored table (0-10 per lens, one
sentence of reason each) and reports each confirmed finding for the head to
file: the head searches the board for an existing owner first
(`gh issue list --state all --search "<subject>"`) and sharpens it instead of
opening a twin. Cheap-fix-first ordering: a one-line guard repair outranks a
redesign. Severity: HIGH for corruption, data loss, security exposure, or a
guard that silently never ran; MEDIUM for drift that will rot; LOW for
localized or arguable issues. The prevention check closes the audit: every
enforcement tool a gate runs must ANNOUNCE what it checked (counts,
not just green) — route a fix for any guard that can pass silently, because
silent guards are how this defect class is born. If every claim survived
every lens, output `ARCHITECTURE HOLDS` with the refutation attempts listed.
