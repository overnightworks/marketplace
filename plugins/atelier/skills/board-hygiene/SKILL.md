---
name: board-hygiene
description: Inspect the open aco/GitHub work board against reality — flag landed-but-open items, dangling containers, and stale text-only ideas for the head to close, re-cut, or leave. Run when enough has changed, not on a clock.
---

# Board Hygiene

Keep the board truthful: every open item is either genuinely open with a
current body, or gets flagged with evidence for the head to close or re-cut.
This skill inspects and reports; it never edits GitHub, claims, closes, cuts,
or lands. Those stay head actions under the existing coordination contract.

## When to run

Run when the operator asks, or when `aco board` shows enough changed or aged
items since the last look to be worth inspecting — a judgement call, not a
stored count or marker. If nothing needs attention, report that and stop.
This skill keeps no persistent hygiene record: no marker comment, no standing
tracking issue, no state-ref write. Each run inspects the live board fresh.

## Procedure

1. Run `aco board` (or `--json` for scripting) for the full inventory, and
   read each item from the projection it already carries — never re-derive
   these from memory or diff archaeology:
   - `RECOVERY` — a merged pull request declared this its work item, but the
     issue is still open. Report as a close candidate with the PR/commit
     that proves it.
   - `KIND` / `CONTAINERS` / `UNCUT` — a container (epic/parent) with no open
     children and no terminal done-when. Flag it as needing a cut or a close
     into its owning document.
   - `projectionless_idea` (plus the repository's idea label) — an unpulled
     wish. This is by design, not a defect; leave it.
   - `CLAIM`, checked against `aco status` — active work. Never flag a
     claimed item.
   - `BLOCKERS` — real open-issue dependencies. `Blocked by: nichts` with no
     real blocker is not itself a finding.
   - `EXPECT`, cross-checked against `aco rulings` — unanswered expectation
     lines. List them for the operator; an unruled line is not closable.
   - `STALE` — idle past aco's threshold with no code yet. Inspect the body
     and recent activity before flagging; idle age alone is never proof of
     completion, and a fresh `aco check` "body ok" is not a done-when either.
2. Before reporting any candidate, back it with evidence:
   - Landed: the PR/commit that closes the acceptance sentence.
   - Duplicate: the surviving item, and the unique detail from the weaker
     one that belongs in the survivor's body.
   - Superseded: the ruling or landed decision that removed the need.
   - Ambiguous: the evidence both ways, left for the head or operator.
3. Run `aco check <number>` on any item whose body looks malformed — a
   missing `Blocked by`, a broken `agent-claim` block, a PR that fails to
   classify. Keep this separate from an intentionally unpulled idea, an
   un-cut container, or an unanswered ruling: a parseable contract says
   nothing about whether the work is done or closable.
4. Return the report to whoever dispatched you. Do not post it to GitHub,
   edit any body, or apply a candidate yourself.

## Output

```text
CLOSE-CANDIDATE <#issue> <landing evidence: PR/commit>
MERGE-CANDIDATE <#weaker> -> <#survivor> <unique detail to fold in>
SUPERSEDED-CANDIDATE <#issue> <ruling or landed decision>
AMBIGUOUS <#issue> <evidence for> <evidence against>
KEPT <#issue> <why: active claim / container with open children / idea with
no projection by design / unruled expectation line>
MALFORMED <#issue> <aco check finding>
```

Every candidate is a proposal; the head applies, defers, or rejects it.

## Bounds

- Never flag: an active claim, a container with open children, an unpulled
  idea carrying no projection by design, an unanswered ruling awaiting the
  operator, or anything recently touched by the operator unless independently
  proven landed.
- This skill grants no closing, claiming, cutting, or landing authority, and
  invents no new ledger or marker convention to replace the one it removes.
- One pass = one bounded report. No loops, no code fixes, no editing files
  other than the report you were asked to produce.
- When in doubt, keep and flag with evidence both ways. A wrongly closed
  item costs trust; a kept duplicate costs a card.
