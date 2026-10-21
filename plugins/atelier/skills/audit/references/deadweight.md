# Deadweight lens

Judge whether code has earned its place, not whether it is well written.
The operator's law: code only grows with a reason, and when something new
lands its predecessor leaves in the same stroke. This lens produces the
deletion list; it never executes it.

Standing audit: every ~25 trunk landings until two clean passes, then every
~50 or weekly. Standing-item subject: dead weight, ballast.

Hand-offs: tests.md (Test size; test ballast and near-duplicate test
parametrization go there).

## Procedure

1. Scope: full repository on the scheduled run; on a post-replacement run, the
   replaced feature's old surface plus everything only it referenced. For
   "reinvented wheels", the diff window is everything landed since the
   previous deadweight pass; the library half is not limited to it.
2. Build reachability from REAL entry points only: the composition root,
   registered CLI commands and HTTP routes, started loops, frontend routes
   linked from navigation, a library's or plugin's documented public API; in a
   tooling repository, what CI workflows, hooks, manifests and published
   actions invoke. Tests, fixtures and re-export barrels do not count.
3. Prove absence against dynamic dispatch: search the symbol's string name at
   registry, reflection, template, event-handler, scheduled-job and migration
   sites before calling it unreachable.
4. Collect proof for every finding: import graph, caller search, the commit
   that replaced it, the flag default, or an architecture doc naming it dormant.

## What to hunt

- **Test-only-alive code**: modules whose only non-test reachability is other
  dead modules. Count the simulating test lines into the deletion.
- **Unwired features**: flags that default off and are enabled nowhere, CLI
  entry points registered nowhere, loops nothing starts, endpoints no
  frontend or client calls.
- **Zombie predecessors**: a successor landed (commit as proof) but the old
  page, route, component, panel or code path still ships. After UI changes
  check first that the old surface left.
- **Duplicated machinery**: the same encode/decode/store/validate pattern
  copied per feature where one generic owner would serve. Name the surviving
  owner.
- **Reinvented wheels**: code landed since the last pass that reimplements a
  helper that already existed, or what the standard library, a maintained
  dependency already in the tree, or a linter rule the repository runs
  provides.
- **Hardening without a threat**: a protection whose threat the trust model
  excludes (quote the line) or the deployment cannot produce (cite the proof).
  Before relying on a model exclusion, check the model against the code
  (listen addresses, entry points, who writes the inputs); a contradiction
  goes to `security` as a `HIGH` finding, and nothing is cut. A protection
  that stops nothing against a threat the model admits goes to `security` as
  an ineffective defence, never as a cut. Never touch protections with
  documented saves; check history first.
- **Cap artifacts** (only where the repository enforces size/complexity
  caps): files that exist only because a cap split them (shim/facade
  docstrings often admit this), re-export barrels, port indirections with a
  single caller on each side.

Before proposing to delete code with no production caller, search the board
for an open item that names it as its caller (an idea or plan paragraph does
not count): such code is "frozen (item #n)", never a cut, per the code
policy's frozen-code rule. A feature someone uses is never a cut; put it on an
operator decision list with its evidence (last commit, production callers,
logs where the repository has them); the operator decides.

## Output

Return the finding records, ranked by `Saves`, largest first, with
`<lens>/<check>` being `deadweight/<hunt category>`. Extra fields: `Change`
lists the files and symbols to delete, including tests that only serve them,
and `Survivor: <owner to keep>` for merges. The head turns the records into
retire/delete work items or one consolidated diet item.

Close with the total deletable line count; the KEPT list (retained because
history shows it earning its place: a rescue, a caught bug, a prevented loss);
the suspected-unproven leads; and the prevention check: every open
replacement/redesign work item in the audited area (`gh issue list --state open
--search "replace OR redesign OR rewrite"` or the board; only items naming a
surface in the area) must name its predecessor and that predecessor's exit, as
the global contract's predecessor rule ("How to decide") requires. Flag, never
edit, an item that breaks the rule, or a kept predecessor that is still being
invested in.
