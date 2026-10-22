---
name: docs-cleanup
description: Clean and audit documentation trees. Use when asked to organize docs, move plans out of documentation into issues, fix documentation drift, reconcile contradictions, repair dead links, or review docs for stale claims. For AGENTS.md, CLAUDE.md, skills, custom agents, and hooks, use agent-documentation instead.
---

Keep documentation honest. A document is current, a retained record,
generated, or a frozen mockup (the one target picture). A plan, roadmap or
concept file is a finding: propose moving its open parts to their item,
folding built parts into the current document and taken decisions into the
architecture overview or a decision record, and deleting the file. Code and
configured contracts are the source of truth for implemented behavior.

Out of scope: `AGENTS.md`, `CLAUDE.md`, skills, agents, and hooks. Leave them
and note "out of scope: agent-documentation" in the report.

## Procedure

1. Read the code policy's documentation rules and the repository's documentation facts
   (`AGENTS.md`, `README.md`, a `docs/` index if present).
2. Give each scoped document two labels. Its type is one of
   [write-docs' document types](../write-docs/references/document-types.md),
   taken from its path or its content. Its status is
   current, record, generated, mockup, or unknown, and its reader is the one
   its type names.
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
- A plan, roadmap, wish list, status table or unbuilt target other than a
  frozen mockup is a finding (`PROPOSE move-to-board <file:section>`) naming its
  owning item (`gh issue list --state all --search`), whose body takes the open
  part; with `no owner`, the head decides between an idea and dropping it, and
  the pass opens no item.
- A frozen mockup is checked only for being blessed (named in its item) and,
  after the landing that built its surface, for being aligned with what was
  built; it has no length budget.
- Each part of a plan is sorted as built (current document), decided
  (architecture overview or a decision record), open (its owning item's body)
  or obsolete (deleted).
- A history section, or an issue number used as provenance, goes from a current
  document; git and the items keep the history, and a fact the reader still
  needs becomes plain words; an issue number that stays still names the item
  it meant.
- Content for another reader moves to that reader's document.
- A document over its type's length budget, or with a picture its type's
  `Picture` line in write-docs' document types does not allow, is a finding.
- Concrete paths, commands, module names, options, and config keys exist.
- Cross-doc facts have one owner; mirrors point to the owner instead of drifting.
- Links and path references resolve: `test -e` for each relative link target,
  `git ls-files --error-unmatch <path>` for each named path. A link into a
  submodule that is not checked out is reported UNVERIFIED, not dead.
- Examples are real enough to run in the repository's stack.
- A shell sequence an operator copies by hand is a finding handed to the item
  that will ship its command (global contract, Documentation); the document
  keeps it until that command exists.
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

Plans without an owner go to the head as one table,
`| plan (file:section) | recommendation: idea or drop | reason |`.

End with `CLEAN` when no changes or proposals remain.
