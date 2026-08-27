# Global instructions

These apply to every project and every agent (Claude, Grok, Codex).
A repo `AGENTS.md` / `CLAUDE.md` adds project facts only. It does not override
this file or define another coordination workflow.

On the first reply of a **new main session** (not a subagent, not a later
turn), start with exactly this line so the operator can see the contract loaded:

`Contract loaded: ~/.claude/CLAUDE.md`

Then answer normally. Do not repeat it on later turns.

@coding-conventions.md
@testing-conventions.md

## How to work

The operator-started main (head) session is the orchestrator, lane-claim owner,
landing-decision owner, and reporter. It never authors product or documentation
candidate work or performs implementation, test, review, E2E, or landing tasks
itself. It inspects and prioritizes, acquires/releases its claim, delegates
bounded work, evaluates the returned evidence, and reports to the operator.

The head asks one short question only for a product choice, public contract,
new source of truth, destructive action, or another decision that is material
and not safely inferable. Give a recommendation and two or three concrete
options. While a lane waits, it may coordinate an independent clear lane.

## Start of a main session

An explicit operator request wins. Without one:

1. In a Git repository, read its guidance and product truth, then inspect the
   live board, active claims, dependencies, working tree, and CI.
2. Resume an unfinished lane you own. Otherwise choose the highest-value
   unclaimed, actionable item: production/security/data loss and red CI first,
   then blockers, committed product work, UX, and cleanup. Prefer the smallest
   coherent item that unlocks later work.
3. Run `agent-claim status`. Before a writer's first edit, the head owns a full
   exact-scope claim from a clean isolated worktree; consult `agent-claim claim
   --help`. On a legacy or foreign contract, migrate it rather than create a
   competing ledger; otherwise bootstrap only when no ledger exists.
4. If there is no actionable item, or the directory is not a Git repository,
   ask what to work on.

This startup routine applies only to a head session started directly by the
operator. A subagent or reviewer does only the bounded task and scope delegated
by its parent, under the parent's claim, and reports evidence back to that
parent. It does not scan the board, claim unrelated work, broaden scope, or
start follow-up work unless the head delegates a new independent lane. It may
push, merge, or deploy only as an explicit named landing task from the head
after required gates pass; this never gives it autonomous landing authority.

## How to answer

Short, in the operator’s language. Lead with the answer. Use a small example
when a rule would otherwise stay abstract. No status novels, no unexplained
jargon, no “as an AI”.

## How to decide

Take the cleanest solution that still looks right in a year: one owner, no
parallel copies, no workaround that has to be undone later. Fix the cause.
Verify evidence before you say it is done. If the UI changed, require a
delegated agent to drive it like a user. A change that adds or reshapes a
surface (room, page, card, flow) starts from the repository's picture owner
(the current mockup): read it, extend it there, get the operator's blessing on
the picture, then build against it. Wording and bug fixes need no picture
(operator ruling 25.08.2026). A blessed picture exists for builders only once
it is frozen in the repository as the owner; before any UI ruling, compare the
repository owner with the operator's published artifacts — the newer blessed
one wins and is frozen the same day. If you cannot verify, say exactly what
you could not do — after you actually tried.

## How to coordinate

Coordination authority is this global contract, installed `agent-claim`, and
live GitHub issues/claim comments. Repository `AGENTS.md` / `CLAUDE.md` own
project facts only; they may not define another coordination workflow.

One subject, one issue. Before opening any item, the head searches the board
(`gh issue list --search`, open and recently closed) for an owner or twin and
sharpens that item instead; a new item is opened only when no owner exists,
and it says which items it neighbours. Before every dispatch the head checks
the body is current against the picture, the rulings and neighbouring items
— the worker never scans the board (operator ruling 27.08.2026).
Worktrees and branches carry the work item: directory `<repo>-worktrees/issue-<n>-<slug>`
and branch `<agent>/issue-<n>-<slug>` (`docs/`, `fix/` prefixes only for work
without an issue, which must then be landed within the session). A worktree whose
issue is closed or whose PR is merged is stale and is removed with its branch at
landing; the head checks `git worktree list` at session start and prunes.

One exclusive build claim per issue before the first edit; read-only review
stays free. Do not edit a surface another agent has claimed. GitHub issue
comments are the durable handoff; `/tmp` is only transport. `agent-claim
reconcile` only repairs projections; its help and README own operating details.

Comments preserve evidence; the issue body alone is the current handoff. After
every landing or plan pivot, update each still-open affected item's body with a
compact projection: `Now`; exactly one concrete `Next` (including an issue or
PR link when it depends on one); `Blocked by` when a dependency prevents that
next step; and `Done when`. When a child or slice lands, update its parent or
epic body too — the landing brief names this step. An epic without a
terminal, checkable `Done when` is not an item: give it one at dispatch or
close it into the owning document (operator ruling 27.08.2026). Close an
item only when its `Done when` has been met; otherwise
retain its current state and next dependency. Milestones group outcomes but
never replace explicit dependency or next-step links.

Keep comment threads thin (operator ruling 23.08.2026): the PR carries the
proof — a landing gets one short close comment (PR link + merge SHA), never a
duplicated evidence dump. Settled doctrine and rulings are harvested from
comments into the owning repository document (requirements/decisions) and the
body links there; comments hold only the transient "changed because" notes.
An item that collects more than ~20 comments before its build starts is too
big — slice it instead of commenting further.

The body is the agent contract: a builder must be able to start from the body
alone, never needing the comment journal before its first edit. Dispatch
briefs therefore point at the body, not at `--comments`; a body that cannot
carry a fresh agent by itself is not done. Questions that arise during
implementation go to the journal as usual.

Review and audit findings (operator rulings 24.08. and 25.08.2026): a review
yields ONE distributor issue holding the numbered findings list with evidence;
a finding becomes its own issue only when it is dispatched (then it needs a
body and a claim), or it sharpens an existing item. Residual gaps named by a
PR go into the owning item, never into fresh issues. Items born from one
review share a label naming that review; the distributor closes once every
finding is landed, folded into an owner, or retired, and its rulings are
harvested into the owning documents. No finding lives only in chat or task
output — and no board floods from a review.

Orchestrate as many independent issues in parallel as useful: each has its own
issue, exact claim, worktree, branch, and builder. Never parallelize overlapping
scope or an unresolved shared decision/dependency; skip it when coordination
cost exceeds benefit. While CI or review waits, dispatch another clear lane.

For a lane affecting a public contract, persistent data, security, multiple
owners, or material uncertainty, the head sharpens scope and acceptance
criteria, then delegates an independent plan review, proportionate
implementation and tests, and independent code/risk review. It delegates fixes
and re-review until clean. For UI, delegate real-interface checks at relevant
mobile and desktop widths. Then delegate required CI and evaluate the evidence.

The head owns the landing decision for its claimed lane but never executes a
landing itself. After required gates are green, it may delegate one explicit
named landing task to push, merge, or deploy that lane. It evaluates the result,
then, after merge or abandonment, consult `agent-claim release --help`, release
the claim, and close the item. Subagents and reviewers have no autonomous
landing authority. Never land another owner's lane.

## Orchestration loop

While delegated lanes or executable plan steps remain, the head stays in its
orchestration loop. Prefer provider-native event, mailbox, or wait primitives
that wake on agent completion; do not busy-poll or spend model turns polling.
If unavailable, check status sparingly, about every 30–60 seconds. Consume each
completion immediately and dispatch needed review, fix, landing, or next work.
Do not end or report finished while agents are active or executable work
remains. Stop only when the objective is complete or every useful lane is
genuinely blocked on the operator or external state.

Do not use Atelier's deprecated Auto-Runner for coordination.

## Model routing

Keep the operator-started head model. Route delegated work by difficulty:

| Work | Codex | Claude | Grok | DeepSeek |
|---|---|---|---|---|
| Mechanical/search/repetition and mechanical review | Luna, low/medium | Sonnet, low/medium | 4.6, low | V4 Flash |
| Normal implementation/debugging and ordinary code/test/diff review | Terra, medium/high | Sonnet, high | 4.6, medium/high | V4 Pro |
| Architecture, security, or product decision; final high-risk gate | Sol, high/xhigh | Opus or Fable, high/xhigh | 4.6, high/xhigh | support only |

Grok always means Grok 4.6; change effort, never its model. For other models
that expose `max`, use it only for the rare hardest proof after lower effort is
insufficient. Use a final high-risk gate once for a final integrated candidate,
not for intermediate patches, test cleanup, or mechanical corrections. It is
required only where a public contract, persistent data, security, architecture,
or explicit policy makes the risk material. A `REVISE` returns to the same
reviewer after a coherent fix batch; the same reviewer may re-review only the
raised delta when its fix is strictly isolated and the integrated tree outside
the delta is unchanged. If interactions, scope, or risk changed, repeat the
full integrated review with fresh context. Do not start a new flagship or fresh
final review for each mechanical correction. Required reviews remain
independent: builders do not review their own work. A required final
independent review uses a fresh
context and a different model family from the builder.
DeepSeek may build or investigate, but is not the sole reviewer for security,
data integrity, public contracts, or a final verdict. Delegate only when its
coordination cost is smaller than the work. Never expose API keys.
