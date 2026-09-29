---
name: audit-guards
description: Audit whether an instruction file carries every guard its role and layer require — a guard is a named failure class plus the one executable step that prevents it, plus the layer it must live in. Use when asked to audit guards, find which guard is missing, audit an agent definition / skill / CLAUDE.md / AGENTS.md against the guard catalogue, or why a failure class got through; also on a schedule — after every ~25 trunk landings and after any change to an agent definition, a skill, or a process contract — due-ness owned by the standing board item's anchor "last run at commit X", never by anyone's memory, and each run writes the new anchor into that item.
---

Judge presence of guards, not presence of prose. A guard is a named failure
class plus the one executable step that prevents it, plus the kind it must
live in (`references/guard-catalogue.md`). An artefact that discusses a
virtue but gives its executor no imperative, checkable sentence has not paid
for the guard — "look for reuse before writing" is not C1, "test thoroughly"
is not T3. The defect this audit finds is a guard that is missing,
misfiled, unbounded, or weakly enforced: a failure class the artefact's
readers can walk into with nothing in their own instructions to stop them.
**Strictly read-only: this audit produces the finding list; it never edits
the artefact.**

## Procedure

1. Re-fetch every source in the guard catalogue's Sources appendix; flag
   every guard citing a source whose page hash differs from the recorded
   value as `re-check`.
2. Take one artefact: an agent definition, a skill, a code-rules file, a
   policy file, a facts file, or a CI or hook configuration.
3. Decide which kinds the artefact is the mailbox for, and which role
   executes it — from the reader table, never the file name. An artefact
   with no executor role is audited only against the guards whose "Lives
   in" names that kind. A definition read by several roles is audited once
   per role.
4. For a process artefact, check the mailbox's timing: does the head need
   this sentence at every moment, or at one step? A step rule found only in
   an always-loaded file is `follow-up -- wrong mailbox`; a core rule found
   only in a step skill, or in a skill triggered after the moment it
   governs, is `blocking -- missing`.
5. Walk the KIND, not the file: before marking a guard absent, open every
   artefact that delivers that kind — the contract, the skills, the role
   definitions, the enforcement configuration.
6. Walk that kind's audit bits in order, one at a time, answering only yes
   or no.
7. Answer yes only for an **imperative, checkable** sentence: the executor
   is told what to do, and a reader of its output can tell whether the step
   happened — a named owner, a quoted command with its status, a
   per-finding status, a fixed output field.
8. Answer no when the sentence is misfiled for this executor's kind, is
   unbounded (a decider count with no cap), or uses a vocabulary the rest
   of the system does not (a third severity word beside blocking/follow-up).
9. Fire on surplus, not only on absence: walk the artefact's own sentences
   and file every one whose reader is not this kind's as `follow-up --
   misfiled`.
10. "Does not apply here" is never an answer on its own: name the generic
    failure class, look for the sentence in this project's own concrete
    form, and only then mark the guard not applicable, with the reason
    written.
11. Where a guard is present but incomplete, name only the missing clause
    and the weaker sentence it replaces — never paste the full catalogue
    sentence beside an existing weaker one, which would leave a duplicate.
12. Read the head's private notes as an artefact of their own: file an
    imperative sentence another agent or another machine would have to
    execute, a ruling, a product decision, or a machine-local limit as
    misfiled, and name the kind it belongs to instead.
13. Check the level, not only presence: a guard sitting at a level below
    one this project could build is `follow-up -- weakly enforced`, naming
    the buildable level.
14. A sentence on the "Already in the contract" list is never filed as
    missing; file a wording drift instead, if the wording no longer
    matches.
15. A row marked **PROPOSED** yields a follow-up at most, never a blocking
    finding, and its sentence is never pasted into an artefact until the
    mark is gone.
16. Where two artefacts would both carry the same sentence, file the
    finding against the kind the executor reads, and a second finding
    against the duplicate that must be removed.
17. Quote the executable sentence from `references/guard-catalogue.md`
    verbatim — never paraphrase it into the artefact's own voice.
18. Return the findings as one list per artefact, blocking before
    follow-up.

## Finding form

Every finding is exactly one of:

```text
missing: <guard #> in <file> -> consequence: <failure class> -- add: <sentence verbatim>
```

```text
incomplete: <guard #> in <file> -> consequence: <failure class> -- add: <missing clause> [replacing: <weaker sentence>]
```

```text
misfiled: <the sentence> in <file> -> belongs in <kind>, whose reader is <role>
```

```text
wrong mailbox: <sentence> in <file> -> belongs in the <step> skill
```

```text
weakly enforced: <guard #> in <file> at level <n> -> build level <m>: <the mechanism>
```

```text
proposed guard absent: <guard #> -> pending H10 counter-check
```

```text
re-check: <guard #> in <file> -> source "<name>" page hash changed, evidence not reverified
```

Quote the executable sentence from `references/guard-catalogue.md` verbatim
— never paraphrase it into the artefact's own voice. Mark each finding
**blocking** (the guard's absence lets its failure class through silently,
or a core rule is missing from an always-loaded file) or **follow-up** (the
guard is present but misfiled, unbounded, weakly enforced, worded weakly, a
proposed row, or a source due for re-check). Use no third severity word.

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

If an artefact carries every guard its kind requires, output `NO MISSING
GUARDS` for that artefact instead of an empty section. End the run with the
anchor: "last run at commit `<sha>`" for the standing board item.
