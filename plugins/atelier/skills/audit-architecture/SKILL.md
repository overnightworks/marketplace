---
name: audit-architecture
description: Adversarial multi-agent architecture audit — verify that the claimed architecture is the real one, that its guards actually guard, and that its costs are measured, not assumed. Use when asked to audit architecture, check module boundaries, verify ownership, or judge structural drift; also on a cadence (initially after every ~100 trunk landings or weekly, whichever first) and after any structural change (new package, moved boundary, new enforcement tool). The dispatching seat spawns parallel read-only auditor subagents; it never audits alone.
---

Judge whether the architecture the documents describe is the architecture the
code enforces. **Strictly read-only: findings become work items through the
board's dedup rule; the audit itself changes nothing.** One seat dispatches;
independent subagents audit through disjoint lenses; every subagent's mandate
is to REFUTE the system's claims, not to confirm them.

## Why subagents, and why adversarial

A single reviewer inherits the system's own story. The audit that found this
repository's three-month-silent boundary gate succeeded because each lens was
independent, each was told to disprove a specific claim, and none saw the
others' work. Dispatch at least three read-only auditor agents in parallel:

1. **Boundaries and enforcement.** Do the declared owners hold IN CODE — and,
   the lesson written in blood: **does the enforcement tool actually run the
   checks everyone believes it runs?** Invoke the gate's exact command from
   the gate config, then the tool's full-check form, and compare failure
   counts. A guard that has never fired is indistinguishable from one that
   always passes; prove which you have.
2. **Abstraction honesty.** For every claimed port: how many real
   implementations, what adding a third would cost (count the files it must
   touch), and which abstractions are speculative (zero production callers —
   check tests-only liveness). For every claimed concentration ("X lives only
   in owner Y"): count ALL call sites and name the outliers.
3. **Durable core and cost.** Are the safety invariants enforced at the
   durable WRITE (a named function as precondition of the append — not a
   label), and can a real race break them? Probe with real concurrent writers
   against a COPY of the store, never the live one. Then MEASURE the read
   path on that copy: wall-clock per endpoint, scaling with page size and
   history. An invariant without an enforcing function and a cost without a
   measurement are both findings.

Add lenses when the trigger warrants them (security posture before an
exposure change, frontend structure after UI growth).

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
sentence of reason each) and files each confirmed finding through the
creation-time dedup rule — sharpening the standing item where the subject
already has one. Cheap-fix-first ordering: a one-line guard repair outranks a
redesign. Severity: HIGH for corruption, data loss, security exposure, or a
guard that silently never ran; MEDIUM for drift that will rot; LOW for
localized or arguable issues. The prevention check closes the audit: every
enforcement tool named in the gates must ANNOUNCE what it checked (counts,
not just green) — route a fix for any guard that can pass silently, because
silent guards are how this defect class is born. If every claim survived
every lens, output `ARCHITECTURE HOLDS` with the refutation attempts listed.
