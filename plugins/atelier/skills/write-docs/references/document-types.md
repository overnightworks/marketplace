# Document types

Owner of the type model that write-docs, visualize and docs-cleanup share.
Each document has exactly one type; a document that needs two becomes two
documents that link each other. A document's path names its type; elsewhere its
content does.

Sources: Diátaxis <https://diataxis.fr/>; arc42 <https://arc42.org/>. The
examples below use a fictional "Acme Notes" product.

## Pick the type

| Reader is... | Needs | Type |
|---|---|---|
| working, needs a fact | exact description | reference |
| first-time visitor of a repo | what, how to start | README |
| on call, something is wrong | actions under pressure | runbook |
| engineer changing the system | structure and runtime picture | architecture overview |
| anyone deciding what the product should do | why it exists, for whom, what it is not | vision |

Reference is a Diátaxis type; the other four are operational types that mix
the Diátaxis modes in a fixed, conventional shape; a mockup is a picture, not
text. A tutorial, how-to guide or explanation is no file of its own: write it
as a mode inside the README (the example), a runbook (the steps) or the
architecture overview (the reasons).

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

A string another tool matches is a contract: the reference states it and a
test pins it. A fact about an external tool names the version it was measured
on and the command that re-measures it; a new release is re-measured, not
trusted.

Mistakes: opinions, tutorials or rationale inside entries; hand-written copies
of what a generator or the code already states; incomplete or inconsistent
entry shape.

## README

Use for: the front door of a repository or package. Answers what it is and how
to start, then links out.

Skeleton:

```markdown
# <name>
One sentence: what it is, for whom.
## Install / Quick start   <- minimal working path
## Documentation           <- links to the reference and runbooks
## Contributing / License  <- links
```

Example: "# acme-cli. Command-line client for Acme Notes. `pip install acme-cli`
then `acme login`. Docs: docs/. Licence: MIT."

Picture: at most one context diagram; a screenshot where there is a surface.

Mistakes: a full manual in the README; install steps that were never run;
duplicating facts that live in docs/.

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
reduction to the sections that answer a change-maker's questions, in
arc42's order; sections 6 and 7 are the fleet's own. Diagrams follow the
visualize skill.

Skeleton:

```markdown
# <System> architecture
1. Context and Scope        <- who and what is outside; context diagram
2. Building Block View      <- containers/components and their jobs
3. Runtime View             <- the core flow as one sequence diagram
4. Deployment View          <- where the blocks run
5. Crosscutting Concepts    <- Trust, the proof strategy, and auth, errors or
                               persistence where they matter; one paragraph each
6. Constraints and reasons  <- invariants no single line carries, each with its
                               reason
7. Not chosen               <- one present-tense line per alternative that keeps
                               coming back: why not, and the condition that
                               reopens it
8. Risks and Technical Debt <- known weak points
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
repositories: those are read from manifests (`instructions/HEAD.md`, Product),
and only a dependency no manifest shows stands here. When nobody uses the
product yet, the section says so in one line.

Limits: the document set's budget. No plans, phases, status or technical
choices, because those rot: plans, phases and status belong in items, technical
choices in the architecture overview.

Example: "# Acme Notes vision. The wish: 'Notes my team can edit together
without ever losing a line.' Who uses it today: the support team (daily editing)
and the `acme-cli` repository (calls the sync API). Deliberate non-goals: not a
wiki, no public pages."

Picture: none.

A blessed vision stays as blessed; a rewrite to this skeleton waits for the
operator's blessing. A draft takes each section from the operator's words, the
README or the rulings; a section none of them answers stays out and goes to the
operator as a question with the draft, never invented.

Mistakes: a roadmap or status list; technical choices; a section invented or
left as an empty heading; wording the operator never said or blessed.

## Mockup

Use for: the blessed picture of one surface, frozen before its build. One file
per surface; a newer blessed mockup replaces the older one in the same change,
and the item names it, so there is no index. The landing that finishes the
surface deletes it; a later change starts from a screenshot of the real surface.

Picture: it is the picture.

Mistakes: an unblessed draft kept as current; a second file for the same
surface; a mockup kept after its surface was finished.

## Repository document set

This section holds contract rules: the fleet standard for which documents
every repository carries. It covers every repository and is due at a
repository's first landing after it that changes a tracked Markdown file.

| File | Type | Reader's question | Length | Picture | Carried |
|---|---|---|---|---|---|
| `README.md` | README | What is this, for whom, how do I start, where do I read on? | ≤ 150 lines | at most one context diagram; a screenshot where there is a surface | every repository; quick start is a section, not its own file |
| `AGENTS.md` | owned by the agent-documentation skill | What must I know here that neither the code nor the global contract tells me? | ≤ 100 lines and ≤ 4 KiB; `CLAUDE.md` = `@AGENTS.md` | none | every repository |
| `docs/VISION.md` | Vision | Why does it exist, for whom today, what is it deliberately not? | ≤ 40 lines | none | every repository |
| `docs/ARCHITECTURE.md` | Architecture overview (arc42-lite) | Which parts, who talks to whom, where are the boundaries and the trust? | ≤ 200 lines, with the sections of the skeleton above | context and container diagram, one sequence diagram for the core flow | every repository; a small repository keeps it to a few lines and one diagram |
| `docs/<contract>.md` | Reference | What exactly does the contract promise, and which test proves each rule? | one contract per file | state or sequence diagram only where the order is the rule | where others implement a contract; generated where derivable; each rule carries the ID its test cites |
| `docs/runbooks/<task>.md` | Runbook | Which command when, and how do I see it worked? | one task, one screen | flow chart for diagnosis | always for infrastructure, elsewhere where a reader operates something |
| `docs/mockups/<surface>.html` | Mockup | What does the blessed surface look like? | one file per surface | it is the picture | from the operator's blessing until the landing that finishes its surface |

A repository that serves several readers gives each contract its own reference
and each task its own runbook; the README routes each reader there. A document
is written in its reader's language, one language per document; a quoted wish
keeps the words it was spoken in.

The set's paths are exact; a file under another name or case is renamed to it.
No sentence carries its provenance (a date, a ruling marker, an item number),
except the Stand date of a legal page; a spec ID its tests cite names a rule,
not its origin. A section of ruled sentences says so in its first line, and the
landing that removes a behaviour removes its ruled sentences and their tests.

Never in the tree: decision records; CHANGELOG, MIGRATING and HISTORY
(breaking changes go on the release page and into each dependent's release
item); plans, roadmaps, concepts and status tables (before the build they are
the item body); evidence logs; citations of records, rulings or items;
mockups of finished surfaces; prose that restates code; index files,
CONTRIBUTING, TESTING and llms.txt. A library's API reference lives in its
docstrings.

A ruled sentence enters the reference with the landing whose test proves it;
until then it lives in the item.

One picture per question. A diagram is code inside the document, Mermaid where
the host renders it (the visualize skill), never a binary image; a screenshot
shows only a real surface. The text beside a picture adds to it instead of
reading it aloud.

Overview documents (vision, architecture overview, README) stay abstract and
link down to the exact documents, never restating them.
