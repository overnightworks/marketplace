# lane

Reference for a head that starts or resumes the `lane` workflow. The workflow
takes one claimed lane to ready-to-land. Landing stays with the head; the result
lists `requiredHeadActions`.

## What it runs

1. Build: a builder runs the brief and answers with `reuse`, a required
   string: the owner it extended (module and function), or the search it ran and
   why nothing found fits. The first review receives that text with the
   instruction to judge it; a run started with `pr` and `tip` has none and says
   so to the reviewer.
2. Review: a fresh Claude reviewer (Sonnet at high effort; Opus at medium on a
   material lane). A material lane adds a Codex gpt-6-astra final gate, or an
   Opus gate at high effort through `routing.gate`. A Claude reviewer that fails
   is started once more; only a second failure ends the round, with both texts
   in the reason.
3. Fix: fresh fixers answer evidence-bearing findings; whoever raised a finding
   re-checks the delta.
4. Test and CI run side by side: the explorative end-to-end test and the CI of
   the pull request. A red CI is fixed at once while the tester runs on. A tester
   round after a fix is a delta re-check: it gets the fix range and the findings it
   raised, still drives the real flow in full, and reports a new finding in a part
   the fix left unchanged as a follow-up unless it touches security, data or a
   failing check.

The builder and every fixer run the targeted tests of their change and the fast
static checks the repository names after the last merge of the default branch;
the quality gate and the end-to-end tests run in CI.

The lane needs a repository that coordinates with aco, after the head ran
`aco start <item>` (worktree, branch and claim exist).

## Required args

- `item`: the GitHub issue number of the work item. The lane carries only issue
  items; an issue-less claim runs by hand.
- `worktree`: the lane's isolated worktree path.
- `branch`: the lane branch. Before any agent works, the lane reads through
  its relay that `worktree` exists with `branch` checked out, and otherwise
  fails at stage `input` naming both values and what it found.
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
  A `deltaFrom` equal to `tip` fails at stage `input` before any agent runs, unless
  `fixFirst` or `foldIn` is given: then the review reads only the fixer's commits.
  Follow-ups after a ready-to-land run are fixed cheaply this way: a new run with
  `pr`, `tip`, `deltaFrom` = `tip` and `fixFirst` or `foldIn`, whose review covers
  only the fixer's commits. Otherwise drop it for a full review, or name the commit
  before the commits no reviewer has seen.
- `answers`: none. What those commits answer.
- `fixFirst`: none. `Finding[]`, blocking findings a fresh fixer answers before
  anything else. A `Finding` is `{ where, kind, text, rule, evidence }`, all
  strings: `where` starts with the path of the file (then `:LINE`, a comma, a
  space and text, or a parenthesis may follow; a `where` without a leading path,
  such as a CI check name, is judged by the fixer's whole commit range), `kind`
  is `defect`, `test-gap` or `docs`, `rule` the rule it breaks, `text` and
  `evidence` what is wrong and how it shows; `testDraft` (a path) is optional.
- `foldIn`: none. `Followup[]`, follow-ups for that fixer, each handed over
  whatever its owner or wording; given alone it still starts the fixer. A
  `Followup` is `{ where, text, owner }`, all non-empty strings: `where` the
  place, `text` what to do, `owner` the owning item `#n` or `distributor`. A
  follow-up has an optional `stage` (`review`, `gate`, `ci` or `test`), the stage
  that raised it; every follow-up the lane reports carries it. A round that fixes
  only fold-ins counts as a fix round under the first of their stages in that
  order, and under the stage it would count under without one when none names a stage.
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
  other model at high. An override above its cap, or a model the lane's routing
  lacks (such as Fable), is refused; more needs the operator's word and runs
  outside the lane workflow (`HEAD.md`, "Model routing").
- The gate runs on another provider than the builder, except the one Claude gate
  opus/high, which `routing.gate` may name while Codex is at its usage limit and
  which runs as a fresh Claude reviewer. Any other Claude gate is refused at
  input.

## Awaiting-head results

- A Codex courier that wrote a different brief than the script composed is
  started once more. A second mismatch returns awaiting-head at stage `review`
  with the resume arguments of the usage limit (`pr`, `tip`, and on a delta round
  `deltaFrom` and `answers`) instead of failed.
- A Codex courier kills the detached run when its run log stays unchanged for
  600 seconds (healthy gates stayed silent at most 39 seconds), and the review
  starts the courier once more with the same model. A second silent run returns
  awaiting-head at stage `review` with the resume arguments of the usage limit
  (`pr`, `tip`, and on a delta round `deltaFrom` and `answers`); the gate never
  falls back to another model.
- A courier that cuts its brief out of its own workflow transcript and finds
  none, twice, returns awaiting-head at stage `review` with `requiredHeadActions`
  (report the defect to marketplace, run the gate through `routing.gate`) and no
  resume.
- A networked call of the scope or ci printer that fails with a network error
  (cannot resolve or connect to GitHub) or that GitHub's rate limit refuses
  (primary or secondary) is retried twice after 30 seconds; a
  call that stays unreachable ends the lane awaiting-head at `scope` (resume
  with a new run with `pr` and `tip`, and `deltaFrom` where the stop names it) or
  at `ci` (resume with `pr` and `tip`; a resume from `ci` runs scope and the
  review again) with "GitHub is unreachable" instead of failed; a refusal by the
  rate limit says so in the reason. At `ci`, when review approved and the tester
  passed on the tip, `requiredHeadActions` name the head's way without a new run:
  read the tip's check runs over REST and land with the record once every one is
  green. The printer reads the pull request over REST (`gh api`), which spends no
  GraphQL points; `gh pr checks` stays on GraphQL.
- A CI answer that is not green and names no failing check, while the printed
  listing shows no failed check but a pending one or a run of the head not
  completed (the watcher's cap ended in a queue), ends the lane awaiting-head at
  `ci`: no fixer starts, no fix round is spent, the history records the step as
  `PENDING`, and the reason names the pending checks. Resume with `pr` and `tip`
  once CI has finished.
- A Claude agent of any stage (builder, reviewer, fixer, tester, CI reader or
  mechanical step) that fails with its account usage limit returns awaiting-head
  at its stage with `claudeLimit` (`resetsAt` when the error names a reset), the
  `history` so far and the resume arguments of that stage (`pr`, `tip`, and
  `fixFirst` or, on a review round, `deltaFrom` and `answers`; `build` before a
  pull request exists), never failed. A Claude reviewer is not retried on a
  limit, and no role moves to another model or provider.
- A fixer that answers its whole batch in the pull request body or an item
  comment and commits nothing is no failure.
- A fixer answers a finding as removed (dead code or a test that pins nothing)
  without copying a diff: the lane measures the diff of the finding's path in
  the fixer's commits (start tip to its tip, first-parent only, so a merge of
  main shows just its conflict resolution) and hands the raiser the size and
  the git command that prints it, which the raiser runs itself. A `where` that
  names no path (a CI check name), or whose path those commits leave untouched
  (a check reports where a rule is declared, the removal sits where it broke),
  is judged by the whole range of the fixer's commits, and the raiser is told
  that the finding's own path carries no diff. A removal whose range is empty
  fails the run at fix.
- A builder or fixer that returns no result while its worktree holds commits
  past the start tip or uncommitted work has that work committed as an
  unfinished checkpoint and pushed by a lane step (and, after a build, a draft
  pull request opened); the lane returns awaiting-head at stage `build` or
  `fix` with `resume` (`pr`, `tip` and `fixFirst`: the remaining blocking
  findings, or after a build a finding that tells a fresh finisher to complete
  the build brief). When the checkpoint push hits the claim scope or fails, the
  result is the ordinary `scope` (or `failed`) result, now carrying `resume`. A
  worktree with nothing new stays failed. A run resumed with that build
  finding as its only `fixFirst` entry goes on to the review when the fixer
  changes nothing and reports `briefMet`: the checkpoint is complete, and the
  review judges the whole lane as for a first build, even when `deltaFrom` is
  given. Any other finding a fixer leaves without a change still fails the
  run at `fix`. Before `ready-to-land`, a pull request still titled
  `Unfinished checkpoint of #<n>` gets the item's title by a relay step over
  REST; when that write fails, `requiredHeadActions` name the rename.

## Result

A result `ci-red` or `unresolved` from a spent budget carries `resume`: `pr`,
`tip`, `deltaFrom` equal to that tip and `fixFirst` holding the remaining
blocking findings. A new run with exactly these arguments starts at the fixer and
reviews only its commits.

The result carries `routingLine`, the one Routing line the head pastes as is,
`record` and `requiredHeadActions`.

`record` is the path of the lane record, `<scratch>/lane-record.json`, which aco reads
(its `specs/lane-record.spec.md` owns the schema). The script builds the record from its own
state: per stage the model and effort, the fix rounds and blocking findings by stage
(`review`, `gate`, `ci`, `test`; a stand-in counts as gate), the risk class, the experiment tag
the misses by stage (never above the blocking findings: a gate, CI or test finding raised after a
review approved the range counts, except a gate finding of the approving review's own round and a CI finding
whose check the CI reader marks `deterministic` and whose fix the fixer reports in `noBehaviourChange`; the
review stage counts none), and each review and gate verdict with the full sha it judged, the approving one last. No model retypes it: a
courier cuts it out of its own transcript into the file, compares its CRC32 with the script's, and only
then runs `aco lane-record check`, whose exit comes back on a CRC-signed printer line. Every status
a release can follow carries `record`. A record that fails the check turns `ready-to-land` into
`awaiting-head` at `record`, with `recordProblem` quoting aco; so does a tip no verdict judged (a clean merge of main after the last review), since aco lands only the head the last verdict judged, and `reason` names both shas; a run refused at input writes none, and a lane that hit the Claude usage limit at any point
may end without a record, since the record courier is a Claude agent (no code guard). The landing is `aco land <pr> --head <tip> --record <path>` and an
abandoned lane is released with `aco release <n> --abandoned REASON --record <path>`. The Routing line is still
printed, and pasted beside the record until aco stops reading it.
