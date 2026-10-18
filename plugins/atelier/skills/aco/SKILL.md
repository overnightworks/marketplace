---
name: aco
description: Operate aco (agent claims, the work board, landing) in any repository that coordinates with it. Use before `aco start`, `aco claim`, `aco land`, writing a pull request body, or editing an item body; when briefing agents, releasing a claim, or installing the protect hook; and whenever aco refuses something.
---

# Operating aco as a head

This skill says the order and the traps of one lane. aco owns the facts: flags,
outputs, and refusal sentences are in the installed `aco <command> --help` (the
local owner) and in `README.md` and `specs/<command>.spec.md` of the
agent-coordination repository (github.com/overnightworks/agent-coordination; a
local checkout may carry another directory name, so find it with
`git -C <candidate> remote get-url origin`, and read the spec on the forge
when none exists). Read the spec of a command before using it the first time;
this file copies none of it. The global contract's section "How to coordinate"
says *that* a lane is claimed, reviewed and landed; this says *how*.

## Session start

1. `aco status` — who holds what; resume a lane you own (its worktree is listed).
2. `aco next` (`--json`) — the item to pull. `needs-operator` items are never named;
   an item with unruled expectations is refined first, not dispatched
   (`specs/next.spec.md`).
3. `aco board --json` reads the whole board, read-only (bare `aco board` refuses);
   the browser view for deciding expectation lines is `aco-board serve`.

## Start a lane

- Before the claim, trace callers and owners into the scope (contract: "How to coordinate", the trace-before-claim rule). A lane that returns `awaiting-head` with a `rescope` list needs `aco rescope`, then a resume.
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
  blocker is open; aco refuses the start without it (contract: "Start of a main
  session").
- Issue-less work: create the `fix/<slug>` or `docs/<slug>` worktree yourself, then
  `aco claim --scope PATH` in lane mode from inside it (`specs/claim.spec.md`).
  Release with `aco release --merged <pr>` or `--abandoned REASON`
  (`specs/release.spec.md`). Set `ACO_AGENT` so claim and hook agree on identity.
- Bundled cards (contract: "How to coordinate"): claim the lead with `--scope`
  covering every card's paths and `--whole` naming the bundle.

After `aco start`, run the lane through the `lane` workflow
(`plugins/atelier/workflows/lane.js`) where it helps, starting it as the
README's section "Layout" says, under the contract's standing opt-in. Without the
`Workflow` tool, or where the workflow does not fit, run the lane steps by hand.

## Briefs

`aco brief <n> --step build|review|fix|land [--json]` prints the body, live claim,
lane tip and touched files plus that step's own rules. Dispatch briefs point at the
body, so build them from this output rather than from memory (`specs/brief.spec.md`).
`--step` refuses (`no .aco/brief.toml in the repository`, exit 2) unless the
repository tracks `.aco/brief.toml`. Where it refuses, run `aco brief <n>` without
`--step`: the four sections are the brief, and the step's rules come from the
contract and this skill.

## Item bodies

- Forge issues are edited on the forge. `aco item` is only for state-ref items;
  `aco item edit` on a forge issue refuses.
- Read a body with `gh issue view <n> --json body --jq .body` and write it with
  `gh issue edit <n> --body-file <file>` (a PR uses `gh pr view` and `gh pr edit`).
- Keep the contract's `Blocked by:` line, and record each blocker as a GitHub issue
  dependency too: `aco next` and `aco board` read only those, never the body prose
  (`specs/body-block.spec.md`). `gh api -X POST
  repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by -F issue_id=<id>`, where
  `<id>` is `gh api repos/<owner>/<repo>/issues/<m> --jq .id` of the blocker; a
  blocker in another repository works the same way.
- Pipe the new body through `aco body --check` before writing it; it reports defects
  in the fenced `aco` block (`specs/body.spec.md`, `specs/body-block.spec.md`).
- `aco check <issue>` judges a written issue body's contract.
- A slice becomes an item with `aco cut` (`specs/cut.spec.md`); expectation lines go
  through `aco ask` and `aco rule` (`specs/ask.spec.md`, `specs/rule.spec.md`), the
  latter only transcribing the operator's word.

## Pull request body

The body carries exactly one classification line outside any code fence:
`Work-Item: #<n>` plus a closing reference (`Closes #<n>`), or `No-Item: fix|docs` for
a lane claim. Bundled cards: `Lands #<m>` per card (it does not close; the head
closes them after the merge). Run `aco check <pr>` before landing; it refuses a
missing, doubled or fenced line (`specs/landing-grammar.spec.md`); a pass proves the
classification, the closing reference, a claim on the head branch and the default-branch
target, not that the work is reviewed or the checks are green.

Push the branch, then open the pull request with `gh pr create` (title, head, base,
body).

A pull request lands exactly one item (LAND-18/19). A partial slice of a larger item
becomes its own item first (`aco cut`); bundled cards use `Lands #<m>`.

## Land

Gates are green and you hold the tip the reviewers saw. Landing is delegated as a
named task, but the precondition is aco's:

1. Stand in a clean checkout of the default branch — the primary checkout, never the
   lane worktree.
2. `aco land <pr> --head <sha>` merges only if the PR head is that sha, then runs
   the release for you: claim released, clean merged worktree and branch removed
   (`--keep-worktree` keeps them). `specs/land.spec.md`. `aco land` has already
   released the claim; after a land, the head's release step is verifying that
   with `aco status`. `aco release --merged` is for merges made outside
   `aco land`.
3. Read the `freed:` and `next:` lines it prints and act on them as the contract's
   "How to coordinate" says. Then `aco next`.
4. Close bundled non-lead cards with the PR link.

If the merge worked but a step failed, `aco release <n> --merged <pr>` finishes it
from the checkout that holds the worktree. Abandoned: `aco release <n> --abandoned
REASON`; the item stays open.

## protect hook

`aco protect` is a `PreToolUse` hook that denies a mutating tool call (writes, Bash
write patterns) outside a linked worktree with a live claim covering the path.
Install it once, in the head's git-ignored `.claude/settings.local.json` — the
session that runs the subagents, not each worktree — using the exact matcher and
`ACO_AGENT` guidance in the README section "PreToolUse write gate". Never `"*"` as
matcher. Denial reasons: `specs/protect.spec.md`.

## Friction

A refusal this skill did not predict is a defect in the skill or in aco. Resolve it
from the spec first, then open one item in overnightworks/agent-coordination
(search it first) naming the command, the refusal sentence and the wish with its
reason (not a finished solution), and extend this skill only where the answer is
a *how*, not a copied fact.

A lane-workflow step that does not fit is reported on the marketplace board
(contract: "How to coordinate"), not worked around silently.
