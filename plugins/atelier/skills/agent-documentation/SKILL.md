---
name: agent-documentation
description: Audit, improve, or seed AI-agent guidance files. Use when changing or reviewing AGENTS.md, CLAUDE.md, agent skills, custom agents, or hooks; when entering a repository whose AGENTS.md/CLAUDE.md is missing, empty, or missing whole policy areas; checking generic versus project-specific ownership; finding duplicated, unclear, contradictory, stale, or token-wasteful guidance; or validating whether every line still earns its keep. For project documentation trees that are merely referenced by guidance, use docs-cleanup instead.
---

# Agent Documentation

Keep `AGENTS.md` complete, compact, loadable, provider-aware, and honest about
what is shared policy versus project fact.

## Seeding

When a repository has no `AGENTS.md` (or one missing whole policy areas), seed
it from `AGENTS.baseline.md` shipped next to this skill: copy the baseline,
drop its provenance comment, and fill the entry-points placeholder from the
repository's real coordination/verification/state docs (delete it when none
exist yet). Create `CLAUDE.md` containing exactly `@AGENTS.md` when the host
loads `CLAUDE.md` and none exists. Merge into an existing file — never
overwrite deliberate project policy; add what is missing and report what was
kept.

## Procedure

1. Read `AGENTS.md` first. Read `CLAUDE.md` when present. Read only scoped
   project-owner docs needed to verify claims.
2. Classify each scoped file as entry point, shared guidance, project owner,
   plan, provider glue, skill, custom agent, or record.
3. Verify concrete repository claims against source files, tests, config, and
   CI. Verify current provider behavior against primary docs when it affects the
   change.
4. Audit the guidance against the checklist. Treat each suspected issue as false
   until the files prove it.
5. Fix only confirmed issues when editing is requested. Move a rule to its
   owner instead of copying it. Delete stale or duplicated guidance.
6. After edits, request up to three independent fresh-eye reviews. Prefer a new
   isolated review context for each pass when provider-supported tooling is
   available and safe; otherwise run separate manual passes and report the
   limitation. Stop when a pass returns no findings. Pass only the skill path,
   scoped files, and the audit request; do not pass prior conclusions. Fix
   confirmed findings, then continue the loop.
7. Verify with the smallest command set that proves the documentation change.
   Do not run runtime tests for docs-only edits unless static policy or
   executable behavior is touched.

## Checklist

- Loading: entry-point files use provider-supported loading behavior. Do not
  invent imports or auto-load syntax.
- Ownership: `AGENTS.md` contains all generic policy; project-owned files
  contain product intent, current architecture, tooling, CI, or plans.
- Update duty: project owners say what must be updated when facts change; shared
  files change only when the reusable rule or skill improves.
- Token economy: every line adds a decision, boundary, trigger, invariant, or
  verification rule.
- Duplication: generic policy appears only in `AGENTS.md`; project facts appear
  only in their project owner.
- Clarity: intent is direct, terms are defined by context, and vague advice is
  replaced by observable behavior or deleted.
- Consistency: current architecture, plans, tooling, tests, commands, skills,
  and provider glue do not contradict each other.
- Truthfulness: plans are labeled as plans, implemented facts match files, and
  unknowns are marked.
- Audience and views: guidance and the docs it references name their reader
  and altitude; a document serving another audience is a view deriving from
  one owner, not an independently edited copy.
- Baseline coverage: check that the repository's `AGENTS.md` covers every
  policy area of the shipped `AGENTS.baseline.md`; a missing area is a
  finding, a different wording is not, and deliberate project divergence is
  recorded and kept.
- Portability: reusable skills and agent bodies avoid product names, module
  names, daemon assumptions, and provider-specific paths unless that file owns
  provider glue.

## Output

Return:

```text
FIXED <file:line> <change and source verified>
FINDING <severity> <file:line> <problem> -> <fix>
KEPT <file:line> <why it is intentional>
UNKNOWN <question and source checked>
VERIFICATION <commands or review passes>
```

End with `CLEAN` when no findings remain.
