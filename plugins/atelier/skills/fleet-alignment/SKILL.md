---
name: fleet-alignment
description: Keep a parallel agent fleet pulling one rope — no duplicate, obsolete, ambiguous, or contradictory work. Use as the coordinator to reconcile plans, the work board, and active lane claims against one vision before or while the fleet builds, after a plan pivot, or whenever you suspect wasted or overlapping effort. Report-first; the human approves every merge/retire before anything changes.
---

# Fleet Alignment

A parallel fleet's central failure is not idleness — it is building the same
thing twice, building something a pivot already discarded, or building from an
item so vague two agents read it two ways. This skill reconciles the work
surfaces against one vision and produces an operator-approved consolidation. It
does not mutate anything until the operator approves.

## Procedure

1. Inventory three surfaces:
   - Plans: `docs/plans/active/*.md` and `docs/plans/backlog/*.md`.
   - The live work board / Wall: read-only through the running server's board
     API or the app's own discovery path — never a second writer against the
     open database.
   - Active lane claims (write leases).
2. For each plan and board item, capture: one-line purpose, status (already
   landed? superseded by a pivot? genuinely active?), and owning subsystem.
   Judge status against the single epic-owner doc (the vision) and the `done/`
   records — not against the plan's own optimistic self-description.
3. Classify the seams: DUPLICATE/OVERLAP, OBSOLETE, AMBIGUOUS, CONTRADICTION.
   Treat every suspected duplicate as false until the two plans' own boundary
   text fails to separate them — most "duplicates" are complementary and say so.
4. Before proposing any delete or move, grep for inbound references. A document
   linked by `done/` records or other plans is retired in place with a banner,
   never deleted — a dangling link is worse than a stale-but-honest pointer.
5. Produce the report: MERGE / RETIRE / SHARPEN / CONTRADICTION, each with a
   file-cited evidence line, a confidence mark, and what the human must confirm.
6. Apply only what the operator approves, smallest safe change first: a plan
   freeze-banner plus a board routing note beats live-database surgery. A real
   board-item edit goes through the server's own edit API.

## Guards

- Report before mutating. Never retire or rewrite a plan or work item without
  explicit operator approval.
- A refuted duplicate stays two plans; fix the seam with a boundary/index note,
  not a merge.
- Reversible-first: banners and routing notes over deletions; delete only when
  no inbound reference exists.
- Reuse the existing active/backlog/done convention; do not invent a new folder
  or owner just to tidy.

## Output

```text
FROZEN|RETIRED|MERGED|SHARPENED <target> — <change + file-cited evidence>
KEPT <target> — <why deliberately left unchanged>
CONFIRM <the decision the operator must make before it is applied>
```
