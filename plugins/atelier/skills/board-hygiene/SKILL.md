---
name: board-hygiene
description: Check an open aco/GitHub work board against reality and give every open item a verdict (keep, close, merge, re-cut, body stale) with evidence. Finds landed-but-open items, twins (also across repositories), items overtaken by a later ruling or landing, bodies whose sentences are no longer true, and dangling pointers. Use when the operator or the head asks for a board check, or before pulling work on a board that changed.
---

# Board Hygiene

The one check of whether each open item still makes sense. It reads and
reports; it never edits, comments, closes, claims, cuts, or lands. The head
applies what is clear under the coordination contract.

## Pass 1: mechanical

1. `aco board --json` for the inventory; `aco status` for active claims.
   Read the projection as aco defines it; do not re-derive it from memory.
2. An entry in the `recovery` list names only the issue: read the merged pull
   request that declared it and compare what it delivered with the item's
   `Done when`. Full coverage is `close`; partial coverage is `body stale`.
3. A container (`items[].container` not null) whose `open_children` is empty
   and that is listed in `uncut` is `re-cut`; if not listed, it is `close`
   (fold into its document).
4. `aco check <number>` only when an `aco` block looks broken, or for a
   pull request whose classification is in doubt. `body malformed` is the
   only result worth a verdict; `body ok` is not proof of done.

## Pass 2: sense

For each open item, read its body and test:

- Twin: search this board with `gh issue list --state all --search`, so
  recently closed items appear, and other repositories with
  the item's URL form `<owner>/<repo>/issues/<n>` (the sharp query) or,
  as fallback, `gh search issues "<repo>#" --owner <owner>`; read only hits
  that name this repository's items or files (a bare keyword returns
  unrelated items). A suspected twin counts as false until
  the two bodies' own boundary text fails to separate them. Verdict:
  `merge into #m`, or `close` when the other one landed.
- Overtaken: a later ruling, landing, or a changed vision removed the
  need. Verdict: `close`, citing the overtaking ruling or merge.
- Stale sentence: for each body sentence that names a file, flag, command,
  or behavior, run `git grep` at the default branch's HEAD in the primary checkout
  after a fetch (`aco status` prints it as `base=`). A sentence the code
  contradicts gives `body stale`, quoting the sentence and the grep result.
- Dangling pointer, both ways: a body that names an item, lane, or file
  that does not exist or is closed; and other repositories' bodies (found
  by the sharp search above) that expect this repository to act on an item
  that does not exist. Check inbound references before any `close` or
  `merge`.
- Point: does the problem the item names still exist? If not, `close`.

A nearly empty board (two open items or fewer, claimed or not) skips Pass 1 detail: run
both aco commands, apply Pass 2 to each item, and report in under five
lines.

## Output

Exactly one line per open item, nothing else except the closing list. A
never-flag item gets `keep — clear — <reason>`. Clear lines omit the bracketed
field.

```text
<owner>/<repo>#<n> keep|close|merge into #m|re-cut|body stale — clear|unclear — <evidence> [— recommendation; default: <verdict>]
```

- Evidence: the merged PR or sha, the overtaking ruling or landing with its
  link, or the false sentence and why it is false.
- `clear` means the head may apply the verdict. `unclear` carries the
  evidence both ways, a recommendation, and a default.
- End with the `unclear` lines grouped per `<owner>/<repo>`: the operator's
  list, one short question per item with the recommendation and the default.

## Bounds

- Read-only and report-only. Cross-repository work uses `gh search issues`,
  `gh issue view`, and read-only `gh search code` (to test a claim about
  consumers) only; list the `gh` calls you made.
- Never flag: an active claim, an unpulled idea (no projection, by design,
  even when listed in `stale`), a container with open children, an unruled expectation
  line (list it for the operator; `aco rulings` and
  `items[].expectation_state` show them), anything the operator touched
  recently unless independently proven landed, or a real dependency from
  GitHub's `blocked_by` relation. Idle age alone is never proof of completion.
- One pass, one report. No loops, no fixes, no persistent marker, tracking
  issue, or state-ref write.
- When in doubt, keep and mark `unclear`. A wrongly closed item costs trust;
  a kept duplicate costs a card.
- Retiring a document with a banner, and contradictions between documents,
  belong to `docs-cleanup`.
