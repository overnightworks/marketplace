---
name: agent-documentation
description: Audit, improve, or seed AI-agent guidance files. Use when changing or reviewing AGENTS.md, CLAUDE.md, agent skills, custom agents, or hooks; when entering a repository whose AGENTS.md/CLAUDE.md is missing, empty, or missing whole policy areas; checking generic versus project-specific ownership; finding duplicated, unclear, contradictory, stale, or token-wasteful guidance; or validating whether every line still earns its keep. For project documentation trees that are merely referenced by guidance, use docs-cleanup instead.
---

# Agent Documentation

Keep `AGENTS.md` complete, compact, loadable, provider-aware, and honest about
what is shared policy versus project fact.

## Seeding

When a repository has no `AGENTS.md`, or one that is not facts-only, seed:

- `AGENTS.md` with only the facts the global contract's preamble defines as
  that repository's own;
- `CLAUDE.md` containing exactly `@AGENTS.md`.

Generic rules live in the global contract (`instructions/AGENTS.md` in the
marketplace repository, installed per machine) and are never copied into a
repository. When migrating an existing file, keep every repository fact and
remove each generic rule the contract already states. A local policy that
differs from the contract is not kept as a second owner: report it to the
parent, who brings it to the operator, and leave it in place only until that
ruling. Report what was kept and what was removed.

## Procedure

1. Read `AGENTS.md` first. Read `CLAUDE.md` when present. Read only scoped
   project-owner docs needed to verify claims.
2. Classify each scoped file as entry point, shared guidance, project owner,
   provider glue, skill, custom agent, or record.
3. Verify concrete repository claims against source files, tests, config, and
   CI. Verify current provider behavior against primary docs when it affects the
   change.
4. Audit the guidance against the checklist. Treat each suspected issue as false
   until the files prove it.
5. Fix only confirmed issues when editing is requested. Move a rule to its
   owner instead of copying it. Delete stale or duplicated guidance.
6. After edits only, request up to three independent fresh-eye reviews from
   `capability-critic` where available, else a fresh-context reviewer. A
   read-only audit requests none. When a subagent runs this skill, it names the
   reviews it would request in its report instead of requesting them. Prefer a new isolated review context for
   each pass when provider-supported tooling is available and safe; otherwise
   run separate manual passes and report the limitation. Stop when a pass
   returns no findings. Pass only the skill path, scoped files, and the audit
   request; do not pass prior conclusions. Fix confirmed findings, then
   continue the loop.
7. Verify with the smallest command set that proves the documentation change:
   the README's check or verification sections, else the CI workflows.
   Do not run runtime tests for docs-only edits unless static policy or
   executable behavior is touched.

## Skill audit

When the target is an installed skill (not only its wording), also run the pass
in [references/skill-audit.md](references/skill-audit.md) and return its
distributor issue.

## Checklist

- Loading: entry-point files use provider-supported loading behavior. Do not
  invent imports or auto-load syntax.
- Ownership: the global contract owns generic policy; `AGENTS.md` contains
  project facts only, and project-owned files contain product intent, current
  architecture, tooling, or CI.
- Update duty: project owners say what must be updated when facts change; shared
  files change only when the reusable rule or skill improves.
- Token economy: every line adds a decision, boundary, trigger, invariant, or
  verification rule. `AGENTS.md` carries only what an agent cannot derive from
  the code: commands, repository-specific traps, owners, pointers. No overview,
  directory tree, version pin or copied shell sequence: overview and tree serve
  humans in the README and the architecture overview, a version lives in its
  manifest, and a terminal step is a command the repository ships.
  `AGENTS.md` stays within its length budget in
  [write-docs' document set](../write-docs/references/document-types.md#repository-document-set).
- Duplication: generic policy appears only in the global contract; project facts
  appear only in their project owner. A copy of the contract in a repository is a
  finding.
- Clarity: intent is direct, terms are defined by context, and vague advice is
  replaced by observable behavior or deleted.
- Consistency: current architecture, tooling, tests, commands, skills, and
  provider glue do not contradict each other.
- Truthfulness: implemented facts match files, and unknowns are marked.
- Audience and views: guidance and the docs it references name their reader
  and altitude; a document serving another audience is a view deriving from
  one owner, not an independently edited copy.
- Portability: reusable skills and agent bodies avoid product names, module
  names, daemon assumptions, and provider-specific paths unless that file owns
  provider glue.

## Output

Return:

```text
FIXED <file:line> <change and source verified>
FINDING <blocking|follow-up> <file:line> <problem> -> <fix>
KEPT <file:line> <why it is intentional>
UNKNOWN <question and source checked>
VERIFICATION <commands or review passes>
```

A read-only audit returns FINDING, KEPT, UNKNOWN and VERIFICATION lines only,
then `CLEAN` when no findings remain; FIXED lines appear only when editing was
requested.

Severity: `blocking` is a defect against the skill's contract or a repository
rule, or anything touching data safety, security, secrets, a public contract or
a failing check; `follow-up` is polish with no behavioural effect, or work
outside the audited skill's scope.
A pointer to another owner (for example the coordination contract named at the
top of `AGENTS.md`) is in scope only for whether its target exists; its content
belongs to that owner.

End with `CLEAN` when no findings remain.
