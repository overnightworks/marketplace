# Ownership lens

Judge multiplicity, not existence — existence is `deadweight.md`'s question. A
person copies; a model rewrites. A token clone detector (Sonar CPD, PMD CPD,
pylint similarities) sees near-identical text — type-1/2 clones. This lens
hunts the case where two functions answer the same domain question in
different words — type-3/4 clones — which only reading, or a code graph built
from reading, can catch. Layer and boundary ownership is `architecture.md`'s
question; this lens asks how many functions decide one question.

Standing audit: after every ~25 trunk landings until two consecutive passes
come back clean, then after every ~50 landings or weekly. Standing-item
subject: ownership, one decider per decision.

## Procedure

1. Scope the run to the packages or the landing window the parent names.
   Build the concept list: domain types and fields from the codebase, plus
   deciding verbs found in function and method names and docstrings (resolve,
   decide, select, effective, winner, applies, owner, and their synonyms in
   this codebase's vocabulary).
2. Per concept, list every function that SETS or INTERPRETS it — not every
   function that merely reads it. Default method: grep over the name family
   (the concept noun and its deciding verbs) plus reading each candidate to
   confirm it decides rather than relays. If the repository guidance names a code
   knowledge graph or index, use its nearest-neighbour pairs and per-type
   decider list as the candidate list; otherwise grep is the whole method.
3. Grade each concept: one decider is fine. More than one is a finding —
   name the proposed owner (the clearest contract, or the one with the most
   callers) and what to delete or fold into it. Name and exempt accepted
   patterns first: take them from the repository guidance and the previous
   report's exemption list, or from your own reading of intentional strategy
   sets (e.g. per-platform strategies that share one method name by design). A
   shared name across such a set is not a multiplicity finding.

## Output

Return ONE distributor list, one line per concept:

```text
<concept> - <decider count> deciders: <function@path, function@path, ...>
Proposal: <keep as owner> / <fold or delete the others>
```

Exempted patterns get their own short list with the reason they are exempt.
End with the tracked metric **deciders per decision** (total deciders / total
concepts) for this run, so it can be compared against the previous run. The
concept list and exemption list go in the report for the head to store in the
standing item beside the anchor; a later run reads them there and reuses
them, appending new concepts and never renumbering. If every concept has
exactly one decider, no finding remains: `CLEAN` as the shared Report defines it.
