---
name: docs-cleanup
description: Clean and audit documentation trees. Use when asked to organize docs, separate plans from reference docs, fix documentation drift, reconcile contradictions, repair dead links, or review docs for stale claims.
---

Keep documentation honest. A document should be living reference material, a
plan/spec for not-yet-built work, or an explicitly retained record. Code and
configured contracts are the source of truth for implemented behavior.

## Procedure

1. Read the repository documentation guidance.
2. Classify each scoped document as reference, plan/spec, record, generated
   artifact, or unknown.
3. Verify concrete claims against code, configuration, tests, or canonical docs.
4. Apply safe reversible fixes when explicitly asked to edit. Otherwise report
   proposed changes.
5. Do not delete human-authored docs blindly. Propose deletion only after
   confirming the file is unreferenced, duplicated, and not intentionally kept.

## Checklist

- Plans are not presented as current architecture.
- Current architecture docs do not describe unimplemented targets as facts.
- Concrete paths, commands, module names, options, and config keys exist.
- Cross-doc facts have one owner; mirrors point to the owner instead of drifting.
- Links and path references resolve.
- Completed migration notes are archived or reframed as history, not pending
  work.
- Examples are real enough to run in the repository's stack.
- Documentation remains compact and useful to the next agent.

## Output

Use this format:

```text
MOVED <old> -> <new> (reason)
FIXED <file:line> (what changed; verified against <source>)
PROPOSE <action> <file> (why it needs confirmation)
KEPT <file> (why it looked stale but remains intentional)
```

End with `CLEAN` when no changes or proposals remain.
