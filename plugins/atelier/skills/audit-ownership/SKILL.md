---
name: audit-ownership
description: Audit code for ownership multiplicity — how many functions decide the same question, not whether the code exists. Use when asked to audit ownership, check for one decider per decision, find who decides X, find semantic duplicates, or catch a rewrite instead of a reuse; also on a schedule — initially after every ~25 trunk landings until two consecutive passes come back clean, then relaxed to ~50 landings or weekly; due-ness is owned by the standing board item's anchor "last run at commit X", never by anyone's memory, and each run writes the new anchor into that item.
---

Judge multiplicity, not existence — that is audit-deadweight's question. A
person copies; a model rewrites. A token clone detector (Sonar CPD, PMD CPD,
pylint similarities) sees near-identical text — type-1/2 clones. This audit
hunts the case where two functions answer the same domain question in
different words — type-3/4 clones — which only reading, or a code graph built
from reading, can catch.

## Procedure

1. Scope the run to the packages or the landing window the parent names.
   Build the concept list: domain types and fields from the codebase, plus
   deciding verbs found in function and method names and docstrings (resolve,
   decide, select, effective, winner, applies, owner, and their synonyms in
   this codebase's vocabulary).
2. Per concept, list every function that SETS or INTERPRETS it — not every
   function that merely reads it. Default method: grep over the name family
   (the concept noun and its deciding verbs) plus reading each candidate to
   confirm it decides rather than relays. Where a code knowledge graph with
   function summaries and embeddings already exists for this repository, use
   its nearest-neighbour pairs and its per-type decider list as the candidate
   list instead of a fresh grep pass.
3. Grade each concept: one decider is fine. More than one is a finding —
   name the proposed owner (the clearest contract, or the one with the most
   callers) and what to delete or fold into it. Name and exempt accepted
   patterns first (e.g. per-platform strategies that share one method name by
   design) — a shared name across an intentional strategy set is not a
   multiplicity finding.

## Output

Return ONE distributor list, one line per concept:

```text
<concept> - <decider count> deciders: <function@path, function@path, ...>
Proposal: <keep as owner> / <fold or delete the others>
```

Exempted patterns get their own short list with the reason they are exempt.
End with the tracked metric **deciders per decision** (total deciders / total
concepts) for this run, so it can be compared against the previous run. The
concept list is stored with the anchor and reused run over run; new concepts
are appended, never renumbered.
Strictly read-only: this audit produces the list; it never edits or fixes.
If every concept has exactly one decider, output `NO MULTIPLICITY`.
