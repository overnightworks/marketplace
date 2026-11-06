---
name: docs-cleanup
description: Clean and audit documentation trees. Use when asked to organize docs, move plans out of documentation into issues, fix documentation drift, reconcile contradictions, repair dead links, or review docs for stale claims. For AGENTS.md, CLAUDE.md, skills, custom agents, and hooks, use agent-documentation instead.
---

Keep documentation honest. A document is current, generated, or the mockup
of an unfinished surface. Whatever write-docs' document set keeps out of the
tree is a finding: propose moving its open parts to their item and its reasons
that still hold beside their code or into the architecture overview, and
deleting the rest.
Code and configured contracts are the source of truth for implemented behavior.

Out of scope: `AGENTS.md`, `CLAUDE.md`, skills, agents, and hooks. Leave them
and note "out of scope: agent-documentation" in the report.

## Procedure

1. Read the code policy's documentation rules and the repository's documentation facts
   (`AGENTS.md`, `README.md`).
2. Give each scoped document two labels. Its type is one of
   [write-docs' document types](../write-docs/references/document-types.md),
   taken from its path or its content. Its status is
   current, generated, mockup, or unknown, and its reader is the one
   its type names.
3. Verify concrete claims against code, configuration, tests, or canonical
   docs. A claim you cannot check here (external service, version, vendor
   behavior) is reported as `UNVERIFIED`, not guessed.
4. Apply safe reversible fixes when explicitly asked to edit. Otherwise report
   proposed changes.
5. Do not delete human-authored docs blindly. Propose deletion only after
   confirming the file is unreferenced, duplicated, and not intentionally kept.

## Checklist

- The document stays within its type: a runbook that drifts into explanation,
  or a reference that carries steps, is split into one document per type,
  linked, with each fact kept in one place.
- Content on write-docs' never-in-the-tree list ([Repository document
  set](../write-docs/references/document-types.md)), other than a blessed
  mockup, is a finding. A plan, roadmap, unbuilt target, concept or status table
  is `PROPOSE move-to-board <file:section>` naming its owning item (`gh issue
  list --state all --search`), whose body takes the open part; with `no owner`,
  the head decides between an idea and dropping it, and the pass opens no item.
- A mockup is checked only for being blessed (named in its item); one whose
  surface is finished is a finding to delete. It has no length budget.
- Each part of a plan is sorted as built (current document), decided
  (the current document that owns it), open (its owning item's body)
  or obsolete (deleted).
- A history section, or a date, ruling marker or item number on a sentence,
  goes; a fact the reader still needs becomes plain present-tense words. A spec
  ID its tests cite stays.
- Prose that restates code, and a Not chosen line whose reopen condition holds,
  are findings.
- Content for another reader moves to that reader's document.
- A document over its type's length budget, or with a picture its type's
  `Picture` line in write-docs' document types does not allow, is a finding.
- Concrete paths, commands, module names, options, and config keys exist.
- Cross-doc facts have one owner; mirrors point to the owner instead of drifting.
- Links and path references resolve: `test -e` for each relative link target,
  `git ls-files --error-unmatch <path>` for each named path. A link into a
  submodule that is not checked out is reported UNVERIFIED, not dead.
- Examples are real enough to run in the repository's stack.
- A shell sequence an operator copies by hand is a finding
  (`PROPOSE ship-command <file:section>`) naming the item that will ship its
  command (code policy, Documentation); with `no owner` it goes to the head
  like a plan, and the pass opens no item. The document keeps the sequence
  until that command exists.
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

Plans and shell sequences without an owner go to the head as one table,
`| plan or sequence (file:section) | recommendation: idea or drop | reason |`.

End with `CLEAN` when no changes or proposals remain.
