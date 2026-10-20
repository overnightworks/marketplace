---
name: code-cleanup
description: Find what can be deleted or simplified so a repository gets smaller and easier to maintain without losing proven behaviour — one ranked cut list. Use when asked to clean up, slim down, or shrink code, to find unnecessary code or the wrong architecture, when test:src or total size has grown fast, or before a refactor. For documentation trees use docs-cleanup; for a deletion-only pass use audit-deadweight.
---

Make the code smaller without making it less proven. **Strictly read-only:
this skill produces one ranked list of cuts; it never executes them.** It
composes the audit lenses and owns none of their checklists; the dispatching
seat spawns the lens subagents and never audits alone.

## Procedure

1. **Measure first.** Count non-blank src and test lines, the test:src ratio,
   and growth per area since a stated base commit. Use quality's scoreboard
   where the repository has it; otherwise state one counting rule and use it
   throughout. Count commits per file over the last 200 commits in the area,
   and how many files each of the last 10 feature commits touched. Start the
   depth pass on files both hot and large, unless the caller names an area;
   cite "feature commits touched K files" as locality evidence.
2. **Run the lenses in parallel**, each a fresh read-only subagent that
   follows its own skill on the chosen area:
   - audit-deadweight: code that has not earned its place;
   - audit-ownership: several deciders for one question;
   - audit-tests: test size against proven behaviour;
   - audit-architecture, depth pass: shallow modules and unreal seams.
3. **Merge** into one numbered list. Drop duplicates across lenses and keep
   the strongest evidence.
   - **Defects.** When two deciders of one question disagree, trace one
     concrete input through each and state who gets which different result. A
     reachable divergence goes into a separate `suspected defects` list above
     the cut list, with the triggering input and the ruled sentence or
     document it contradicts. A divergence on a question the requirements
     list as open goes to that question's owner as evidence, not as a bug.
   - **Concepts.** Group the deciders of one domain concept (for example "the
     presented take") into one candidate that lists its members, the owner it
     should have, and the interface that owner would offer.
   - **Ranking.** Defects first, then concept candidates by structural
     leverage, then line-level cuts by lines saved. A pure test
     deduplication never outranks a finding on the production path.

   Each finding carries:
   - `file:line` evidence and its lens;
   - the proposed change and who survives it;
   - estimated lines saved (src and test apart) and a confidence;
   - the proven behaviour it touches.

   A finding that moves a boundary or reshapes an interface is marked
   `needs plan review`, never `cut now`.

## Guard against cheating "smaller"

- A test that proves a ruled sentence, a spec criterion or a defect reference
  is never cut for length alone. It may merge into a table-driven test that
  proves the same.
- Judge lines per proven behaviour, not in total: a cut that deletes a
  behaviour's only proof is a loss, not a saving.
- Size, complexity and clone thresholds belong to quality's gate. Point at the
  gate; do not restate or re-measure its rules.

## Output

One distributor item in the audited repository, following the global
contract: the numbered findings list with evidence. Search the board for an
existing cleanup distributor first and sharpen it. Open no per-finding item;
a finding becomes one only when dispatched. End with the measurements from
step 1, the total estimated lines saved, what was examined and kept, and
leads without proof under "suspected, unproven".
