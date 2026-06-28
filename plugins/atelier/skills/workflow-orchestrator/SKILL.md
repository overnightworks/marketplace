---
name: workflow-orchestrator
description: Orchestrate long-running repository work as reviewed stories and phases with plan review, delegated subagents, optional isolated worktree builders, documentation updates, gap critique, verification, and one commit per completed story or phase. Use when asked to manage multi-phase implementation, generate stories from a plan, continue work while the user is away, coordinate parallel agents, coordinate worktrees, build a reviewed implementation roadmap, or run a plan-implement-review-fix-commit loop.
---

# Workflow Orchestrator

Use this skill to act as the parent agent for work too large or risky for one
unreviewed patch. Own the end goal and gates; delegate planning,
implementation, review, and fixes. Keep each story or serial phase small enough
that a human can understand and revert its commit.

Run order: planner, plan reviewer, optional story generation, optional
preflight exploration or audit, worker implementation, documentation update
when needed, targeted verification, diff review and gap critique, fixer loop,
final verification, then commit.

The parent agent coordinates. It should implement directly only when delegation
is unavailable, the change is docs-only or mechanically tiny, or direct editing
is safer than splitting the work. When it does so, report why.

## Coordination Modes

Choose one mode at the start of each objective or phase.

- **Serial phase**: one parent or one worker completes one approved phase. Use
  this when delegation, isolated workspaces, or a clean split are unavailable.
- **Parallel planning/review**: many read-only agents explore, plan, or review
  the same repository state. Use this freely when their questions are distinct.
- **Parallel builders**: multiple workers implement different stories in
  isolated worktrees or equivalent isolated workspaces. Use this only when each
  story has a disjoint write set and no unresolved dependency on another active
  story.

Do not run parallel write-heavy agents in the same checkout. If isolated
worktrees are unavailable, downgrade builder work to serial mode and keep
subagents read-only.

## Story Contract

A story is the smallest reviewed, buildable unit that can land as one commit.
When converting a plan into stories, give each story:

- stable id and short title;
- user value or invariant added;
- owner module or documentation owner;
- allowed write paths and forbidden paths;
- read-only context paths;
- dependencies on earlier stories;
- acceptance criteria;
- required verification;
- documentation impact;
- rollback boundary;
- stop conditions.

Generate stories in parallel only as proposals. The parent must deduplicate,
order, and approve the story queue before implementation starts.

## Default Epic Pipeline

When the user invokes this skill with an epic, plan, or end goal, run this
pipeline by default instead of asking the user to spell out orchestration
mechanics:

1. If the epic or end goal is missing, ask one concise question for it. Do not
   ask whether to orchestrate; using this skill means the parent should
   coordinate.
2. Use available read-only subagents in parallel to propose stories, review
   architecture boundaries, and identify dependency or conflict risks. If
   subagents are unavailable, do those passes serially and report the
   limitation.
3. Merge the read-only outputs into one deduplicated story queue using the
   Story Contract. The parent owns the final story ids, order, dependencies,
   and write scopes.
4. Review the story queue before implementation. Do not start write work until
   the next story or parallel story group is approved.
5. Pipeline later story preparation when useful: while one approved story is
   under review, implementation, or verification, read-only agents may prepare
   or critique the next story. Do not start write-capable work for that later
   story until its own gate passes.
6. Start parallel builders only after a reviewed story queue exists and the
   Worktree Builder Gate proves the selected stories have disjoint write paths.

The default is therefore: parallel thinking first, parent-owned story queue,
then serial or worktree-isolated building depending on story independence.

## Start

1. State the end goal, branch, starting commit, working-tree state, and stop
   conditions.
2. Read `AGENTS.md`, `docs/TOOLING.md`, and only the architecture or plan docs
   needed for the objective.
3. Search existing docs, code, tests, skills, and agents before adding a new
   owner, rule, abstraction, file, or dependency.
4. If the objective spans more than one phase, keep a compact phase queue with
   a done state, documentation impact, acceptance criteria, verification, and
   what can be deleted or simplified.
5. When the user asks for stories or parallel builders are needed, convert the
   approved phase into a compact story queue using the Story Contract. Keep
   story queues in the thread unless they must persist across sessions or the
   user asks for story files.
6. Keep phase plans in the thread unless the work must persist across sessions
   or the user asks for a plan file. If persisted, use the existing plan owner
   and keep it compact.
7. Do not start implementation without a named end goal and one approved next
   phase. Treat later phases as provisional until their plan gate runs.

## Plan Gate

Before editing each phase:

1. Give the end goal, current evidence, and any known constraints to
   `phase_planner`.
2. Review the proposed phase queue with `plan_reviewer`.
3. Refine with the planner until the reviewer returns `PASS`; keep rejected
   alternatives out of committed docs unless they explain a durable decision.
4. Use `code_explorer` for unknown code paths. Use `code_auditor` for
   architecture, runtime, tests, or boundary risk. Use `capability_critic` for
   skills, custom agents, hooks, and workflow guidance.
5. Implement only the first approved phase. Stop on a `KILL` verdict,
   contradictory sources, missing owner, unclear user decision, or unsplit
   serial phase too broad for one commit.

## Implementation Loop

For each approved phase:

1. Record the starting commit.
2. If the phase has multiple independent stories, build a parallel group only
   from stories with disjoint write paths and no active dependencies. Otherwise
   implement one story at a time.
3. Delegate implementation by default. Use `code_worker` for bounded executable
   or documentation work and reserve direct parent edits for the exceptions
   above. The parent agent owns integration and commits.
4. For parallel builders, assign each worker an isolated worktree or equivalent
   isolated workspace. Give each worker the base commit, story id, branch or
   workspace name, allowed write paths, forbidden paths, acceptance criteria,
   and verification target. Tell the worker it is not alone in the codebase and
   must not revert or overwrite unrelated work.
5. If workers cannot receive isolated workspaces, do not start parallel
   builders. Use read-only subagents for exploration/review or run a serial
   implementation.
6. Tell subagents their file scope, acceptance criteria, verification target,
   and that they must not revert unrelated work.
7. Use `documentation_curator` when the phase changes behavior, architecture,
   configuration, tooling, testing, or user-visible usage. Assign project docs
   only; do not route `AGENTS.md` through the documentation phase.
8. If subagents are unavailable, perform the same checks locally and report that
   limitation.
9. Keep edits inside the phase. If implementation reveals a different owner or
   larger design change, stop and re-plan.

## Worktree Builder Gate

Before starting more than one write-capable worker:

1. Confirm the parent checkout is clean or that all local changes are explained
   and assigned.
2. Confirm every parallel story has a disjoint write set.
3. Create or select one isolated worktree/workspace per story.
4. Record the base commit for every worker.
5. Tell workers not to commit, push, touch remotes, or merge other stories.
   Final integration and commits remain owned by the parent.
6. Require each worker to return changed paths, verification, blocked status,
   and remaining risk.
7. Integrate worker results one at a time in the parent checkout or designated
   integration workspace, running verification after each integration.

If any worker changes outside its assigned write set, stop that story and review
manually before integrating.

## Review Loop

Repeat until clean or blocked:

1. Run verification from `docs/TOOLING.md`: targeted checks for docs-only
   changes, the fast agent guardrail for skill or agent guidance, and full
   verification for executable behavior, tool configuration, CI, dependencies,
   or runtime-test changes.
2. Read the diff yourself.
3. Use a fresh reviewer for the bounded diff: `code_reviewer` by default,
   `code_auditor` as the gap critic for architecture, tests, code, or runtime
   risk, and `capability_critic` for agent or skill changes. For documentation
   changes, assign a read-only review to `code_reviewer` with the docs paths and
   documentation acceptance criteria.
4. Keep a transient findings ledger in the thread: reviewer, severity, path,
   status, and decision. Do not write review findings into the repository unless
   the user supplied a destination or the finding becomes a durable documented
   decision.
5. Send confirmed local fixes to `code_fixer` by default. The parent may fix
   mechanically tiny findings, docs wording, or unavailable-fixer cases, and
   should report why.
6. Reject or escalate unclear, architectural, or scope-expanding findings.
7. Re-run targeted verification after each fix batch. Run full verification
   before final review and commit when executable behavior, tool configuration,
   CI, dependencies, or runtime tests changed. For docs-only fixes after a clean
   full run, targeted policy and diff checks are enough.
8. For parallel builders, review and integrate one story at a time. If several
   worker diffs prove inseparable, stop, redefine them as one story, update the
   story or phase plan, and rerun the review gate before implementation or
   commit.

## Commit Gate

Commit only after the story or serial phase is verified and reviewed.

- One story or serial phase equals one commit. Do not mix drive-by cleanup,
  future scaffolding, or unrelated user changes into the commit.
- Include tests, docs, and configuration required for that phase in the same
  commit.
- Commit message names the capability, invariant, or problem removed.
- Do not push or touch remotes unless the user explicitly asks.
- After committing, capture the commit hash, verification command, remaining
  risk, and next phase.
- Automatically enter the next phase's Plan Gate when the prior phase is
  committed, the working tree is clean, an accepted phase queue exists, the
  objective remains clear, and no stop condition needs user judgment.
- Automatically start the next parallel group only when the prior group is fully
  integrated, reviewed, committed, all worker worktrees are accounted for, and
  the remaining stories are still independent.

## Stop Conditions

Stop and report status when verification fails, review finds a non-local design
issue, sources contradict, secrets or external side effects are involved, the
working tree contains unexplained user changes, or the next phase would need
user judgment.

Return a concise status: phase, commit when present, changed paths,
verification, reviewer verdicts, blockers, and next recommended phase.
