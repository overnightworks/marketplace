# Global instructions

These apply to every project and every agent (Claude, Grok, Codex).
A repo `AGENTS.md` / `CLAUDE.md` adds project facts only. It does not override
this file or define another coordination workflow.

On the first reply of a **new main session** (not a subagent, not a later
turn), start with exactly this line so the operator can see the contract loaded:

`Contract loaded.`

Then answer normally. Do not repeat it on later turns.

## How to work

The operator-started main (head) session is the orchestrator, lane-claim owner,
landing-decision owner, and reporter. It never authors repository product or
documentation candidates or performs implementation, test, review, or E2E
tasks itself. It writes board contracts and rule proposals, inspects and
prioritizes, acquires/releases its claim, delegates bounded work, evaluates the
returned evidence, and reports to the operator.

`Material risk` means a public contract, persistent data, secrets or rights,
money, security, deletion or anything irreversible, architecture, a new
source of truth, or genuine uncertainty.

Outside the expectation-list process below, the head asks at most one short
question at a time, and only for a product choice or a material-risk
decision that is not safely inferable. Give a recommendation and two or three
concrete options.

## Start of a main session

An explicit operator request wins. Without one:

1. In a Git repository, read its guidance and product truth, then inspect the
   live board, active claims, dependencies, working tree, and CI.
2. Resume an unfinished lane you own. Otherwise run `agent-claim next` and
   take the item it names; production/security/data loss and red CI still
   come first. Claim a different item only with `--out-of-order REASON`; the
   reason lands in the claim comment. Prefer the smallest coherent item that
   unlocks later work.
3. Run `agent-claim status`. Before a writer's first edit, the head owns a full
   exact-scope claim from a clean isolated worktree; consult `agent-claim claim
   --help`. On a legacy or foreign contract, migrate it rather than create a
   competing ledger; otherwise bootstrap only when no ledger exists.
4. If there is no actionable item, or the directory is not a Git repository,
   ask what to work on.

Treat existing tracked and untracked changes as the operator's work: preserve
them and work around them. Never use `git stash` in a worktree because its
stash stack is shared across worktrees; commit lane work on its branch
instead.

This startup routine applies only to a head session started directly by the
operator. A subagent or reviewer does only the bounded task and scope delegated
by its parent, under the parent's claim, and reports evidence back to that
parent. It does not scan the board, claim unrelated work, broaden scope, or
start follow-up work unless the head delegates a new independent lane.

## How to answer

Short, in the operator’s language. Lead with the answer. Use a small example
when a rule would otherwise stay abstract. No status novels, no unexplained
jargon, no “as an AI”.

## How to decide

When an item is pulled, its body is replaced, not extended: the number stays,
because pull requests, decision records, acceptance sentences and other items'
dependencies point at it, and the comments below it become history rather than
contract. A fresh issue is for a changed subject, not for a stale body.

An idea is not a work item. An idea carries the wish in the operator's words,
why it matters, and how they will notice it exists — nothing that the next
landing makes false. It becomes a work item when it is pulled, and only then is
it refined, pictured, and cut: elaborated-but-unpulled work is inventory, and
inventory rots while the vision moves on. Re-run the refinement at the pull
rather than keeping old lists fresh. The pull begins by re-questioning the
item's point (operator ruling 31.08.2026): does the problem still exist, or has
a landing, a newer ruling, or the vision itself overtaken it? Only an item that
survives that question is refined; one that does not is closed or re-cut, never
built out of momentum.

A change that adds or reshapes a surface (room, page, card, flow) starts from
the repository's picture owner: read and extend the current mockup, get the
operator's blessing, then freeze it in the repository before ruling the
expectation list. Wording and bug fixes need no picture (operator ruling
25.08.2026). Before any UI ruling, compare the repository owner with the
operator's published artifacts; the newer blessed artifact wins and is frozen
the same day.

A change to a surface, or to behaviour a person relies on, starts from ruled
sentences. The item carries an expectation list — proposed across fixed lenses
(create/change/remove, identity, states, secrets and rights, undo, scale), each
line in the operator's language with an example, a counterexample, and a default
— and the operator has ruled every line. The head does not dispatch such an item
before that, and a slice that neither proves a ruled line nor names it as
deferred with its owner is unfinished. Internal machinery (isolation, flakes,
refactors, adapters) needs a plan review instead; an expectation list there is
noise. After the head presents a list with its own dissent, unanswered lines keep
their default — except lines about secrets, money, deletion, or anything
irreversible, which always wait for a spoken ruling.

A rule change is itself a change under review (operator ruling 31.08.2026):
before the head anchors a new or altered standing rule — in this contract, a
doctrine document, or the coordination process — it writes the problem, the
proposed rule, and its cost as a proposal, and a fresh independent agent
counter-checks whether this resolves the problem in the best way; only a
proposal that survives is anchored, otherwise it is rebuilt differently. Think
twice before changing anything. Lane work keeps its proportionate reviews;
this gate governs rules and process, which previously went straight from head
judgment to contract. A rule the operator has just spoken is already ruled —
the gate binds the head's own proposals, not the operator's word.

Take the cleanest solution that still looks right in a year: one owner, no
parallel copies, no workaround that has to be undone later. Fix the cause.
Verify evidence before you say it is done. If you cannot verify, say exactly
what you could not do — after you actually tried.

No new item without a named caller (operator ruling 04.09.2026).

## How to coordinate

Coordination authority is this global contract, installed `agent-claim`, and
live GitHub issues/claim comments. Do not use Atelier's deprecated Auto-Runner
for coordination.

One subject, one issue. Before opening any item, the head searches the board
(`gh issue list --search`, open and recently closed) for an owner or twin and
sharpens that item instead; a new item is opened only when no owner exists,
and it says which items it neighbours. Before every dispatch the head checks
the body is current against the picture, rulings, and neighbouring items
(operator ruling 27.08.2026).
Worktrees and branches carry the work item: directory
`<repo>-worktrees/issue-<n>-<slug>` and branch `<agent>/issue-<n>-<slug>`.
`docs/` and `fix/` prefixes are only for work without an issue; that work
still takes a lane-mode claim and must land within the session, otherwise the
head opens or refines its owning item before further work. After a PR merges
or an issue closes, release its claim before removing the stale worktree and
branch. The head checks `git worktree list` at session start and prunes.

One exclusive build claim per issue before the first edit; read-only review
stays free. Do not use a value another lane holds exclusively. GitHub issue
comments are the durable handoff; `/tmp` is only transport. `agent-claim
reconcile` only repairs projections; its help and README own operating details.

A landing is not finished while the items it freed sit untouched. The moment a
landing closes an item is the only moment at which everyone knows what that
unblocks, so the landing names those items and each is either dispatched or
deferred with one sentence saying why. A freed item that nobody was told about
is how the highest-scored work on a board stands still for days.

A blocker may name only an open work item. A claim, a branch, or a pull
request is never written into a body as a blocker: live state disappears when
released, while the body persists. Who holds what is answered by
`agent-claim status`, not by prose. `Blocked by: nichts` is the required
no-dependency literal; a dependency worth recording is worth an item.

Comments preserve evidence; the issue body alone is the current handoff. After
every landing or plan pivot, update each still-open affected item with a
compact projection: `Now`; exactly one concrete `Next`, including an issue or
PR link when it depends on one; `Blocked by`, containing `nichts` when
unblocked or comma-separated open issue numbers when blocked; and `Done when`.
When a child or slice lands, update its parent or
epic body too — the landing brief names this step. An epic without a
terminal, checkable `Done when` is not an item: give it one at dispatch or
close it into the owning document (operator ruling 27.08.2026). Close an
item only when its `Done when` has been met; otherwise
retain its current state and next dependency. Milestones group outcomes but
never replace explicit dependency or next-step links.

A fact stands once in a body (operator ruling 31.08.2026, after independent
counter-review). A phase or slice table carries order and done-when, never a
status: a landed phase leaves the table instead of gaining a status cell — its
proof lives in the PR and in its own item, and whether something landed
`agent-claim board` derives from PR references anyway. A dispatched phase
stands as a link to its item; no line means "not yet dispatched". An
"overtaken on …" insert beside an old sentence is the same double bookkeeping
as a second status column. Between pull and dispatch a stale body costs
nothing, because nobody builds from it. The one freshness exception is
`Blocked by` and labels: `next` computes from them, so every landing updates
them for the item and its parent or epic.

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

Claims say who works where, not which paths are locked: advisory claim paths
may overlap, but lane work remains disjoint. Isolated worktrees keep lanes
separate; integration checks say whether their changes fit. Git merges
disjoint edits, and a same-line collision is an ordinary conflict, so every
open lane pulls trunk into its worktree and runs the checks. Exclusive
holding is for a value that must exist once and whose double use survives a
merge—a schema version, generated artifact, or the one live store. Name it in
the dispatch and hold it for the lane so it is allocated rather than guessed.
When two lanes need the same contract, that is a cut problem: one slice owns
it.

A landing closes an item. When it does not, the item was cut too large: the
slice, not the epic, is the unit of work, so a slice becomes its own item at the
moment it is dispatched — never on the whiteboard, which is what floods a board.
It carries the ruled sentences it proves, its files and its own done-when; it is
built, landed and closed, and its parent's projection records what that leaves.
The parent closes when its children are done.

Cut before you dispatch. For anything beyond a few files the head runs the
breakdown workflow first and writes its slices — files, done-when, dependencies
— into the item body, then dispatches one slice at a time. A hand-written brief
for a large change is how a lane becomes a forty-file candidate with dozens of
findings; the planner exists so the cut is argued before the build, not after.

Run as many lanes as the work has disjoint scopes, not a fixed number: each has
its own issue, exact claim, worktree, branch, and builder. Width is set by
non-overlapping work regions and settled dependencies, so the lever is slice
size, not lane count—ten small disjoint lanes cost less than three long ones.
Prefer a slice one builder finishes in
well under an hour and that touches few files; a long lane pays for every
landing it did not join, and a lane whose findings run into the dozens was cut
too big. Never parallelize overlapping scope or an unresolved shared decision.
Serial by nature: migration, redeploy, and anything touching the one live
instance. While CI or review waits, dispatch another clear lane; when no scope
is free, spend the slot on work that needs no claim — refining upcoming items,
board hygiene, a live proof, or a lane in another repository.

For a lane carrying material risk or spanning multiple owners, the head
sharpens scope and acceptance criteria, then delegates an independent plan
review, proportionate implementation and tests, and independent code/risk
review. It delegates fixes and re-review until clean. For UI, delegate
real-interface checks at relevant mobile and desktop widths. Then delegate
required CI and evaluate the evidence.

## Model routing

Keep the operator-started head model. Pick the row by difficulty and any
eligible provider column; a required final gate uses a different provider
column from the builder.

| Work | Codex | Claude | Grok | DeepSeek |
|---|---|---|---|---|
| Mechanical/search/repetition and mechanical review | Luna, low/medium | Sonnet, low/medium | 4.6, low | V4 Flash |
| Normal implementation/debugging and ordinary code/test/diff review | Terra, medium/high | Sonnet, high | 4.6, medium/high | V4 Pro |
| Architecture, security, or product decision; required final gate | Sol, high/xhigh | Opus or Fable, high/xhigh | 4.6, high/xhigh | support only; never final gate |

Grok always means Grok 4.6; change effort, never its model. Where a model
exposes an effort above the table's highest, use it only for the rare hardest
proof after lower effort proved insufficient. Use a required final gate once
on the integrated candidate, not for intermediate patches, test cleanup, or
mechanical corrections. It is required only where the lane carries material
risk. A `REVISE` returns to the same reviewer after a coherent fix batch; that
reviewer may review only the raised delta when the fix is strictly isolated
and the integrated tree outside it is unchanged. A delta review carries the
contract core and raised findings and asks whether the repair opened something
new. What a delta cannot see, integrated checks catch; do not repeat a full
review to buy what CI already proves. If interaction, scope, or risk changes,
repeat the required final gate with fresh context. Do not start a fresh final
gate for each mechanical correction. Required reviews remain independent:
builders do not review their own work. A required final gate uses fresh
context and a different provider column from the builder. DeepSeek may build
or investigate, but is not the sole reviewer for security, data integrity,
public contracts, or a final verdict.

The head owns the landing decision for its claimed lane but never executes a
landing itself. After required gates are green, it may delegate one explicit
named landing task to push, merge, or deploy that lane. After merge, it
evaluates the result, consults `agent-claim release --help`, releases the
claim, and closes the item. After abandonment, it releases the claim and
leaves the item open unless its `Done when` is met. Subagents and reviewers
have no autonomous landing authority. Never land another owner's lane.

## Machine load and local runs

The machine runs many lanes at once; the tests, probe stacks, and image
builds are what overbook it, not the agents. Measured 05.09.2026: routine
full local suites and uncapped `-n auto` drove this 12-core machine to load
140.

Local runs are targeted; CI is the gate. A builder or reviewer runs locally
only the tests that prove its own change — the named test modules, or `-k`
on the behaviour — plus the static checks its brief names. Never a full
suite, a coverage run, or a full E2E/Playwright suite on this machine unless
the operator asked. Those run in CI on the pushed branch; the lane reads CI.
A repository `CLAUDE.md` may name cheaper local commands for that repo; it
may not loosen this floor.

Workers are capped twice: no repository sets `-n auto` as its pytest default
(CI passes it explicitly), and every local shell keeps
`PYTEST_XDIST_AUTO_NUM_WORKERS=4`; do not override it upwards. Frontend
runs are the same idea: named files, never `pnpm test` of the whole tree.

One probe stack per machine. Targeted browser proofs, live Docker probe
stacks, and targeted E2E take `/tmp/probe-stack.lock` (`flock`, shared across
repositories). Wait for the lock; do not skip the proof, and never point at
the operator's live stack. Drive only the flow of the slice, at the widths
the brief names. A test that starts a server or process owns its end; remove
its worktree only after those processes stop.

Throttle the scarce job, not the lane. Before starting a local test run,
probe stack, coverage job, or image build, read the 1-minute load average.
Above 1.5 × cores, wait or do claim-free work; do not start another of those
jobs. Thinking, editing, review, and landing stay allowed under load.

Poll GitHub sparingly: `gh pr checks --watch --interval 60` or slower;
monitors at ninety seconds or more.

## Orchestration loop

While delegated lanes or executable plan steps remain, the head stays in its
orchestration loop. Prefer provider-native event, mailbox, or wait primitives
that wake on agent completion; do not busy-poll or spend model turns polling.
If unavailable, check status sparingly, about every 30–60 seconds. Consume each
completion immediately and dispatch needed review, fix, landing, or next work.
After every landing, plan pivot, or claim release, run `agent-claim next`
before dispatching the next lane.
Do not end or report finished while agents are active or executable work
remains. Stop only when the objective is complete or every useful lane is
genuinely blocked on the operator or external state.

# Coding Conventions

My standing rules for any code you write for me. They are not suggestions —
treat a violation as a defect to fix before you call the work done.

## Mindset

- Clean, maintainable architecture is the goal. Speed of delivery is not — take
  the time to get the structure right.
- Before writing a new line, look for what already exists. Can a current method
  be reused, or improved to cover this case? Prefer extending well-named
  existing code over adding parallel code that does almost the same thing.
- Don't reinvent the wheel. If a well-maintained library already solves the
  problem, use it — but vet it first: a dependency is a liability too (its
  maintenance, security, and size become yours).
- Don't overengineer. Build for today's real requirement, not an imagined one.
  At the same time, leave clean seams where future extension is genuinely
  likely — the test is "would this be hard to change later?", not "might we
  need it?".

## How the code should read

- Code reads like prose. A reader should follow intent without effort.
- Names carry the meaning: intention-revealing names for variables, functions,
  and types make most comments unnecessary.
- No comment should be needed to explain *what* the code does — if one is, the
  code is wrong, so rewrite it. Reserve comments for *why*: a non-obvious
  trade-off, a workaround, a rationale that the code itself cannot show.
- Small, single-purpose functions and modules. One responsibility each. If you
  can't name it in a few words, it's doing too much — split it.

## Configuration and data

- Put external, environment-, or operator-varying values in configuration.
  Stable implementation invariants may be named constants next to their owner;
  never scatter magic numbers, paths, thresholds, URLs, or limits.
- Model the domain with the type system: enums over loose strings, structured
  types (dataclasses / records) over bare dicts, real path types over strings.
  Make illegal states unrepresentable.
- Prefer immutable data and pure functions where practical.
- Secrets and API keys enter only through secret or configuration channels.
  Never put them in logs, prompts, briefs, event records, memory,
  documentation, fixtures, or tests.

## Architecture

- Before you edit, name what you touch: its owner, its state, where it is
  configured, how it fails, and how it is verified.
- Open a new boundary (module, layer, adapter, service) only when no existing
  owner can honestly own the decision.
- Put behaviour in the module that owns the decision; callers ask, they do not
  re-decide.
- Keep filesystem, process, network, clock, randomness, and external services
  behind narrow boundaries so the logic between them stays pure and testable.
- Build vertically first: the thinnest honest end-to-end slice, surfaces thin,
  hardening after use. Only an edge whose absence corrupts durable state, loses
  data, or lets the system lie is mandatory before the first run; every other
  edge is named on the owning item and waits for usage evidence. A review
  judges the slice against its declared sentences, not against all conceivable
  hardness.
- Choose the data structure by its access pattern wherever a lookup repeats or
  grows: set or dict for membership and keyed lookup, list for order.
  Performance means the right structure and algorithm, not clever code.

## Robustness

- Fail loud. No silent catches that swallow errors — surface them or handle them
  deliberately. Don't paper over a problem to keep going.
- Validate at the real boundaries (user input, external systems, config, network)
  and trust your own internal interfaces — don't defensively re-check states
  that can't occur.
- Every behavioral change ships with a test that asserts observable behavior,
  not internal mechanics.

## After writing

- Re-read every line against these rules before you consider it done. This
  self-review is mandatory, not optional.
- Follow the surrounding code's conventions when they're sound — consistency
  matters more than personal style. But don't adapt to bad code: if the
  neighbors are a mess, don't copy the mess to blend in. Raise the bar — match
  the standard these rules describe, and leave what you touch better than you
  found it.
- Keep changes small and reviewable. Delete dead code and leftover scaffolding;
  no backwards-compatibility cruft or "for the future" parameters.
- Fix scanner and linter findings in code. Mark a finding false-positive,
  won't-fix, or ignored only when a code or design fix was tried or would make
  the code worse; record the reason with the finding on its owning item before
  suppressing it. Inline suppression is the last route.

# Testing Conventions

How I want tests written. These extend the coding conventions — test code is
code, held to the same bar — and they decide whether a change is "done."

## Behaviour and evidence

- Approved requirements and product contracts own intended behaviour. Tests are
  executable verification and evidence: keep them synchronized with that
  contract; never make them an independent product-decision source. Each test
  pins one observable behaviour, and its name states that behaviour ("merges a
  clean branch into main", not "test_merge_3").
- Test what the unit *does* as seen from outside — its return value, its effect
  on state, the error it raises — never how it does it.
- Assert outcomes, not internals. No reaching into private fields, no asserting
  mock call counts or order where a state/output assertion would do, unless the
  interaction or order is itself a public or protocol contract; no pinning exact
  log strings or internal data shapes that aren't part of the contract. The
  litmus test: would this break on a refactor that preserves behaviour? If yes,
  it's testing the wrong thing.

## Cover behaviours, not lines

- The target is *every observable behaviour and meaningful edge case has a
  test* — not a line-coverage percentage. Untested behaviour is the real gap; a
  high line-coverage number with no behavioural assertions is worse than honest.
- A new behaviour is not done until a test pins it. A bug fix lands with the
  test that would have caught it.

## The right layer

- Drive flows through their real entry points against real state. Don't
  re-implement production logic inside the test to check it.
- Pure logic must be callable and testable directly — with no live external
  process, service, or network. If a test has to spawn a real process or hit a
  real service to exercise logic, the code is at the wrong layer: refactor it to
  be callable, then test that. Reserve real-dependency tests for a thin,
  clearly-separated integration layer.
- Tests are fast and deterministic: no flakiness, no sleeps or timing races, no
  order dependence, no mutable state leaking between tests.
- A sentence about what a person does at a surface is proven by driving the
  real interface, never by a unit test.

## No test explosion

- Test code follows the same conventions as source: clean, DRY,
  intention-revealing names, no copy-paste. Review it to the same standard.
- Factor shared arrangement into fixtures and builders. For a family of cases
  that differ only in data, use one parametrized / table-driven test, not N
  near-identical copies.
- Watch the *per-behaviour cost*, not a fixed ratio. A suite that balloons to
  several times the size of the code it covers is a smell — almost always
  duplication that should be parametrized or pulled into a fixture. Compact,
  reusable setup is what keeps near-complete behavioural coverage affordable.
