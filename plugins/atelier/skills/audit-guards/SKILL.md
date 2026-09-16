---
name: audit-guards
description: Audit whether an instruction file carries every guard its role and layer require — a guard is a named failure class plus the one executable step that prevents it, plus the layer it must live in. Use when asked to audit guards, find which guard is missing, audit an agent definition / skill / CLAUDE.md / AGENTS.md against the guard catalogue, or why a failure class got through; also on a schedule — after every ~25 trunk landings and after any change to an agent definition, a skill, or a process contract — due-ness owned by the standing board item's anchor "last run at commit X", never by anyone's memory, and each run writes the new anchor into that item.
---

Judge presence of guards, not presence of prose. A guard is a named failure
class plus the one executable step that prevents it, plus the layer it must
live in (`references/guard-catalogue.md`). An artefact that discusses a
virtue but gives its executor no imperative, checkable sentence has not paid
for the guard — "look for reuse before writing" is not C1, "test thoroughly"
is not T3. The defect this audit finds is a guard that is missing,
misfiled, or unbounded: a failure class the artefact's readers can walk into
with nothing in their own instructions to stop them. **Strictly read-only:
this audit produces the finding list; it never edits the artefact.**

## Procedure

1. Take one artefact: an agent definition, a skill, a conventions file, a
   plugin policy file, a process contract, or a project CLAUDE.md/AGENTS.md.
2. Decide the artefact's role and layer before opening the catalogue. A
   conventions file or a plugin policy file carries no executor role: walk
   only the guards whose "Lives in" column names that layer, and file every
   other guard against the layer that actually holds it, never against this
   artefact. A definition read by several roles (e.g. a skill invoked by both
   a worker and a reviewer) is audited once per role.
3. Open the other artefacts of the same layer set beside the one under audit
   — the process contract, the agent definitions, the conventions — since
   several audit questions need them to judge fit and duplication.
4. Walk that layer's guards in order, one at a time, answering only yes or
   no.
5. Answer yes only for an **imperative sentence**: the executor is told what
   to do, not merely told the topic matters.
6. Answer yes only if the guard is **checkable**: a reader of the artefact's
   output can tell whether the step happened (a named owner, a quoted command
   with its exit code, a per-finding status, a fixed output field).
7. Answer no when the sentence exists but lives in the wrong layer for this
   executor (misfiled).
8. Answer no when the sentence exists but is unbounded (a decider count with
   no cap) or uses a vocabulary the rest of the system does not (a third
   severity word beside blocking/follow-up).
9. Where a guard is partially present, name only the missing clause and the
   weaker sentence it replaces — never paste the full catalogue sentence
   beside an existing weaker one, which would leave a duplicate.
10. A guard on the "Already in the contract" list is never filed as missing;
    file a wording drift instead, if the wording no longer matches.
11. Where two artefacts would both carry the same guard, file the finding
    against the layer the executor actually reads, and a second finding
    against the duplicate that must be removed.
12. Return the findings as one list per artefact, blocking before follow-up.

## Finding form

Every finding is exactly:

```text
missing: <guard #> in <file> -> consequence: <failure class> -- add: <sentence verbatim>
```

or, for a guard present but weak:

```text
incomplete: <guard #> in <file> -> consequence: <failure class> -- add: <missing clause> [replacing: <weaker sentence>]
```

Quote the executable sentence from `references/guard-catalogue.md` verbatim
— never paraphrase it into the artefact's own voice. Mark each finding
**blocking** (the guard's absence lets its failure class through silently)
or **follow-up** (the guard is present but misfiled, unbounded, or worded
weakly). Use no third severity word.

## Output

Return ONE distributor list, one section per audited artefact, blocking
findings before follow-up:

```text
<artefact path>
missing: C6 in agents/fixer.md -> consequence: an edit lands in the primary
checkout instead of the lane workspace -- add: "Work only under the
workspace or scratch location the brief names..." [blocking]
...
```

If an artefact carries every guard its layer requires, output `NO MISSING
GUARDS` for that artefact instead of an empty section. End the run with the
anchor: "last run at commit `<sha>`" for the standing board item.
