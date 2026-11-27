# lane

Reference for a head that starts or resumes the `lane` workflow. The workflow
takes one claimed lane to ready-to-land. Landing stays with the head; the result
lists `requiredHeadActions`.

## What it runs

1. Build: a builder runs the brief and answers with `reuse`, a required
   string: the owner it extended (module and function), or the search it ran and
   why nothing found fits. The first review receives that text with the
   instruction to judge it; a run started with `pr` and `tip` has none and says
   so to the reviewer. The builder opens the pull request as its brief's RULES
   say, so a head's build brief never forbids it; an answer without an open pull
   request ends like a builder without a result (checkpoint, below).
2. Review: a fresh Claude reviewer (model and effort from `DEFAULT_ROUTING`). A
   material lane adds a Codex final gate, or a Claude gate through `routing.gate`. One normal lane in
   ten, the one whose item number is divisible by ten, gets the gate once, after its review approved
   a tip and before the tester and CI start: it reads the whole lane (`git diff origin/main...HEAD`,
   also on a run started with `deltaFrom`) on its own, in the round of that approval, so every blocking
   finding of the look is one the review let through and counts under `gate` with risk `normal` and no
   miss. Its findings go to a fix round and the gate re-checks them, as on a material lane; the gate
   is not repeated after later fixes. The look is a measurement: one that ends without a verdict (the
   courier's `limited`, `hung`, `brief-mismatch`, `no-brief-record` or `failed`) or whose `routing.gate`
   is on the builder's provider is skipped, the lane goes on, the history holds no gate entry, and the record and the Routing
   line show `gate none`. A re-check owed after a REVISE is never skipped. A Claude reviewer that fails
   is started once more; only a second failure ends the round, with both texts
   in the reason. The first review is told that a tester drives the lane's `e2e`
   text (quoted, cut at `TESTER_DRIVE_LIMIT` characters) after it: a proof only that drive
   produces is not a finding at review and is named "left to the tester", and a
   line neither the diff nor that drive proves stays blocking. Every lane has a
   tester, so the brief has no tester-less variant; later rounds do not repeat it.
3. Fix: fresh fixers answer evidence-bearing findings; whoever raised a finding
   re-checks the delta. A review that passes with in-place follow-ups open (the
   reviewer's or gate's `inPlace` true, or named in `foldIn`) starts one
   follow-up batch per run, when the review and total budgets allow it: a fixer
   resolves them, asked for no merge of main, and the review re-checks the delta
   (the gate too on a material lane when a fold-in came from the gate or the fix
   touched production). A follow-up the fixer declines, one the re-check raises
   and one left by a spent budget stay in `followups` for the head.
4. Test and CI run side by side: the explorative end-to-end test and the CI of
   the pull request. A red CI is fixed at once while the tester runs on. A tester
   round after a fix is a delta re-check: it gets the fix range and the findings it
   raised, still drives the real flow in full, and marks a new finding as the
   contract's Reviews does, against the lane's whole diff rather than the fix
   range. The order is review, tester, CI: the review proves what the
   diff shows, the tester proves what only the drive shows, CI proves the checks.
   No run ends while its tester runs: an early stop first waits for the tester,
   records a usable verdict and carries its findings in `testerAtStop`; a tester
   without a usable result (an error, no verdict, a load wait) is named in the
   run's `reason`.

The builder and every fixer run the targeted tests of their change and the fast
static checks the repository names after the last merge of the default branch;
the quality gate and the end-to-end tests run in CI.

The lane needs a repository that coordinates with aco, after the head ran
`aco start <item>` (worktree, branch and claim exist).

## Surfaces

In a repository that declares `surface_paths` in `.aco/board.toml`, the scope check relays how many paths
`aco brief <item> --json` lists under `touched_surfaces`; a key aco does not print is unknown, not "no surface".
The design skill is advice and never blocks a landing:

- The builder, and a fixer carrying `fixFirst` or `foldIn` before the first scope check, are told to check
  after each commit whether `touched_surfaces` lists a path and to load `atelier:design-interface` once it does.
  Every later fixer is told directly while the count is above 0; a count of 0 or unknown tells nobody.
- While the count is above 0 at its start, the tester captures each changed view in a real browser after it has
  judged its cells, and reports `design`: `capture` is `captured`, `test-only` or `gap` (with a note), and each
  observation becomes a follow-up with `inPlace: false` and stage `test`, which no fixer is given.

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

- `risk`: `"normal"` (default) or `"material"`, which adds a Codex final gate.
- `reviewer`: `"claude"` (default) or `"codex"`, which routes the review to Codex
  (model and effort from `DEFAULT_ROUTING`).
- `routing`: none by default. Per-role overrides `{role: {model, effort}}` of the
  table at the top of the script, for `build`, `fix`, `rework`, `test`, `review`,
  `gate`, `mechanical` and `copy` (the agent that reads a relay line again after
  an unreadable copy).
- `operatorWord`: none by default. A non-empty string, the operator's words as
  the item quotes them. With it, a `routing` override may name a Claude role
  at `xhigh` or `max` and the model `fable`, and the per-model effort cap does
  not apply; the efforts each provider accepts are `PROVIDER_EFFORTS` in
  `lane/main.js`, and a Codex role stays at `low`, `medium` or `high`. Provider
  separation, reviewer independence and the stand-in rule hold as without it.
  Before any builder or reviewer starts, the branch step reads the item body and
  checks that the word equals the whole text between one pair of quotation
  marks (`"…"`, `„…“` or `“…”`, whitespace runs folded), so pass the full
  quote, not a run from inside a longer one; a body that does not hold it, or a
  printer that received another word, ends the lane `failed` at `input`. The
  check proves the item holds the word, not who said it. The result carries
  `operatorWord`, and its `requiredHeadActions` tell the head to quote it with
  its source in the pull request body before landing; the record and the Routing
  line hold no quote.
- `repo`: none by default; every `gh` call then targets the worktree's own
  repository. Pass `owner/name` when the head runs elsewhere.
- `productionPaths`: `PRODUCTION` in `lane/main.js` is the default. Path prefixes whose change re-opens the gate on
  a material lane and re-runs the end-to-end test; passing it also lets a fresh
  reviewer stand in for a gate at its usage limit on a delta that touched none of
  them.
- `ledgers`: none by default. Files whose merge conflicts keep both sides, main's lines first.
- `generated`: `{}`. A map from a generated file's path to the command that
  regenerates it; a merge conflict confined to such files and ledgers is resolved
  by running the command on the merged tree, not escalated. A conflict that
  reaches any other file goes to a fixer (see the sync conflict below).
- `budgets`: `B` in `lane/main.js` holds the defaults, the fix rounds per phase and
  in total; a partial object overrides single keys.
- `deltaFrom`: none. A sha; review only the commits since it, after the head
  settled an awaiting-head result. Without it, a new run with `pr` and `tip` and
  `fixFirst` or `foldIn` reviews the whole lane, with the gate on a material lane.
  A `deltaFrom` equal to `tip` fails at stage `input` before any agent runs, unless
  `fixFirst` or `foldIn` is given: then the review reads only the fixer's commits,
  or the whole lane when the fixer commits nothing.
  Follow-ups after a ready-to-land run are fixed cheaply this way: a new run with
  `pr`, `tip`, `deltaFrom` = `tip` and `fixFirst` or `foldIn`, whose review covers
  only the fixer's commits. Otherwise drop it for a full review, or name the commit
  before the commits no reviewer has seen.
  A head that settled a blocking finding in the item body or the pull request body,
  with the tip unchanged, starts a new run with `pr`, `tip`, `deltaFrom` = `tip`,
  `fixFirst` holding the finding and `answers` holding its sentence: the fixer
  names the body in `outside` and commits nothing, and every reviewer of the round
  re-checks the whole unchanged tip against both bodies, read live. A run
  `escalated` at `fix` from a blocked fixer carries this as `resume` (`pr`,
  `deltaFrom`, `fixFirst`) and asks for the branch's current head as `tip`. Drop
  `deltaFrom` for a full review when the first review stopped early (limit,
  failure, architectural) or the body change adds requirements.
- `syncOnly`: none. `true` with `pr` and `tip` keeps an approved lane current with
  main: the run merges main as every run with `pr` and `tip` does, then runs the scope
  check and CI, and starts no review, gate or tester agent. Main already in the tip ends
  awaiting-head at `sync` with nothing changed. The operator's-door verdict ends it
  awaiting-head at `ci`. Any other red check goes to a fixer as in every run, and its
  commits get the normal delta review. A conflict in the lane's own files goes to a
  fixer, then review, and the gate on a material lane, as in every run. A green CI ends
  awaiting-head at `record`, because a sync carries no verdict aco's record accepts;
  a lane that lands through `aco land` starts a new run with `deltaFrom` at the judged
  tip instead. `syncOnly` beside `build`, `fixFirst`, `foldIn` or `deltaFrom` fails at
  stage `input`; the check that refuses `deltaFrom` equal to `tip` stays whole.
- `answers`: none. What those commits answer, or the head's sentence on a finding
  settled in a body.
- `fixFirst`: none. `Finding[]`, blocking findings a fresh fixer answers before
  anything else. A `Finding` is `{ where, kind, text, rule, evidence }`, all
  strings: `where` starts with the path of the file (then `:LINE`, a comma, a
  space and text, or a parenthesis may follow; a `where` without a leading path,
  such as a CI check name, is judged by the fixer's whole commit range), `kind`
  is `defect`, `test-gap` or `docs`, `rule` the rule it breaks, `text` and
  `evidence` what is wrong and how it shows; `testDraft` (a path) is optional.
  A finding the item body or the pull request body answers, settled by the head,
  is passed here with `deltaFrom` = `tip` and `answers`; the fixer names the body
  in `outside` and commits nothing.
- `foldIn`: none. `Followup[]`, follow-ups for that fixer, each handed over
  whatever its owner or wording; naming one here counts as in place, and given
  alone it still starts the fixer. A
  `Followup` is `{ where, text, owner }`, all non-empty strings: `where` the
  place, `text` what to do, `owner` the owning item `#n` or `distributor`; its
  `inPlace` boolean is optional here, since naming it already says so. A
  follow-up has an optional `stage` (`review`, `gate`, `ci` or `test`), the stage
  that raised it; every follow-up the lane reports carries it. A round that fixes
  only fold-ins counts as a fix round under the first of their stages in that
  order, and under the stage it would count under without one when none names a stage.
  The fixer may answer `declined: [{ foldIn, reason }]` for a fold-in that does not
  meet `IN_PLACE_RULE`: it is not folded in, stays in `followups` with its
  `declined` reason and is handed to no later fixer, and a fixer that changes nothing
  with every fold-in satisfied or declined is accepted. A fold-in a body or comment
  answers goes in `outside: [{ foldIn, where }]`, `foldIn` its number in the list
  (as in `resolved` and `declined`) and `where` the body section or comment URL. A round without blocking
  findings asks the fixer for no merge of main; its review range
  reads "It answers these follow-ups:". A fixer of such a round that returns no
  result or is blocked carries `foldIn` and `deltaFrom` in `resume`.
- `experiment`: none. A tag of 1 to 40 lowercase letters, digits or hyphens,
  appended to the Routing line as `Experiment: <tag>`.

## Routing defaults

`DEFAULT_ROUTING` in `lane/main.js` is the table, by the lane's risk.

- The fixer runs as `rework` from the third fix round of a run on,
  counted over review, test and ci rounds together. A continued run counts its
  rounds anew, so pass `routing.fix` for a lane already past its second round.
- A fix batch whose blocking findings are all docs and that carries no fold-ins
  runs as `mechanical` in every round.
- Effort is capped per model (`EFFORT_CAP`, except the stand-in gate; a model
  without an entry is capped at high). Without `operatorWord`, an override above its cap, or a
  model the lane's routing lacks (such as Fable), is refused, and the refusal
  names `operatorWord`; with it, see Optional args (`HEAD.md`, "Model routing").
- The gate runs on another provider than the builder, except the one Claude gate
  opus/high, which `routing.gate` may name while Codex is at its usage limit and
  which runs as a fresh Claude reviewer. Any other Claude gate is refused at input.
- A Codex gate run that exits above 0 and whose last non-empty run-log line starts with
  `ERROR: The '<the routed gate model>' model is not supported` is refused for its model;
  the script re-checks that line as it does the usage limit's. On a material lane the lane
  then runs the opus/high stand-in itself, a fresh Claude reviewer with the gate's brief, in the
  same round as the review, whose verdict is kept. The stand-in holds for the rest of the
  run: later gate rounds run on it with no new Codex courier, and the Routing line, the
  record, `routing` and the head actions name opus/high as the gate. The head names it in the pull
  request. A new run tries Codex first. A normal lane's sampled look or owed re-check, a
  refused ordinary review, a login error, an unknown model, a capacity line and any other
  failed run keep their ends.

## Awaiting-head results

A lane approved at its head that ends awaiting-head at `ci` for the operator's merge door
(the only red check is the verdict of declared loosenings) falls behind main while it waits;
a new run with `pr`, `tip` and `syncOnly: true` merges main into it and runs the scope check
and CI for the cost of a clean trunk merge; its door-red CI ends at `ci` again, with the
head current for the operator's merge.

A head that finds a run stopped awaiting-head, or lost, reads `aco lane-record show <n> --json`. The lane is approved at a tip when its stored runs hold an approving verdict at that sha for every stage its risk requires: review, and the gate on a material lane. Land with `aco land <pr> --head <sha>` only when the lane is approved at the pull request's head, a stored run that ran `test` ends at that tip with `blocking.test` 0, and CI is green there. Otherwise start a new run: with `pr`, `tip` and `deltaFrom` the last approved tip when it is an ancestor of the head, not the head itself, and the head has no approving review; with `pr` and `tip` and no `deltaFrom` when the head has an approving review but its gate, test segment or CI is missing or red (a head with a review approval only is not yet approved on a material lane, and the repeated review is the cost of that rarer case); when only CI is red there, the run takes `deltaFrom` equal to `tip` and `fixFirst` holding the CI finding, so its review reads only the fixer's commits. A run killed in the middle of a segment leaves a begun run without a record; the path above still holds. A CI finding read after the tester's pass begins no segment until a stage of it starts, so a run that ends ci-red without a fixer leaves none.

- A normal lane whose item number is divisible by ten reads its begin step's
  `aco lane-record show` for the sample: it takes the sample only when no stored run ran
  `gate`, and a stored run whose last gate verdict is REVISE, or a lost stored run, owes the
  gate: a lost run's gate reads the whole lane, a REVISE's re-check the run's range, and it runs beside the review and ends awaiting-head
  like a material lane's gate when it gives no verdict, never skipped. When the read fails, the
  lane ends awaiting-head at `record` before any review and takes no sample: start a new run once
  the stored runs can be read. A sampled gate's re-check that gives no verdict ends awaiting-head at
  `review` with the resume arguments of the usage limit.
- A refused Codex gate never ends awaiting-head: its stand-in runs in the same round, and a
  stand-in that ends without a verdict fails the lane (`failed` at `review`).
- A Codex courier that wrote a different brief than the script composed is
  started once more. A second mismatch returns awaiting-head at stage `review`
  with the resume arguments of the usage limit (`pr`, `tip`, and on a delta round
  `deltaFrom` and `answers`) instead of failed.
- A Codex courier kills the detached run when its run log stays unchanged for
  `SILENCE_LIMIT_SECONDS`, and the review
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
  (primary or secondary) is retried twice after `NETWORK_WAIT_SECONDS`; a
  call the rate limit still refuses makes the relay wait for the reset
  `gh api rate_limit` names (an agent step, at most `RATE_LIMIT_WAIT_BOUND_SECONDS` in total) and run
  the step again (a rerun the rate limit refuses again may wait again, within the
  same bound and at most `MAX_RATE_LIMIT_WAIT_CALLS` waits in total); a call that stays unreachable, or whose reset is unreadable,
  absent or more than that bound away, ends the lane awaiting-head at `scope` (resume
  with a new run with `pr` and `tip`, and `deltaFrom` where the stop names it) or
  at `ci` (resume with `pr` and `tip`; a resume from `ci` runs scope and the
  review again) with "GitHub is unreachable" instead of failed; a refusal by the
  rate limit says so in the reason. At `ci`, when review approved and the tester
  passed on the tip, `requiredHeadActions` name the head's way without a new run:
  read the tip's check runs over REST and land once every one is green. The printer reads the pull request over REST (`gh api`), which spends no
  GraphQL points; `gh pr checks` stays on GraphQL.
- A CI answer that is not green, while the printed listing shows no failed check
  but a pending one or a run of the head not completed (the watcher's cap ended
  in a queue), whatever failing entry the watcher answers, unless it is
  `mergeable`, ends the lane awaiting-head at
  `ci`: no fixer starts, no fix round is spent, the history records the step as
  `PENDING`, and the reason names the pending checks. Resume with `pr` and `tip`
  once CI has finished.
- A Claude agent of any stage (builder, reviewer, fixer, tester, CI reader or
  mechanical step) that fails with its account usage limit returns awaiting-head
  at its stage with `claudeLimit` (`resetsAt` when the error names a reset), the
  `history` so far and the resume arguments of that stage (`pr`, `tip`, and
  `fixFirst` or, on a review round, `deltaFrom` and `answers`; `build` before a
  pull request exists), never failed. A Claude reviewer is not retried on a
  limit, and no role moves to another model or provider. The same holds for an
  agent the runtime ends with null while a probe agent of the same model ends
  with null too.
- A run started with `pr` and `tip` whose sync hits a merge conflict outside `ledgers`
  and `generated` does not escalate: the sync's printer reads git's own merge of the
  tip and `origin/main` (not the sync agent's note), and a conflict it names, or a
  path list it cut at `PRINTED_PATH_LIMIT`, starts a fresh fixer with a `mergeable` finding ("the lane
  conflicts with origin/main in <paths>"), first in the carried batch and
  deduplicated against a `mergeable` finding `fixFirst` carries. Its fixer gets the
  plain merging brief, never the CI one, and a disputed answer that changed nothing
  goes to the head, never to a CI re-run. A conflict only in `ledgers` and
  `generated`, a merge-tree error, a failed generated command, fetch or push, and a
  sync that reports a conflict git's merge-tree does not show keep `escalated` at
  `sync` with the agent's note; a `build` run has no sync. The review reads the merge
  through `git log -p --first-parent --remerge-diff` (over `deltaFrom` when the run
  carries one, else over the fixer's commits), naming the conflicted paths, each to be
  checked against both sides (`git diff M^1 M -- <path>`, `git diff M^2 M -- <path>`),
  and every other path the merge commits change; a lost intent or behaviour neither
  side had is blocking, and a merge commit that edits more is not rejected. A fixer
  that finds the sides contradicting each other ends the run `escalated` at `fix`;
  its `resume` holds `fixFirst` with the `mergeable` finding and the run's own
  `deltaFrom` (none when the run had none), never the synced tip. Settle it by
  writing which intent wins into `answers`, which the next fixer reads, or by merging
  by hand. A conflict alone counts as one fix round under the `ci` budget and
  `fixRoundsByStage.ci`; joined to a carried batch it is that batch's round (`test`).
  The history gets `{ after: 0, by: "sync", conflict: [paths], tip }`, which adds no
  Blocking entry and no miss: a sync-raised `mergeable` is no stage's finding, unlike
  CI's.
- In a CI round the fixer merges main only for a `mergeable` finding; any other
  CI finding it fixes in commits, or disputes with evidence when the red lies
  outside the diff or passed on its own re-run, and commits nothing for a
  dispute. A merge-only answer to any other batch, in any round, is rejected
  ("the fixer only merged main and fixed nothing"), and so is a merge-only answer
  rejected on its proof. The merge is already pushed, so the lane adopts the
  merged tip and ends awaiting-head at `fix`; the reason names that tip, and the
  resume is a new run with `pr` and it as `tip`. Other rejections end failed at
  `fix`.
- A fixer that answers its whole batch in the pull request body or an item
  comment and commits nothing is no failure.
  The fix brief tells it to report such an answer in `outside`, never as
  `removed`, and hands it the run's `answers`. A finding it lists in `outside`
  and also reports as `removed` counts as the outside answer on an unchanged
  tip; a `removed` proof with no diff and no outside answer fails at `fix`, and
  its reason names `outside`.
- A fixer that changes nothing because the tip already meets every carried
  blocking finding (an earlier fixer's commits) lists each in `resolved` under its
  finding number with its evidence and disputes none: the round goes on to the re-check of the
  commits since `deltaFrom`, or the whole lane without one or when `deltaFrom`
  equals the tip and the fixer commits nothing. A finding in
  `resolved` without evidence still fails at `fix` with "the fixer changed
  nothing".
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
  REST, and a pull request that is still a draft (read in the same call) is
  marked ready with `gh pr ready <n>`, because `aco land` refuses a draft; a
  pull request that is no draft gets no write. When a write fails, or the draft
  flag cannot be read, `requiredHeadActions` name the rename or `gh pr ready <n>`.

## Result

`sampled` is `true` when the lane's gate ran as the sample or as the re-check an earlier run owed,
`false` when none was due and `"skipped"` when the sampled look gave no verdict, with the reason in
`sampledReason`.

Every follow-up a reviewer, the gate or the tester reports carries a required
boolean `inPlace`: true when it meets `IN_PLACE_RULE`.
`followups` holds each follow-up the lane left open, one the fixer declined with
its `declined` reason; `folded` holds those a fixer resolved.
The tester's history entry of a surface lane carries `design: { capture, note? }`, `capture` being `not reported` when the tester gave none.

A result `ci-red` or `unresolved` from a spent budget carries `resume`: `pr`,
`tip`, `deltaFrom` equal to that tip and `fixFirst` holding the remaining
blocking findings. A new run with exactly these arguments starts at the fixer and
reviews only its commits.

The result carries `routingLine`, the one Routing line the head pastes as is,
`record` and `requiredHeadActions`.

`record` is the path of the lane record, `<scratch>/lane-record.json`, which aco reads
(its `specs/lane-record.spec.md` owns the schema). The script builds the record from its own
state: per stage the model and effort, the fix rounds and blocking findings by stage
(`review`, `gate`, `ci`, `test`; a stand-in counts as gate), the risk class (`material` or `normal`; a lane outside the workflow writes its own record as the aco skill says), the experiment tag
the misses by stage (never above the blocking findings: a gate, CI or test finding raised after a
review approved the range counts, except a gate finding of the approving review's own round and a CI finding
whose check the CI reader marks `deterministic` and whose fix the fixer reports in `noBehaviourChange`; the
review stage counts none). The misses also see the earlier runs' approvals: right after its begin a run reads
`aco lane-record show <n> --json` through its relay, which reports only the exit code and error, the run's own
`follows` and the shas of the stored review verdicts `approve` of the other runs. When the run follows, an
approval of an earlier run counts as one of this run, with both exemptions kept: a gate finding on a sha an
earlier review approved is no miss either. A run that does not follow counts only its own approvals (aco shows
the lane's misses as unknown then). When the read fails, the record leaves `misses` out, aco shows the lane's
misses as unknown, and the result names the gap in `missesGap`; the status stays. After a successful read the result shows `storedRuns`: the run's `follows` and the shas it read. The record also holds each review and gate verdict with the full sha it judged, the approving one last. No model retypes it: a
courier cuts it out of its own transcript into the file, compares its CRC32 with the script's, and only
then runs `aco lane-record check`, whose exit comes back on a CRC-signed printer line. Every status
a release can follow carries `record`. A record that fails the check turns `ready-to-land` into
`awaiting-head` at `record`, with `recordProblem` quoting aco; so does a tip no verdict judged (a clean merge of main after the last review), since aco lands only the head the last verdict judged, and `reason` names both shas; a run refused at input writes none, and a lane that hit the Claude usage limit at any point
may end without a record, since the record courier is a Claude agent (no code guard).

Each run stores its record on the claim as segments, each one an aco run: a span of the run's stages that ends at a
proven point, a review or a gate that approves the tip (stored before the fixer starts, when another reviewer of the round
revises it) or the tester's pass. Its first relay step, the branch check, mints a run id, which the first segment carries; a later segment's id is that
id, a hyphen and its number. A `build` run runs
`aco lane-record begin <n> --run <id>` right after that check; a run started with `pr` and `tip` runs it right after its
sync and its scope check have passed, with the synced head as `--start-tip` (a run that starts at a fixer, with `fixFirst`
or `foldIn`, right after the sync, since its scope check follows the fix), and a run that ends at `sync` or at its scope
check before any fixer is never begun. At each proven point the lane writes the record of the open segment, adds it with
`aco lane-record add <n> <path> --run <id> --end-tip <sha> --ran <stages>` and, right before the first stage after the point
(a review round, a fix round, the tester), begins the next segment with that tip as `--start-tip`; a run that stops at a proven
point begins none unless a tester is still running, since it needs a begun segment to land
in, so a lane whose gates passed keeps its verdicts on the claim when the run dies later, and a run killed in
the middle of a segment leaves a begun run without a record, whose counts aco shows as unknown. A segment's record holds only
its own slice of the run's history, its verdicts and its own fix rounds, and its `--ran` stages are those the segment started
(`build`, `review`, `fix`, `test`, `gate`; a tester counts in the segment its answer lands in); its finding counts are the
run's counts up to now minus those up to the segment's start, judged by the first begin's read of the stored runs, so the
stored runs sum to the figures of one unsplit run, a finding that comes back counting once; a miss that a later fix proof takes
back stays counted in the record it was stored in. aco sums the counts and joins the verdicts over the stored runs; the
approvals of the earlier segments reach a later one through the history. At every end that writes a record, the open
segment is added once the same way (one that started no stage stores nothing, since aco takes no empty `--ran` and the lane
claims no stage that did not run). A review or gate approval that follows another reviewer's revision of the same tip is not stored before the fixer
starts, since aco lands the last stored verdict. Every tip
aco receives is the 40-digit sha `git rev-parse` resolves in the worktree,
and a `build` run that ended without a tip passes the worktree's `HEAD`. A begin or an add that aco refuses, or whose tip
git cannot resolve, ends the run `awaiting-head` at `record`; the `reason` holds the refusal and, for an add, the status
and reason the run would have ended with. Once a run is begun, landing and release go without `--record`, because aco
computes the record from the stored runs and refuses the flag: the landing is `aco land <pr> --head <tip>` and an abandoned
lane is released with `aco release <n> --abandoned REASON`; a run that never began (it ended at `sync` or at its scope check before any fixer, or aco refused its begin) keeps
`--record <path>` in the abandon action. The Routing line is still printed, and pasted beside the record until aco stops
reading it.
