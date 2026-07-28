---
name: audit-deadweight
description: Audit code for existence justification rather than quality — find dead paths, test-only-alive code, zombie predecessors after replacements, duplicated machinery, ceremony, and hardening without a threat. Use when asked to find dead or unused code, shrink the codebase, check what can be deleted, or verify a replacement removed its predecessor; also on a schedule — initially after every ~25 trunk landings until two consecutive passes come back clean, then relaxed to ~50 landings or weekly; due-ness is owned by the standing board item's anchor "last run at commit X", never by anyone's memory, and each run writes the new anchor into that item — and after any UI or feature replacement.
---

Judge whether code has earned its place, not whether it is well written.
**Strictly read-only: this audit produces the deletion list; it never executes
it.** The operator's law governs every finding: code only grows with a reason,
and when something new lands its predecessor leaves in the same stroke. Static
tools (vulture, coverage, lint) cannot answer these questions — vulture counts
a test import as "used", and a never-enabled feature flag looks perfectly
alive to every mechanical check.

## Procedure

1. Establish scope: full repository on the scheduled run; on a
   post-replacement run, the replaced feature's old surface plus everything
   only it referenced. For "reinvented wheels", the diff window is everything
   landed since the previous deadweight pass.
2. Build the reachability picture from REAL entry points only — the
   composition root, registered CLI commands, registered HTTP routes, started
   loops, frontend routes actually linked from navigation, and (for a library
   or plugin) its documented public API. Tests, fixtures, and re-export
   barrels do not count as reachability.
3. Prove absence against dynamic dispatch too, not just missing static
   imports: search for the symbol's string name at registry, reflection,
   template, event-handler, scheduled-job, and migration sites before calling
   it unreachable.
4. For every finding, collect proof before reporting: the import graph, the
   caller search, the commit that replaced it, the flag default, or an
   architecture doc naming it dormant (phrases like "unwired" are examples,
   not a fixed vocabulary). A lead you cannot prove goes into a short
   "suspected, unproven" section — never into the deletion list.

## What to hunt

- **Test-only-alive code**: modules whose only non-test reachability is other
  dead modules. The test suite simulating life is part of the finding — count
  its lines into the deletion.
- **Unwired features**: flags that default off and are enabled nowhere, CLI
  entry points registered nowhere, loops nothing starts, endpoints no
  frontend or client calls.
- **Zombie predecessors**: a successor landed (commit as proof) but the old
  page, route, component, panel, or code path still ships. After UI changes
  this is the first check: did the old surface leave in the same stroke?
- **Duplicated machinery**: the same encode/decode/store/validate pattern
  copied per feature where one generic owner would serve; near-identical
  modules differing only in names. Name the surviving owner.
- **Reinvented wheels**: code landed since the last pass that reimplements a
  helper that already existed at the time, instead of calling it.
- **Hardening without a threat**: protections whose threat cannot occur in
  this deployment (multi-tenant defenses with one tenant, sandboxes that
  default off, "security" checks that only match shapes and stop nothing).
  Never touch protections with documented saves — check history first.
- **Cap artifacts** (only where the repository enforces size/complexity
  caps): files that exist only because a cap split them (shim/facade
  docstrings often admit this), re-export barrels, port indirections with a
  single caller on each side.
- **Test ballast**: per-module test-to-production ratios far above the
  repository norm without behavioral justification. Route near-duplicate
  test parametrization to audit-tests — that is a quality finding.

## Output

Return the report inline; the dispatching caller turns findings into
retire/delete work items or one consolidated diet epic (on this deployment
the work board lives at the atelier server's `/api/work`; the auditor itself
posts nothing). Rank by deletable lines, largest first:

```text
[~<lines>] <hunt category> - <path/module>
Proof: <import graph / commit / flag default / doc>
Delete: <files and symbols, incl. tests that only serve it>
Survivor: <owner to keep, for merges>
```

End with: the total deletable line count; the KEPT list — what was examined
and retained because history shows it earning its place (a rescue, a caught
bug, a prevented loss), so the audit never reads as "delete all safety"; the
"suspected, unproven" leads; and the prevention check: every open
replacement/redesign work item must carry demolition of its predecessor in
its acceptance criteria — flag (never edit) items that lack it, because that
gap is how zombies are born. If nothing qualifies, output `NO DEADWEIGHT`.
