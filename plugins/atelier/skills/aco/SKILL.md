---
name: aco
description: Operate aco (agent claims, the work board, landing) in any repository that coordinates with it. Use before `aco start`, `aco claim`, `aco land`, writing a pull request body, or editing an item body; when briefing agents or releasing a claim; and whenever aco refuses something.
---

# Operating aco as a head

This skill says the order and the traps of one lane. aco owns the facts: flags,
outputs, and refusal sentences are in the installed `aco <command> --help` (the
local owner) and in `README.md` and `specs/<command>.spec.md` of the aco
repository (github.com/overnightworks/aco; a local checkout may carry another
directory name, so find it with `git -C <candidate> remote get-url origin`, and
read the spec on the forge when none exists). Read the spec of a command before
using it the first time; this file copies none of it. The head contract
(`instructions/HEAD.md`, sections "Lanes" and "Landing") says *that* a lane is
claimed, reviewed and landed; this says *how*.

## Session start

1. `aco status` — who holds what; resume a lane you own (its worktree is listed).
2. `aco next` (`--json`) — the item to pull. `needs-operator` items and
   ideas are never named (ideas are listed apart under `ideas:`);
   an item with unruled expectations is refined first, not dispatched
   (`specs/next.spec.md`).
   Code built ahead of its caller is listed in `.aco/ahead-of-caller.toml`
   (`specs/ahead-of-caller.spec.md`). A red line in `aco next` names an entry
   whose item is no longer open: delete that code, or, where an open item now
   calls it, point the entry at that item.
3. `aco board --json` reads the whole board, read-only (bare `aco board` refuses);
   the browser view for deciding expectation lines is `aco serve` (`specs/serve.spec.md`).

## Start a lane

- Before the claim, trace callers and owners into the scope (`HEAD.md`: "Lanes", Trace before the claim). A live claim changes scope only through `aco rescope <n> --add PATH` (or `--drop PATH`), after the body's scope says so, run from the claim's own worktree (it refuses the main checkout, unlike `aco start`); a second `aco claim` refuses. A lane that returns `awaiting-head` with a `rescope` list is resumed after that.
- Issue item: from the main checkout, run the `aco start <n> ...` line that
  `aco next` prints and fill any `<reason>` placeholder it prints (for example after
  `--whole`); it creates the worktree
  `<repo>-worktrees/issue-<n>-<slug>` and branch, then claims. A blocked or skipped
  item prints no start line: it is not started; report its blocker. Scope comes
  from the item body's aco block; `--scope PATH` (repeatable) must match it. When
  the block lacks `scope`, write `scope = [...]` into the body first (the paths
  the trace-before-claim step named); when it lacks `whole` and the scope names a
  directory or more than three paths, write a one-sentence `whole = "..."` too,
  because aco refuses the claim without it.
  `start` has no `--json`. `specs/start.spec.md`. Push the branch by name
  (`git push origin <branch>`), not with a bare `git push`: its upstream can be `origin/main`.
- A `malformed ... blocked-by list` refusal has so far been GitHub's issue listing
  still showing the blocker count from before a dependency was added or removed; it
  clears on a retry a minute later. Never answer it with `--out-of-order`. One that
  persists is a defect (see Friction).
- `--whole REASON` is required for a wide scope (any directory, more than three
  paths); aco refuses the claim without it. One sentence why it does not split.
  Prefer a body `whole` field.
- `--out-of-order REASON` is required when a higher-ranked item is free or a
  blocker is open; aco refuses the start without it (`HEAD.md`: "Session
  start").
- Issue-less work: create the `fix/<slug>` or `docs/<slug>` worktree yourself, then
  `aco claim --scope PATH` in lane mode from inside it (`specs/claim.spec.md`).
  Release with `aco release --merged <pr>` or `--abandoned REASON`
  (`specs/release.spec.md`).
- Identity (every lane): a Claude or Grok head leaves `ACO_AGENT` unset; aco takes its
  `CLAUDE_CODE_SESSION_ID` or `GROK_SESSION_ID`, which the head's own subagents inherit,
  and that identity ends with the session. A Codex head, whose session variable aco does
  not read, is started with `ACO_AGENT` in its environment (`ACO_AGENT=<name no other
  running head uses> codex`), so every command and agent it starts carries it; a prefix
  on single commands does not reach its delegated agents. A Codex session already
  running without it prefixes every aco command with `ACO_AGENT=<name>` rather than
  `--agent`, so there is one form everywhere and Claude's auto mode does not trip: the
  name is the holder of its existing claims when they share one (`aco status` shows it),
  otherwise one new name, and each old claim is landed or released under its own holder.
  Every brief names the same prefix for every aco command the agent runs, because native
  Codex subagents do not inherit it. A missing identity refuses before the named command
  starts (`specs/output.spec.md`, OUT-05).
- An open pull request without a claim (a dependency bot's, a fixer's): `aco adopt <pr>
  --no-item deps|fix|docs` makes it a claimed lane on its own branch; `deps` needs
  `dependency_paths` in `.aco/board.toml`. Then land as usual (`specs/adopt.spec.md`).
- Bundled cards (`HEAD.md`: "Lanes", Bundles): before the claim, append each
  card's sentences, its `[[expectation]]` entries byte for byte (their
  `card_hash` holds) and its `Done when` to the lead body, and pipe it through
  `aco check -`. Add each of the card's blockers to the lead, and point each
  item the card blocks at the lead (drop an edge from the card to the lead or to
  another folded card instead of moving it), with the dependency call under "Item bodies" below.
  Then
  `gh issue close <card> --duplicate-of <lead> --comment "Folded into #<lead>."`.
  Claim the lead with `--scope` covering every folded card's paths and `--whole`
  naming the bundle.

After `aco start`, run the lane through the `lane` workflow
(`plugins/atelier/workflows/lane.js`) where it helps, starting it as the
README's section "Layout" says, under the contract's standing opt-in. Without the
`Workflow` tool, or where the workflow does not fit, run the lane steps by hand.
Never message a step running inside a lane: it ends without its result and the
run hangs. Stop the run, correct the body and start a new one.

## Briefs

`aco brief <n> --step build|review|fix|land [--json]` prints the body, live claim,
lane tip and touched files plus that step's own rules. Dispatch briefs point at the
body, so build them from this output rather than from memory (`specs/brief.spec.md`).
`--step` refuses (`no .aco/brief.toml in the repository`, exit 2) unless the
repository tracks `.aco/brief.toml`. Where it refuses, run `aco brief <n>` without
`--step`: the four sections are the brief, and the step's rules come from the
contract and this skill.

## Item bodies

- Open an item with `aco item new --title … --kind task|feature|container
  [--parent N]`, with the body on stdin. Under `storage = "github"` it opens the
  GitHub issue, sets its issue type and parent, and refuses a possible twin (a
  similar open or recently closed title) unless `--not-a-twin` is given
  (`specs/item.spec.md`). A bare `gh issue create` leaves type and parent unset.
  `--parent N` retypes an open Task parent to Container and refuses any other
  non-container (ITEM-29, ITEM-45). A sub-issue linked by hand under a parent
  that has no type makes `aco check` refuse `has parent <ref> of kind <kind>,
  which is not a container; only a container holds children` (LAND-27,
  `specs/landing-grammar.spec.md`); set the parent's type with `gh api -X PATCH
  repos/<owner>/<repo>/issues/<parent> -f type=Container`.
- `aco --repo` refuses `item new` for a foreign repository (`forge target ...
  does not match canonical remote`): open a dependent's item from that
  repository's own checkout.
- Pulling an idea is a decision, not an idle step: remove the board's
  idea label and replace the body with a work-item body (the fenced `aco`
  block); `aco claim` refuses an idea whose body still lacks the
  work-item block (`body incomplete`).
- Forge issues are edited on the forge; `aco item edit` on a forge issue
  refuses.
- Read a body with `gh issue view <n> --json body --jq .body` and write it with
  `gh issue edit <n> --body-file <file>` (a PR uses `gh pr view` and `gh pr edit`).
- Record each blocker as a GitHub issue dependency, never as a body line: `aco next`
  and `aco board` read only those (`specs/body-block.spec.md`). `gh api -X POST
  repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by -F issue_id=<id>`, where
  `<id>` is `gh api repos/<owner>/<repo>/issues/<m> --jq .id` of the blocker; a
  blocker in another repository works the same way. For a brief, read an item's
  open blockers with `aco check <n>` (`specs/check.spec.md`, CHECK-08).
- Pipe the new body through `aco check -` before writing it; it reports defects
  in the fenced `aco` block (`specs/check.spec.md`, `specs/body-block.spec.md`).
- `aco check <issue>` judges a written issue body's contract.
- A slice becomes an item with `aco cut` (`specs/cut.spec.md`).
- An operator question is written only as an option line in the item body (shape:
  `specs/body-block.spec.md`, "Option lines"), never as a yes/no line. Put it on an
  existing open item with the `ask` tool of `aco mcp` (`specs/mcp.spec.md`). A
  session without the tool, or a revision of a returned line, writes it by hand:
  pipe the new body through `aco check -` first, then write it with `gh issue edit`
  under `storage = "github"` or `aco item edit` under state-ref.
  Read `references/decision-cards.md` before writing or revising a card: it holds
  the judgement `aco check` cannot make.
- Outside an option's `contract`, a card carries no issue numbers, paths, file names,
  backticks, code names or flags; the problem is at most 20 words and an option name
  2 to 5 words. `aco check -` refuses an open or
  returned option line that breaks this (BODY-96..BODY-98 in `specs/body-block.spec.md`),
  and the item is malformed until the body is fixed: `aco next` lists it under SKIPPED
  (NEXT-36), `aco board` names it with its defect (BODY-50), and `aco claim` refuses it
  (BODY-52).
- Record a chat answer with the `record_answer` tool of `aco mcp`, from `option` or
  `other` and the `card_hash` that `read_inbox` shows (`specs/mcp.spec.md`). A session
  without the tool transcribes it with `aco rule <n> --line <k> --option <letter> --via chat
  --card-hash <hash>`, the hash being the line's `card_hash` in `aco rulings <n> --json`;
  an answer that fits no option uses `--other "<the operator's words>"` instead of
  `--option`. "Unclear" has no `record_answer` form: it uses
  `aco rule <n> --line <k> --unclear --card-hash <hash>
  [--note "<the operator's words>"]` without `--via`: the line stays open and returns
  to its head (`specs/rule.spec.md`). `aco rule` only transcribes the operator's word;
  `aco rulings` prints the line index `--line` takes. `aco rulings <n>` (also `--json`)
  shows that one item, open or closed, and refuses a pull request number
  (`specs/rulings.spec.md`).
- Mark a step only the operator can take with the `step` tool of `aco mcp`, on the item
  it belongs to, or with a `title` when no open item holds it (`specs/mcp.spec.md`). The
  tool never removes the label `needs-operator`: once he says the step is done, the head
  removes the label and rewrites the block's `next` in the same edit, so `next` stops
  naming his finished step.
- Take back your own open or returned line only with `aco withdraw <n> --line <k>`, never
  by editing the body (`specs/withdraw.spec.md`); it refuses a ruled line. Withdrawing a
  returned line drops the operator's note, so carry that note into the line that replaces
  it first.
- A GitHub body has no compare-and-swap: re-read it right before writing, diff old
  against new so only your own lines differ, and afterwards check with `aco rulings`
  that every other line kept its state.

## Pull request body

The body carries exactly one classification line outside any code fence:
`Work-Item: #<n>` plus a closing reference (`Closes #<n>`), or `No-Item: fix|docs` for
a lane claim. Run `aco check <pr>` before landing; it refuses a
missing, doubled or fenced line (`specs/landing-grammar.spec.md`); a pass proves the
classification, the closing reference, a claim on the head branch and the default-branch
target, not that the work is reviewed or the checks are green.

One more line records the routing, in this form:
`Routing: build <model>/<effort>; review <model>/<effort>; gate <model>/<effort>|none; land <model>/<effort>. Blocking: <finding> → <stage>; …|none`.
The head writes it before the landing, because a landing agent does not know the routing.

Push the branch, then open the pull request with `gh pr create` (title, head, base,
body).

A pull request lands exactly one item (LAND-18/19). A partial slice of a larger item
becomes its own item first (`aco cut`).

## Land

Gates are green and you hold the tip the reviewers saw. Landing is delegated as a
named task, but the precondition is aco's. The landing task runs under the claim's
identity. A subagent of the claiming head's own provider inherits it and passes neither
`ACO_AGENT` nor `--agent`; an agent started through another provider's CLI (`grok`,
`codex`) can carry its own session variable, so the head does not hand the landing to
one. Any other identity, including a later session resuming the lane, is refused with
`only the original claimant may release` and lands as the holder with
`ACO_AGENT='<holder>' aco land <pr> --head <sha>`, never with `--agent`, which Claude
Code's auto mode denies.

1. Stand in a clean checkout of the default branch — the primary checkout, never the
   lane worktree.
2. `aco land <pr> --head <sha>` merges only if the PR head is that sha, then runs
   the release for you: claim released, clean merged worktree and branch removed
   (`--keep-worktree` keeps them). `specs/land.spec.md`. `aco land` has already
   released the claim; after a land, the head's release step is verifying that
   with `aco status`. `aco release --merged` is for merges made outside
   `aco land`. `aco land` also fast-forwards this checkout to the landed main
   (in marketplace that checkout is the installed contract for every agent);
   the landing runs no git command beside or after it.
3. The landing agent reports the follow-up lines `aco land` prints (`freed:`,
   `next:`, in aco also `reinstall:`) to the head and runs none of
   them. The head acts on them as `HEAD.md`'s "Landing" says, then
   runs `aco next`.

If the merge worked but a step failed, `aco land` prints `follow-up incomplete`
and the re-run command; re-run it, which resumes and never merges twice.
Abandoned: `aco release <n> --abandoned REASON`; the item stays open. The head
puts the lane's `Routing:` line, in the form of a PR body, into the reason;
where the lane has an open pull request, the line goes into that body as usual.

## Rename a repository

The head runs this, in this order; the operator takes only the steps marked so, each
as the ready step given here. The head fills in the real repository names (`OLD`, `NEW`)
Sonar keys (`KEY_OLD`, `KEY_NEW`) and the file name of the workflow that runs the quality
gate (`WORKFLOW`, from `gh workflow list`) in the first line of each block and in each link
before handing it over; the blocks use them as shell variables. The Sonar key and binding follow hal's
`docs/naming.md`, P2 (until quality's naming document holds it). aco's trap is
PIN-52 and E-PIN-42 in `specs/storage-pin.spec.md` of aco: every clone whose `origin`
still names the old repository refuses a cross-repository read until step 5 re-points it.

1. Drain (agent): `aco status` shows no claim and no live lane but the rename's own, and
   no lane worktree is open (`uv sync --reinstall` can fail on one). Move the callers
   of the repository's actions and reusable workflows first: GitHub redirects git and
   web URLs, not `uses:`.
2. One pull request (agent) carries every name change (package, CLI, config
   variables, image name, documents) except the Sonar key, green under the old name;
   the key commit (the change of `sonar.projectKey` in `sonar-project.properties`) stays local. Settings another repository owns (platform's OpenTofu
   GitHub settings) change and apply first.
3. Disable CI (operator; auto mode refuses it to an agent as a CI bypass):
   ```sh
   OLD=old-name && cd ~/git/$OLD && gh workflow disable WORKFLOW
   ```
4. Rename (agent): `gh repo rename NEW -R overnightworks/OLD --yes`. Then the Sonar key (operator, web): open
   `https://sonarcloud.io/project/key?id=KEY_OLD`, field Update Key, set `KEY_NEW` and
   save, once its Background Tasks show nothing
   pending.
5. Local move (agent), while nothing runs inside the clone: the repository's own sessions
   end first and the move runs from a session outside it. The block stops at the first
   failure and `-x` shows where; it stops before moving anything when a target exists; a
   missing worktrees or Claude project directory is skipped. Each `origin`
   keeps its URL form and changes only the repository name. Claude project directories
   of worktrees (`<P>-OLD-worktrees-*`) stay: with no worktree open they belong to
   removed worktrees. If auto mode refuses a part, the operator takes that part (#586):
   ```sh
   OLD=old-name NEW=new-name bash -euxo pipefail -c '
   shopt -s nullglob
   P=~/.claude/projects/${HOME//\//-}-git
   cd ~/git
   for target in $NEW $NEW-worktrees $P-$NEW; do
     if [ -e $target ]; then echo "$target exists, nothing moved" >&2; exit 1; fi
   done
   mv $OLD $NEW
   if [ -d $OLD-worktrees ]; then mv $OLD-worktrees $NEW-worktrees; fi
   dirs=($NEW $NEW-worktrees/*)
   for d in "${dirs[@]}"; do
     url=$(git -C "$d" remote get-url origin)
     git -C "$d" remote set-url origin "${url%/*}/$NEW.git"
   done
   if [ -d $NEW-worktrees ]; then git -C ~/git/$NEW worktree repair ~/git/$NEW-worktrees/*; fi
   if [ -d $P-$OLD ]; then mv $P-$OLD $P-$NEW; fi
   for d in "${dirs[@]}"; do
     if [ -f "$d/uv.lock" ]; then (cd "$d" && uv venv --allow-existing && uv sync --locked --reinstall); fi
   done'
   ```
   Never re-clone: open worktrees, local branches and unpushed commits live only in the clone; aco's claims live on the remote. Where `.aco/board.toml` names a canonical remote other than `origin`, re-point that one the same way. Also set the
   `origin` of any deploy checkout outside `~/git`. The agent reports user units, links
   in `~/.local/bin`, `~` and `~/srv`, and uv tools that point into the old path to the
   repository's head.
6. Resume (head): `claude --resume` from the new clone, never with `--fork-session`, keeps the session id, so the
   claim holder stays valid. Scratchpads do not move: a brief naming one's absolute path
   is stale. Peer session addresses follow the directory: tell the peers the new one.
7. Re-enable CI (operator):
   ```sh
   NEW=new-name && cd ~/git/$NEW && gh workflow enable WORKFLOW
   ```
   Then an agent pushes the key commit (`sonar.projectKey` set to `KEY_NEW`) and the head lands it. The operator re-saves the
   binding at `https://sonarcloud.io/project/settings?id=KEY_NEW`: General Settings ›
   Repository binding, Save. An agent checks that SonarCloud lists no project with `KEY_OLD`.
8. Aftermath (agent): `gh repo edit NEW --description "…"`. Each dependent gets one
   release item for what names the old repository (dependency pins, images, imports,
   config variables, documents). Rewrite open item bodies that link the old name before
   any repository takes it, because a reuse ends the redirect; closed items and comments
   stay, a named risk. The old image package is deleted only on the operator's yes.

Open risk: without `hal rename`, whether an agent's auto mode allows each part of step 5
is unverified; the first run (#586, marketplace to atelier) proves it or names the part
as the operator's.

## Friction

A refusal this skill did not predict is a defect in the skill or in aco. Resolve it
from the spec first, then open one item in overnightworks/aco
(search it first) naming the command, the refusal sentence and the wish with its
reason (not a finished solution), and extend this skill only where the answer is
a *how*, not a copied fact.

A lane-workflow step that does not fit is reported on the marketplace board
(`HEAD.md`: "Other repositories", Friction goes to its owner), not worked
around silently.
