---
name: docs-cleanup
description: Clean and audit documentation trees. Use when asked to organize docs, separate plans from reference docs, fix documentation drift, reconcile contradictions, repair dead links, or review docs for stale claims. For AGENTS.md, CLAUDE.md, skills, custom agents, and hooks, use agent-documentation instead.
---

Keep documentation honest. A document should be current, a plan/spec for
not-yet-built work, or an explicitly retained record. Code and configured
contracts are the source of truth for implemented behavior.

Out of scope: `AGENTS.md`, `CLAUDE.md`, skills, agents, and hooks. Leave them
and note "out of scope: agent-documentation" in the report.

## Procedure

1. Read the repository documentation guidance (`AGENTS.md`, `README.md`, a
   `docs/` index if present).
2. Give each scoped document two labels. Its type is one of
   [write-docs' document types](../write-docs/references/document-types.md),
   read from its `Type:` line (or `type:` key) and inferred from content when absent. Its status
   is current, plan/spec, record, generated, or unknown.
3. Verify concrete claims against code, configuration, tests, or canonical
   docs. A claim you cannot check here (external service, version, vendor
   behavior) is reported as `UNVERIFIED`, not guessed.
4. Apply safe reversible fixes when explicitly asked to edit. Otherwise report
   proposed changes.
5. Do not delete human-authored docs blindly. Propose deletion only after
   confirming the file is unreferenced, duplicated, and not intentionally kept.

## Checklist

- The document stays within its type: a how-to that drifts into explanation,
  or a reference that carries tutorial steps, is split into one document per
  type, linked, with each fact kept in one place.
- Plans are not presented as current architecture.
- Current architecture docs do not describe unimplemented targets as facts.
- Concrete paths, commands, module names, options, and config keys exist.
- Cross-doc facts have one owner; mirrors point to the owner instead of drifting.
- Links and path references resolve: `test -e` for each relative link target,
  `git ls-files --error-unmatch <path>` for each named path.
- Completed migration notes are archived or reframed as history, not pending
  work.
- Examples are real enough to run in the repository's stack.
- Documentation remains compact and useful to the next agent.

## Output

Use this format:

```text
MOVED <old> -> <new> (reason; includes splits by type)
FIXED <file:line> (what changed; verified against <source>)
PROPOSE <action> <file> (why it needs confirmation)
KEPT <file> (why it looked stale but remains intentional)
UNVERIFIED <file:line> (claim; why it cannot be checked here)
```

End with `CLEAN` when no changes or proposals remain.
