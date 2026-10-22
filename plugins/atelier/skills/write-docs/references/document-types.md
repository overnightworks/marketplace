# Document types

Owner of the type model that write-docs, visualize and docs-cleanup share.
Each document has exactly one type; a document that needs two becomes two
documents that link each other. A document's path names its type; elsewhere its
content does.

Sources: Diátaxis <https://diataxis.fr/>; ADR <https://adr.github.io/> and
Michael Nygard, "Documenting Architecture Decisions"
<https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>;
arc42 <https://arc42.org/>; Keep a Changelog
<https://keepachangelog.com/en/1.1.0/>. The examples below use a fictional
"Acme Notes" product.

## Pick the type

| Reader is... | Needs | Type |
|---|---|---|
| new, learning by doing | a guided first success | tutorial |
| competent, has a goal | steps to reach it | how-to guide |
| working, needs a fact | exact description | reference |
| curious or deciding | context and reasons | explanation |
| first-time visitor of a repo | what, how to start | README |
| a future maintainer asking why | one decision and its reasons | ADR |
| on call, something is wrong | actions under pressure | runbook |
| engineer changing the system | structure and runtime picture | architecture overview |
| anyone deciding what the product should do | why it exists, for whom, what it is not | vision |
| user or operator upgrading | what changed per release | changelog |

The first four are Diátaxis's types: tutorial (learning-oriented), how-to
guide (goal-oriented), reference (information-oriented), explanation
(understanding-oriented). In this skill's model, the other six are operational
types that mix the Diátaxis modes in a fixed, conventional shape.

## Tutorial

Use for: a beginner's first guided success. The author is responsible for the
learner succeeding.

Skeleton:

```markdown
# Your first <thing>
What you will build (one sentence, with the visible result).
## Before you start   <- only what is truly required
## Step 1 <action>    <- one action, then the expected output
## Step 2 ...
## What you built     <- link to how-to guides and explanation
```

Example: "Your first shared notebook. You will create a notebook and see a
teammate's edit appear. 1. Run `acme new demo`. Expected: `Created demo`.
2. Run `acme share demo --with ada`. Expected: `Shared with ada`."

Picture: none, unless a screenshot shows the expected result.

Mistakes: explaining why instead of guiding; offering choices; steps without
visible expected output; unverified steps that fail on a clean machine.

## How-to guide

Use for: a competent reader with a concrete goal. Title states the goal.

Skeleton:

```markdown
# How to <achieve goal>
Prerequisites (one line each).
1. <imperative step>
2. <imperative step>
Verify: <observable check>.
Related: <link to reference / explanation>
```

Example: "How to rotate the API token. Prerequisite: admin role. 1. Run
`acme token rotate`. 2. Update `ACME_TOKEN` in your secret store. Verify:
`acme whoami` prints the new token's expiry."

Picture: a flow chart for diagnosis; otherwise none.

Mistakes: teaching basics; background paragraphs mid-steps; covering every
option instead of one goal; a title that names the tool, not the goal; a shell
sequence to copy by hand where the repository should ship one command.

## Reference

Use for: facts looked up, not read through. Structure mirrors the thing
described; ideally derived from code, schema or `--help`.

Skeleton:

```markdown
# <Thing> reference
One-sentence description.
| Name | Type | Default | Meaning |
Per entry: constraints, errors, one minimal usage line.
```

Example: "`--with <user>`: string, required. Share target. Errors: `E_UNKNOWN_USER`
when the user does not exist."

Picture: a state or sequence diagram only where the order is the rule.

Mistakes: opinions, tutorials or rationale inside entries; hand-written copies
of what a generator or the code already states; incomplete or inconsistent
entry shape.

## Explanation

Use for: understanding, context, trade-offs, why it is this way. Read away from
the keyboard.

Skeleton:

```markdown
# About <topic>
The question this answers. Context and constraints. The model, with an
alternative considered and why it lost. Limits and open questions.
```

Example: "Why notebooks sync by operation log. Merging whole files loses
concurrent edits; an operation log replays both. Cost: log growth, compacted
nightly."

Picture: one diagram when the model has parts; otherwise none.

Mistakes: drifting into steps or option tables; no stated question; presenting
a preference as a fact.

## README

Use for: the front door of a repository or package. Answers what it is and how
to start, then links out.

Skeleton:

```markdown
# <name>
One sentence: what it is, for whom.
## Install / Quick start   <- minimal working path
## Documentation           <- links to tutorial, how-tos, reference
## Contributing / License  <- links
```

Example: "# acme-cli. Command-line client for Acme Notes. `pip install acme-cli`
then `acme login`. Docs: docs/. Licence: MIT."

Picture: at most one context diagram; a screenshot where there is a surface.

Mistakes: a full manual in the README; install steps that were never run;
duplicating facts that live in docs/.

## ADR

Use for: one significant architectural decision, kept as history. Immutable
once accepted; a change is a new ADR that supersedes the old. Shape uses
Nygard's sections; the skeleton moves status up to the header, where Nygard
placed it after decision.

Skeleton:

```markdown
# ADR-<n>: <decision as a short noun phrase>
Status: proposed | accepted | superseded by ADR-<m>
## Context       <- forces at play, value-neutral
## Decision      <- "We will ..." in full sentences
## Consequences  <- all of them, good and bad
```

Example: "ADR-7: Sync by operation log. Status: accepted. Context: concurrent
edits were lost by whole-file merge. Decision: We will store edits as an
append-only operation log. Consequences: no lost edits; the log needs nightly
compaction."

Picture: none.

Mistakes: no alternatives or forces in the context; only upsides listed;
editing an accepted ADR instead of superseding it; recording a trivial choice.

## Runbook

Use for: a known operational situation, read under stress. One alert or task
per runbook.

Skeleton:

```markdown
# Runbook: <alert or task>
Symptom: what the responder sees. Impact: who is affected.
## Check    <- command and expected output
## Fix      <- numbered, one shipped command per step, with rollback
## Escalate <- when and to whom
```

Example: "Runbook: sync lag above 5 min. Check: `acme ops lag` prints seconds.
Fix: 1. `acme ops restart-sync`. 2. Re-check; expect below 60. Rollback: none
needed. Escalate: if lag persists after 10 min, page the platform owner."

Picture: a flow chart for diagnosis.

Mistakes: prose instead of commands; a shell sequence to copy by hand instead of
a script the repository ships; steps never rehearsed; no expected output; no
rollback or escalation; explanation that belongs elsewhere.

## Architecture overview (arc42-lite)

Use for: the structure and runtime picture an engineer needs before changing
the system. arc42 defines twelve sections; "lite" here is a deliberate
reduction to the sections that answer a change-maker's questions, in arc42's
order and naming. Diagrams follow the visualize skill.

Skeleton:

```markdown
# <System> architecture
1. Context and Scope        <- who and what is outside; context diagram
2. Building Block View      <- containers/components and their jobs
3. Runtime View             <- two or three key scenarios as sequences
4. Deployment View          <- where the blocks run
5. Crosscutting Concepts    <- auth, errors, persistence, and Trust once a
                               security or deadweight decision needs one;
                               one paragraph each
6. Architectural Decisions  <- links to ADRs
7. Risks and Technical Debt <- known weak points
```

Example for section 1: "Acme Notes serves editors in a browser and syncs
through the API. Outside: the identity provider (login) and the mail service
(invites)." plus the context diagram.

Picture: a context and container diagram, one sequence diagram for the core flow.

Mistakes: a diagram per class instead of per question; plans described as
current structure; deployment detail nobody decides on; sections left as
template headings.

## Vision

Use for: the operator's intent for one product. It binds once the operator has
blessed it; until then it is a draft.

Skeleton:

```markdown
# <Product> vision
## The wish                 <- in the operator's words
## Who uses it today
## Deliberate non-goals
```

"Who uses it today" names people and products, not a list of dependent
repositories: those are read from manifests (the contract's product ownership),
and only a dependency no manifest shows stands here.

Limits: one screen. No plans, phases, status or technical choices, because
those rot; they belong in items and the architecture overview.

Example: "# Acme Notes vision. The wish: 'Notes my team can edit together
without ever losing a line.' Who uses it today: the support team (daily editing)
and the `acme-cli` repository (calls the sync API). Deliberate non-goals: not a
wiki, no public pages."

Picture: none.

Mistakes: a roadmap or status list; technical choices; wishes with no user
today; non-goals left empty; wording the operator never said or blessed.

## Changelog

Use for: per-release, human-readable changes for users and operators. Format
per Keep a Changelog 1.1.0: newest release first, an `Unreleased` section, ISO
dates, change groups Added, Changed, Deprecated, Removed, Fixed, Security.

Skeleton:

```markdown
# Changelog
## [Unreleased]
## [1.2.0] - 2026-10-01
### Added
- <user-visible change>
### Fixed
- <user-visible change>
```

Example: "## [1.2.0] - 2026-10-01 / ### Added / - `acme token rotate` replaces
manual token reissue. / ### Fixed / - Shared notebooks no longer drop
simultaneous edits."

Picture: none.

Mistakes: dumping commit logs; no dates or versions; omitting breaking changes
and deprecations; wording for developers, not for the reader upgrading.

## Repository document set

Owner of which documents every repository carries.

| File | Type | Reader's question | Length | Picture | Carried |
|---|---|---|---|---|---|
| `README.md` | README | What is this, for whom, how do I start, where do I read on? | ≤ 150 lines | at most one context diagram; a screenshot where there is a surface | every repository; quick start is a section, not its own file |
| `AGENTS.md` | owned by the agent-documentation skill | What must I know here that the code does not tell me? | ≤ 100 lines | none | every repository |
| `docs/VISION.md` | Vision | Why does it exist, for whom today, what is it deliberately not? | ≤ 40 lines | none | every repository, drafted when a decision first needs it |
| `docs/ARCHITECTURE.md` | Architecture overview (arc42-lite) | Which parts, who talks to whom, where are the boundaries and the trust? | ≤ 200 lines | context and container diagram, one sequence diagram for the core flow | every repository, drafted when a decision first needs it; a small repository keeps it to a few lines and one diagram |
| specs or requirements | Reference | What exactly must it do, and which test proves it? | one capability per file | state or sequence diagram only where the order is the rule | where others rely on ruled behaviour; harvested rulings live here |
| a decisions directory | ADR | What was decided, why, what was rejected? | ≤ 120 lines | none | only where a decision with rejected alternatives keeps coming back; existing directories keep their names |
| runbook or how-to | Runbook or how-to guide | Which command when, and how do I see it worked? | one task, one screen | flow chart for diagnosis | where a reader decides something with it |
| mockup | Mockup | What does the blessed surface look like? | one file per surface | it is the picture | one per surface the operator has blessed |

The length budgets are ruled by the operator (22.10.2026); quality's gate holds
them as a ratchet.

No roadmap, plan, wish-list or concept file: before the build it is the item
body; at the landing its lasting part moves into the architecture overview or a
decision record, and the rest closes with the item.

A ruled sentence enters the spec with the landing whose test proves it; until
then it lives in the item.

A decision record is written when the decision is taken.

One picture per question, drawn as Mermaid inside the document, never as a
binary image; the text beside it adds to the picture instead of reading it
aloud.

A frozen mockup is the one target picture; the landing that builds its surface
aligns it or replaces it.

No `quickstart.md`, changelog or runbook by default; each needs a reader who
decides something with it.

Overview documents (vision, architecture overview, README) stay abstract and
link down to the exact documents, never restating them.
