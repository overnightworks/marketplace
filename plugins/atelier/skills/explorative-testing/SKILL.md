---
name: explorative-testing
description: Exploratively test a running application like a curious user. Use when asked whether a feature actually works beyond its unit tests, to probe a live app for behavior or UX defects, to explore an app against its documented intent, or to turn exploration findings into work items or bug reports.
---

Drive the real application, not the test suite. Scripted tests assert known
expectations; this skill hunts the gap between documented intent and what a
real user experiences.

## Procedure

1. Collect expectations first, when the parent supplies expectations; a
   plan-blind run skips this step: the feature's plan or acceptance criteria,
   user-facing docs, and recent changes. Write down a handful of concrete,
   falsifiable expectations before touching the app ("a completed run stays
   visible", "a failure names an actionable reason").
   Shed builder knowledge deliberately: if you know why a surface is shaped
   the way it is, judge only what the surface itself communicates — the
   user does not carry the data model, the plan status, or the roadmap in
   their head, and "known issue" is not "not an issue." Prefer a
   context-fresh agent as the witness when one is available.
2. Boot or attach the repository-documented way. Prefer an isolated state
   directory or database; never explore against live user state unless
   explicitly told to.
3. Exercise real flows through the real interface — HTTP, browser, CLI. When
   UI is involved, capture screenshots and judge the rendered image (see
   skill), not the source. Cover at least: the happy path, one error path,
   one interrupt/restart path (state durability), and the empty first-run
   state.
4. Probe like a user, not a fuzzer: what would confuse, mislead, or dead-end
   a person? Stale views, vanished state, unlabeled failures, copy that
   overpromises, controls that silently do nothing.
   Check every count and state label the surface claims against the source
   of truth (API, store): an aggregate that miscounts, or a status word that
   contradicts reality ("Running" over runs nothing will ever continue), is
   a top finding even when the surface renders it faithfully.
5. Try to refute each suspected defect before reporting it — wrong build,
   stale cache, misread expectation, missed refresh. Reproduce it twice.
6. Report findings with severity, the expectation violated, reproduction
   steps, and evidence (response bodies, screenshot paths). When the user
   asked for work items and the repository has a work intake, file each
   finding through it: deduplicated against open items, a bounded number per
   exploration, evidence attached.

## Scenario matrix (first gate of a material-risk lane)

When the parent hands you a scenario matrix instead of leaving step 1 to you,
drive it in full rather than sampling — this is the first independent review of
a material-risk lane, and later gates are true deltas only if this one is
complete. A matrix crosses the axes that matter for the change -- typically
**type** (the kinds of thing it touches), **state** (before/after variants),
**edit** (the operation applied), **sources** (which origins are in play), and
**command** (each entry point that can observe the result) -- judged against a
short list of ruled sentences. Where there is no running surface, the cells are
driven through the change's real entry points -- CLI invocation, API call, or
public function. Report every cell as **held**, **failed**, or **not driven**;
an unmarked cell is not a completed gate.

## Hard Limits

- Observe and exercise only: no fixes, no state mutation beyond what the
  flows themselves cause, nothing destructive on non-isolated state.
- Do not claim a flow works without having driven it; do not claim a UI is
  correct without a rendered screenshot.
- Stop and report if the app cannot be booted in isolation.

## Output

Return: expectations checked (met / violated / unverifiable), findings with
severity + reproduction + evidence, work items filed (with ids) when
authorized, and what was deliberately not explored.
