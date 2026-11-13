# lane

Reference for a head that starts or resumes the `lane` workflow. The workflow
takes one claimed lane to ready-to-land. Landing stays with the head; the result
lists `requiredHeadActions`.

## What it runs

1. Build: a builder runs the brief.
2. Review: a fresh Claude reviewer (Sonnet at high effort; Opus at medium on a
   material lane). A material lane adds a Codex gpt-6-astra final gate, or an
   Opus gate at high effort through `routing.gate`. A Claude reviewer that fails
   is started once more; only a second failure ends the round, with both texts
   in the reason.
3. Fix: fresh fixers answer evidence-bearing findings; whoever raised a finding
   re-checks the delta.
4. Test and CI run side by side: the explorative end-to-end test and the CI of
   the pull request. A red CI is fixed at once while the tester runs on.

The builder and every fixer run the targeted tests of their change and the fast
static checks the repository names after the last merge of the default branch;
the quality gate and the end-to-end tests run in CI.

The lane needs a repository that coordinates with aco, after the head ran
`aco start <item>` (worktree, branch and claim exist).

## Required args

- `item`: the GitHub issue number of the work item. The lane carries only issue
  items; an issue-less claim runs by hand.
- `worktree`: the lane's isolated worktree path.
- `branch`: the lane branch.
- `contract`: the item's ruled sentences every reviewer and the tester judge
  against.
- `e2e`: what the explorative tester drives through the real entry point.
- `scratch`: a directory for briefs, Codex output and test evidence.
- `build` (a builder brief) starts a new lane; `pr` and `tip` (an open pull
  request and its head sha) start a new run on an open pull request. Pass one of
  the two.

## Optional args

- `risk`: `"normal"` (default) or `"material"`, which adds a Codex gpt-6-astra
  final gate.
- `reviewer`: `"claude"` (default) or `"codex"`, which routes the review to Codex
  gpt-6-astra at medium effort, high on a material lane.
- `routing`: none by default. Per-role overrides `{role: {model, effort}}` of the
  table at the top of the script, for `build`, `fix`, `rework`, `test`, `review`,
  `gate`, `mechanical` and `copy` (the agent that reads a relay line again after
  an unreadable copy).
- `repo`: none by default; every `gh` call then targets the worktree's own
  repository. Pass `owner/name` when the head runs elsewhere.
- `productionPaths`: `["src/", "pyproject.toml", "uv.lock"]`, a default that fits
  a src-layout Python repository. Path prefixes whose change re-opens the gate on
  a material lane and re-runs the end-to-end test; passing it also lets a fresh
  reviewer stand in for a gate at its usage limit on a delta that touched none of
  them.
- `ledgers`: `[]`, a default that fits a repository without append-only ledgers.
  Files whose merge conflicts keep both sides, main's lines first.
- `generated`: `{}`. A map from a generated file's path to the command that
  regenerates it; a merge conflict confined to such files and ledgers is resolved
  by running the command on the merged tree, not escalated.
- `budgets`: `{review: 5, test: 2, ci: 3, total: 8}`, the fix rounds per phase and
  in total; a partial object overrides single keys.
- `deltaFrom`: none. A sha; review only the commits since it, after the head
  settled an awaiting-head result. Without it, a new run with `pr` and `tip` and
  `fixFirst` or `foldIn` reviews the whole lane, with the gate on a material lane.
- `answers`: none. What those commits answer.
- `fixFirst`: none. `Finding[]`, blocking findings a fresh fixer answers before
  anything else.
- `foldIn`: none. `Followup[]`, follow-ups for that fixer, each handed over
  whatever its owner or wording; given alone it still starts the fixer.
- `experiment`: none. A tag of 1 to 40 lowercase letters, digits or hyphens,
  appended to the Routing line as `Experiment: <tag>`.

## Routing defaults

On a normal lane: `mechanical` haiku/low, `copy` sonnet/low, `build` and `fix`
sonnet/medium, `test` sonnet/medium, `review` sonnet/high. On a material lane:
`build` and `fix` sonnet/high, `test` sonnet/high, `review` opus/medium, `gate`
gpt-6-astra/high.

- The fixer runs as `rework` (sonnet/high) from the third fix round of a run on,
  counted over review, test and ci rounds together. A continued run counts its
  rounds anew, so pass `routing.fix` for a lane already past its second round.
- A fix batch whose blocking findings are all docs and that carries no fold-ins
  runs as `mechanical` in every round.
- Effort is capped per model: opus at medium (except the stand-in gate) and every
  other model at high. An override above its cap is refused.
- The gate runs on another provider than the builder, except the one Claude gate
  opus/high, which `routing.gate` may name while Codex is at its usage limit and
  which runs as a fresh Claude reviewer. Any other Claude gate is refused at
  input.

## Protocol and awaiting-head results

- Before anything starts, the lane asks each of its children for its protocol.
  When one differs it ends at stage `input`, naming the child, both numbers and
  `/reload-plugins`.
- A child that refuses for a protocol mismatch later in the run (atelier
  installed while the lane ran) ends the lane awaiting-head at that stage with
  `/reload-plugins` and the resume arguments (`pr`, `tip`) instead of failed.
- A Codex courier that wrote a different brief than the script composed is
  started once more. A second mismatch returns awaiting-head at stage `review`
  with the resume arguments of the usage limit (`pr`, `tip`, and on a delta round
  `deltaFrom` and `answers`) instead of failed.
- A courier that cuts its brief out of its own workflow transcript and finds
  none, twice, returns awaiting-head at stage `review` with `requiredHeadActions`
  (report the defect to marketplace, run the gate through `routing.gate`) and no
  resume.
- A networked call of the scope or ci printer that fails with a network error
  (cannot resolve or connect to GitHub) is retried twice after 30 seconds; a
  call that stays unreachable ends the lane awaiting-head at `scope` (resume
  with a new run with `pr` and `tip`, and `deltaFrom` where the stop names it) or
  at `ci` (resume with `pr` and `tip`; a resume from `ci` runs scope and the
  review again) with "GitHub is unreachable" instead of failed.
- A fixer that answers its whole batch in the pull request body or an item
  comment and commits nothing is no failure.

## Result

The result carries `routingLine`, the one Routing line the head pastes as is,
and `requiredHeadActions`.
