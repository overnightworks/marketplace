# Deadweight lens

Judge whether code has earned its place, not whether it is well written. The
operator's law governs every finding: code only grows with a reason, and when
something new lands its predecessor leaves in the same stroke. Static tools
(vulture, coverage, lint) cannot answer these questions — vulture counts a test
import as "used", and a never-enabled feature flag looks perfectly alive to
every mechanical check. This lens produces the deletion list; it never
executes it.

Standing audit: after every ~25 trunk landings until two consecutive passes
come back clean, then after every ~50 landings or weekly. Standing-item
subject: dead weight, ballast.

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
   not a fixed vocabulary).

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
  same question, hand the pair to `ownership.md` instead of judging it here.
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

Test ballast and near-duplicate test parametrization belong to the Test size
check in `tests.md`; route them there.

Before proposing to delete code with no production caller, search the board
for an open item that names it as its caller (an idea or plan paragraph does
not count): such code is "frozen (item #n)", never a cut, per the code
policy's frozen-code rule in the global contract. A feature someone uses is
never a cut; put it on an operator decision list.

## Output

Hand-offs: ownership.md (near-duplicate pairs), tests.md (Test size).

Return the finding records of `SKILL.md`, ranked by `Saves`, largest first,
with `<lens>/<check>` being `deadweight/<hunt category>`. Extra fields: `Change`
lists the files and symbols to delete, including tests that only serve them,
and `Survivor: <owner to keep>` for merges. The head turns the records into
retire/delete work items or one consolidated diet item.

With no finding left, print `deadweight: no findings`, then the KEPT list, the
"suspected, unproven" leads and the prevention check. Otherwise end with: the
total deletable line count; the KEPT list — what was examined and retained
because history shows it earning its place (a rescue, a caught bug, a
prevented loss), so the audit never reads as "delete all safety"; the
"suspected, unproven" leads; and the prevention check: every open
replacement/redesign work item in the audited area (list them with
`gh issue list --state open --search "replace OR redesign OR rewrite"`, or the
work-item board; only items that name a surface inside the audited area count)
must carry demolition of its predecessor in its acceptance criteria — flag
(never edit) items that lack it, because that gap is how zombies are born.
