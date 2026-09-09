---
name: board-hygiene
description: Inspect the open aco/GitHub work board against reality — flag landed-but-open items, cut-or-close containers, and stale text-only rows for the head to act on. Run when enough has changed, not on a clock.
---

# Board Hygiene

Keep the board truthful: every open item is either genuinely open with a
current body, or gets flagged with evidence for the head to act on. This
skill inspects and reports; it never edits GitHub, claims, closes, cuts, or
lands. Those stay head actions under the existing coordination contract.

## When to run

Run when the operator asks, or when `aco board` shows enough changed or aged
items since the last look to be worth inspecting — a judgement call, not a
stored count or marker. If nothing needs attention, report that and stop.
This skill keeps no persistent hygiene record: no marker comment, no standing
tracking issue, no state-ref write. Each run inspects the live board fresh.

## Procedure

1. Run `aco board` (or `--json`) for the full inventory, and read each item
   from what the projection actually means — never re-derive these from
   memory or diff archaeology:
   - `RECOVERY` — a merged pull request declared this issue its work item,
     but the issue is still open. The row prints only `#N`, not the proving
     pull request: read the merged PR itself (its number or `gh`) to see
     what it actually delivered. Propose `close` when it covers the item's
     acceptance sentence, or `re-project` (a fresh Now/Next, not a close)
     when it only partly does. Membership in `RECOVERY` alone is not
     completion evidence.
   - `KIND` — the type column (`task`/`bug`/`feature`/`container`); a
     `container` row is never itself claimable work.
   - `CONTAINERS` — every container's child progress (`#N closed/total;
     open: …`), including ones with open children. A line still showing an
     open child is not a finding. Only a line reading `open: none` is where
     step 2 below applies.
   - `UNCUT` — undispatched slice rows, independent of open-child count.
     A container with `open: none` in `CONTAINERS` and a row here needs a
     cut, not a close; the same container with `open: none` and no row
     here is a close-or-fold-into-its-document candidate instead.
   - `projectionless_idea` (plus the repository's idea label) — an unpulled
     wish. By design, not a defect; leave it even when it is also `STALE`.
   - `CLAIM`, checked against `aco status` — active work. Never flag a
     claimed item.
   - `BLOCKERS` — real open-issue dependencies from GitHub's own relation.
     Keep these; a dependency is not a formatting defect.
   - `EXPECT`, cross-checked against `aco rulings` — unanswered expectation
     lines. List them for the operator; an unruled line is not closable.
   - `STALE` — idle with no code yet. Inspect the body and recent activity
     before flagging: idle age alone is never proof of completion, and it
     never overrides `projectionless_idea` or an active `CLAIM` — those stay
     kept regardless of age.
2. Back every proposal with evidence:
   - Close: the merged PR/commit that covers the acceptance sentence.
   - Re-project: the same PR plus the gap it leaves open.
   - Cut: the `UNCUT` row's title and index.
   - Merge: the surviving item, and the unique detail from the weaker one
     that belongs in the survivor's body.
   - Superseded: the ruling or landed decision that removed the need.
   - Ambiguous: the evidence both ways, left for the head or operator.
3. Run `aco check <number>` only when an `agent-claim` block itself looks
   broken, or a specific pull request's classification is in doubt (pass
   that PR's own number, not the issue number). `check` reads the block and
   GitHub's `blocked_by` relation, never a prose "Blocked by" line, and
   answers exactly one of: `body ok` (not proof of done), `body legacy`
   (an old block shape, not malformed), `body malformed: …` (the block
   itself is broken — the only case worth a repair proposal), `body
   incomplete: <sections>` (expected for a not-yet-refined idea, not a
   defect), or `blocked by <#N>` (a real dependency — keep it).
4. Return the report to whoever dispatched you. Do not post it to GitHub,
   edit any body, or apply a proposal yourself.

## Output

Plain lines, no growing catalog of invented labels:

```text
ACTION <#issue> close|re-project|cut|merge into #survivor|supersede|fix-contract: <evidence>
KEPT <#issue>: <why — active claim, real dependency, idea/container by
design, open children, unruled expectation line>
AMBIGUOUS <#issue>: <evidence for> / <evidence against>
```

Every `ACTION` is a proposal only; the head applies, defers, or rejects it.

## Bounds

- Never flag: an active claim, a container with open children, an unpulled
  idea with no projection by design (even when also `STALE`), an unanswered
  ruling awaiting the operator, a real dependency, or anything recently
  touched by the operator unless independently proven landed.
- This skill grants no closing, claiming, cutting, or landing authority, and
  invents no new ledger or marker convention to replace the one it removes.
- One pass = one bounded report. No loops, no code fixes, no editing files
  other than the report you were asked to produce.
- When in doubt, keep and flag with evidence both ways. A wrongly closed
  item costs trust; a kept duplicate costs a card.
