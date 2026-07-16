---
name: board-hygiene
description: Review every open atelier work item against reality — retire what landed, merge duplicates, flag the ambiguous. Run when enough has changed, not on a clock.
---

# Board Hygiene

Keep the atelier board truthful: every open item is either genuinely open, or it
leaves with a reason. Never silently delete; every retire carries evidence.

## When to run (check first, cheaply)

1. Read the last-pass marker: the newest retire reason containing `[hygiene]`
   (GET /api/board), or assume "never ran".
2. Count since then: landings on local main (`git log --oneline <marker>..`)
   and new board items.
3. Run the pass only if ≥10 landings OR ≥15 new items since the last pass,
   OR the operator asked, OR a morning reveal is imminent (pre-vernissage).
   Otherwise report "no material" and stop.

## Procedure

1. Inventory: GET /api/board — every item with id, taxonomy, summary, parent,
   slice state. Skip items already retired/superseded.
2. For each open item, classify with EVIDENCE, never from memory:
   - IMPLEMENTED: a landed commit covers the item's acceptance
     (`git log -i --grep=...` on local main; read the diff if unsure).
     -> retire, reason `[hygiene] umgesetzt: <commit> <subject>`.
   - DUPLICATE/MERGED: another open item owns the same need
     -> retire the weaker one, reason `[hygiene] zusammengefuehrt: <item-id>`;
     fold any unique detail into the survivor's description first (POST /api/work/edit).
   - SUPERSEDED: a ruling or landed architecture removed the need
     -> retire with the ruling/commit as reason.
   - STALE-AMBIGUOUS: probably dead but no proof -> do NOT retire; list it
     for the operator with your best evidence both ways.
   - OPEN: keep; if the summary is not a human-readable 1-2 sentence story,
     propose (not apply) a clearer summary.
3. Retire via POST /api/work/retire (slice_id, reason, superseded_by when a
   survivor exists). A 409 usually means state `verified` — leave those, they
   exit through integration, not retirement; list them separately.
4. Report: retired (with evidence), merged, kept-with-flags, ambiguous-for-operator,
   and the new marker. Post the report as a comment-style note in the item you
   were dispatched from, or to the operator channel that dispatched you.

## Bounds

- Never retire: active/claimed slices, verified slices, epics with open children,
  anything the operator touched in the last 24h (priority/edit) unless implemented.
- One pass = one bounded run; no loops, no fixing code, no editing other files.
- When in doubt, keep and flag. A wrongly retired dream costs trust; a kept
  duplicate costs a card.
