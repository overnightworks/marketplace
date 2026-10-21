# Ownership lens

Judge multiplicity, not existence (`deadweight.md`'s question). A person
copies; a model rewrites. Token clone detectors see near-identical text
(type-1/2 clones); this lens hunts two functions answering the same domain
question in different words (type-3/4 clones), which only reading catches.
Layer and boundary ownership is `architecture.md`'s question.

Standing audit: every ~25 trunk landings until two clean passes, then every
~50 or weekly. Standing-item subject: ownership, one decider per decision.

## Procedure

1. Scope the run to the packages or landing window the parent names. Build the
   concept list: domain types and fields, plus deciding verbs from function
   names and docstrings (resolve, decide, select, effective, winner, applies,
   owner, and their synonyms in this codebase).
2. Per concept, list every function that SETS or INTERPRETS it, not one that
   merely reads it: grep the name family (the noun and its deciding verbs) and
   read each candidate to confirm it decides rather than relays.
3. Grade each concept: one decider is fine. More than one is a finding: name
   the proposed owner (the clearest contract, or the one with the most
   callers) and what to delete or fold into it. First name and exempt accepted
   patterns, from the repository guidance, the previous report's exemption
   list, or intentional strategy sets (e.g. per-platform strategies sharing a
   method name by design); a shared name across such a set is not a finding.

## Output

Return ONE distributor list of the finding records, one per concept with more
than one decider; `<lens>/<check>` is `ownership/<concept>` and `file:line` the
proposed owner. Extra field: `Deciders: <count>: <function@path, ...>`;
`Change` is the proposal: keep one as owner, fold or delete the others.

List exempted patterns with the reason. End with the tracked metric
**deciders per decision**: all deciders found (counted once per concept)
divided by all concepts examined, flagged or not, as counts and ratio.
The concept and exemption lists go in the report for the head to store in
the standing item beside the anchor; a later run reuses them, appending new
concepts and never renumbering.
