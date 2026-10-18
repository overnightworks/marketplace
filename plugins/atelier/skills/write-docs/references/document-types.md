# Document types

Owner of the type model that write-docs, visualize and docs-cleanup share.
Each document declares exactly one type; a document that needs two becomes two
documents that link each other. The declaration is a `Type: <type>` line
directly under the title (or a `type:` front-matter key where the file already
has front matter). A document without one gets its type inferred from content
by whoever touches it, who then adds the line when editing.

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
| user or operator upgrading | what changed per release | changelog |

The first four are Diátaxis's types: tutorial (learning-oriented), how-to
guide (goal-oriented), reference (information-oriented), explanation
(understanding-oriented). In this skill's model, the other five are operational
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

Mistakes: teaching basics; background paragraphs mid-steps; covering every
option instead of one goal; a title that names the tool, not the goal.

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
## Fix      <- numbered, copy-pasteable, with rollback
## Escalate <- when and to whom
```

Example: "Runbook: sync lag above 5 min. Check: `acme ops lag` prints seconds.
Fix: 1. `acme ops restart-sync`. 2. Re-check; expect below 60. Rollback: none
needed. Escalate: if lag persists after 10 min, page the platform owner."

Mistakes: prose instead of commands; steps never rehearsed; no expected
output; no rollback or escalation; explanation that belongs elsewhere.

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
5. Crosscutting Concepts    <- auth, errors, persistence, one paragraph each
6. Architectural Decisions  <- links to ADRs
7. Risks and Technical Debt <- known weak points
```

Example for section 1: "Acme Notes serves editors in a browser and syncs
through the API. Outside: the identity provider (login) and the mail service
(invites)." plus the context diagram.

Mistakes: a diagram per class instead of per question; plans described as
current structure; deployment detail nobody decides on; sections left as
template headings.

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

Mistakes: dumping commit logs; no dates or versions; omitting breaking changes
and deprecations; wording for developers, not for the reader upgrading.
