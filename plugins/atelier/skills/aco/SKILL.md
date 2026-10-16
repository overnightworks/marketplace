---
name: aco
description: Operate aco (agent claims, the work board, landing) as a head session in any repository that coordinates with it. Use before the first aco write — starting or resuming a lane, claiming a `fix/`/`docs/` branch, writing item or pull request bodies, briefing agents, landing or releasing, reading the board, or installing the protect hook — and whenever aco refuses something.
---

# Operating aco as a head

This skill says the order and the traps of one lane. aco owns the facts: flags,
outputs, and refusal sentences are in `aco <command> --help`, in
`/home/felix-hummert/git/agent-claim/README.md` and in its `specs/<command>.spec.md`
(published as github.com/overnightworks/agent-coordination). Read the spec of a
command before using it the first time; this file copies none of it. The global
contract's section "How to coordinate" says *that* a lane is claimed, reviewed and
landed; this says *how*.

## Session start

1. `aco status` — who holds what; resume a lane you own (its worktree is listed).
2. `aco next` (`--json`) — the item to pull. `needs-operator` items are never named;
   an item with unruled expectations is refined first, not dispatched
   (`specs/next.spec.md`).
3. `aco board` (`--json`) reads the whole board, read-only. `--serve` and `--html`
   are not for routine reading.

## Start a lane

- Issue item: from the primary checkout, `aco start <n>` creates the worktree
  `<repo>-worktrees/issue-<n>-<slug>` and branch, then claims. Scope comes from
  the item body's aco block; `--scope PATH` (repeatable) must match it.
  `specs/start.spec.md`.
- `--whole REASON` is required for a wide scope (any directory, more than three
  paths); one sentence why it does not split. Prefer a body `whole` field.
- `--out-of-order REASON` is required when a higher-ranked item is free or a
  blocker is open. Use it only for an operator-named item.
- Issue-less work: create the `fix/<slug>` or `docs/<slug>` worktree yourself, then
  `aco claim --scope PATH` in lane mode from inside it (`specs/claim.spec.md`).
  Release with `aco release --merged <pr>` or `--abandoned REASON`
  (`specs/release.spec.md`). Set `ACO_AGENT` so claim and hook agree on identity.
- Bundled small cards run under the lead card: claim the lead with `--scope`
  covering every card's paths and `--whole` naming the bundle. Bodies and the PR
  wording follow "Pull request body" below.

After `aco start`, hand the lane to the `atelier:lane` workflow.

## Briefs

`aco brief <n> --step build|review|fix|land [--json]` prints the body, live claim,
lane tip and touched files plus that step's own rules. Dispatch briefs point at the
body, so build them from this output rather than from memory (`specs/brief.spec.md`).

## Item bodies

- Forge issues are edited on the forge. `aco item` is only for state-ref items;
  `aco item edit` on a forge issue refuses.
- `gh issue view` and `gh pr edit` currently fail on GitHub's Projects-classic
  GraphQL deprecation. Read with `gh issue view <n> --json body --jq .body`; write with
  `gh api -X PATCH repos/<owner>/<repo>/issues/<n> -F body=@file` (for a PR use
  `.../pulls/<n>`).
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
missing, doubled or fenced line (`specs/landing-grammar.spec.md`).

## Land

Gates are green and you hold the tip the reviewers saw. Landing is delegated as a
named task, but the precondition is aco's:

1. Stand in a clean checkout of the default branch — the primary checkout, never the
   lane worktree.
2. `aco land <pr> --head <sha>` merges only if the PR head is that sha, then runs the
   release: claim released, clean merged worktree and branch removed
   (`--keep-worktree` keeps them). `specs/land.spec.md`.
3. Read the `freed:` and `next:` lines it prints; each freed item is dispatched or
   deferred with a reason (contract: "A landing is not finished …"). Then `aco next`.
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
from the spec first, then open one item in overnightworks/agent-coordination (search
it first) naming the command, the refusal sentence and what would have prevented
it, and extend this skill only where the answer is a *how*, not a copied fact.
