---
name: audit-deadweight
description: Audit code for existence justification rather than quality — find dead paths, test-only-alive code, zombie predecessors after replacements, duplicated machinery, ceremony, and hardening without a threat. Use when asked to find dead or unused code, shrink the codebase, check what can be deleted, or verify a replacement removed its predecessor, and after any UI or feature replacement.
---

Judge whether code has earned its place, not whether it is well written.
**Strictly read-only: this audit produces the deletion list; it never executes
it.** The operator's law governs every finding: code only grows with a reason,
and when something new lands its predecessor leaves in the same stroke. Static
tools (vulture, coverage, lint) cannot answer these questions — vulture counts
a test import as "used", and a never-enabled feature flag looks perfectly
alive to every mechanical check.

## Cadence and anchor

Run after every ~25 trunk landings until two consecutive passes come back
clean, then after every ~50 landings or weekly.
Due-ness is owned by the standing board item, never by anyone's memory: its
body holds a line naming the last run's commit (for example
`last run at commit X`; the repository's own language is fine). Find the item
with `gh issue list --state open --search "Standing-Audit in:title"` in the
repository's work-item board (GitHub issues, or `aco board --json` where aco
runs) and take the one whose title, in the repository's language, names
this audit's subject (dead weight, ballast).
If one item covers two audits (for example ownership and ballast), the audits
share its anchor: a run of either resets it, so the report names which audit
ran. Count landings since X with
`git log --oneline --first-parent X..origin/<default>` (or the age `aco next`
shows where aco runs), or count the days since the run. If no item is found,
this is the first run: say so in the report and tell the head to open the
standing item. The audit stays read-only; the head writes the new anchor into
that item from the report.

## Procedure

1. Establish scope: full repository on the scheduled run; on a
   post-replacement run, the replaced feature's old surface plus everything
   only it referenced. For "reinvented wheels", the diff window is everything
   landed since the previous deadweight pass.
2. Build the reachability picture from REAL entry points only — the
   composition root, registered CLI commands, registered HTTP routes, started
   loops, frontend routes actually linked from navigation, and (for a library
   or plugin) its documented public API. In a tooling repository the entry
   points are what CI workflows, hooks, manifests, and published actions invoke
   (`.github/workflows/*.yml`, hook configuration, plugin manifests). Tests, fixtures, and re-export
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
  modules differing only in names. Name the surviving owner. Near-identical
  text only; if the copies differ in wording or behaviour yet answer the
  same question, hand the pair to audit-ownership instead of judging it here.
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
- **Test ballast**: a module whose test-to-production line ratio is
  more than twice the median ratio of the repository's modules, without
  behavioral justification. Pair module and test by name (`x.py` with
  `test_x.py`); list the files left unpaired and leave them out of the median.
  Route near-duplicate test parametrization to audit-tests — that is a
  quality finding.

## Output

Return the report inline; the dispatching caller turns findings into
retire/delete work items or one consolidated diet item on the work-item
board; the auditor itself posts nothing. Rank by deletable lines, largest first:

```text
[~<lines>] <hunt category> - <path/module>
Proof: <import graph / commit / flag default / doc>
Delete: <files and symbols, incl. tests that only serve it>
Survivor: <owner to keep, for merges>
```

On a clean run, print `NO DEADWEIGHT`, then the KEPT list, the "suspected,
unproven" leads and the prevention check. Otherwise end with: the total
deletable line count; the KEPT list — what was examined
and retained because history shows it earning its place (a rescue, a caught
bug, a prevented loss), so the audit never reads as "delete all safety"; the
"suspected, unproven" leads; and the prevention check: every open
replacement/redesign work item (list them with `gh issue list --state open
--search "replace OR redesign OR rewrite"`, or the work-item board) must
carry demolition of its predecessor in its acceptance criteria — flag (never
edit) items that lack it, because that gap is how zombies are born.
