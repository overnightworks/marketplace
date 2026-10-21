---
name: board-hygiene
description: Check an open aco/GitHub work board against reality and give every open item a verdict (keep with a reason, close with a reopen trigger, merge, re-cut, body stale, label idea, idea) with evidence, judging every open item against a named current goal. Finds landed-but-open items, twins (also across repositories), items overtaken by a later ruling or landing, bodies whose sentences are no longer true, and dangling pointers. Use when the operator or the head asks for a board check, or before pulling work on a board that changed.
---

# Board Hygiene

The one check of whether each open item still makes sense. It reads and
reports; it never edits, comments, closes, claims, cuts, or lands. The head
applies what is clear under the coordination contract.

## Pass 1: mechanical

1. Write `aco board --json` to a scratch file and query that file, so a tool
   output limit cannot truncate the lists; `aco status` shows active claims.
   Read the projection as aco defines it; do not re-derive it from memory.
2. An entry in the `recovery` list names only the issue: find its `item` in
   the `landings` list, read that `pull_request` (the `sha` when it is null),
   and compare what it delivered with the item's
   `Done when`. Full coverage is `close`; partial coverage is `body stale`.
3. An `uncut` entry is the next slice to dispatch: `keep`, whether or not the
   item is a container. `re-cut` is only for an item whose body no longer
   matches its slices. A container (`items[].container` not null) with no
   `container.open_children` that is not in `uncut` is a `close` candidate (fold
   into its document). Step 4 still gates every `close` candidate and wins.
4. Before any `close`, test the item's `Done when` against evidence; an unmet
   `Done when` is never `close`.
5. `aco check <number>` only when an `aco` block looks broken, or for a
   pull request whose classification is in doubt. `body malformed` is the
   only result worth a verdict; `body ok` is not proof of done.
6. List open pull requests that no open item owns, with whether each can land
   (`mergeStateStatus` CLEAN and every check green; otherwise name the
   blocker). An owner is `closingIssuesReferences` or a
   `Lands #n` line in the PR body:
   `gh pr list --json number,title,body,author,closingIssuesReferences,mergeStateStatus,statusCheckRollup`.
   A bot pull request without an item is invisible to `aco next`.
7. A standing audit item whose "last run at commit X" anchor is more than its
   cadence behind (count the `landings` entries whose `committed_at` is later
   than X's commit date, `git show -s --format=%cI X`) gets a due line.

## Pass 2: sense

For each open item, read its body and test. A body with no `aco` block
(`aco check` prints `body legacy`) that carries no idea label gets `label idea`
when it reads as an idea (wish, why, how noticed), or `body stale` when it is
work. On a large board, read every
`aco` block and every sentence that names a file, command, or item; skim the
rest and say so in the report.

- Twin: once per board, not per item. Compare the open items' titles and
  scopes with each other and with items closed in the last 30 days
  (`gh issue list --state closed --search "closed:>=<date>" --limit 200`);
  no keyword search per item. Search other repositories with both forms
  `gh search issues "<owner>/<repo>/issues" --owner <owner>` and
  `gh search issues "<repo>#" --owner <owner>`; run both, pass `--limit 200` to
  each, say when a result hit the cap, and name every query in the report. Read
  only hits that name this repository's items or files (a bare keyword returns
  unrelated items).
  A suspected twin counts as false until the two bodies' own boundary text
  fails to separate them, and a cross-repository verdict without a named
  query is invalid. Verdict: `merge into #m`, or `close` when the other one
  landed.
- Overtaken: a later ruling, landing, or a changed vision removed the
  need. Verdict: `close`, citing the overtaking ruling or merge.
- Stale sentence: for each body sentence that names a file, flag, command,
  or behavior, run `git grep` at `origin/<default branch>` in the primary checkout (the
  repository's main checkout, not a lane worktree) after `git fetch`. A sentence the code
  contradicts gives `body stale`, quoting the sentence and the grep result.
- Dangling pointer, both ways: a body that names an item, lane, or file
  that does not exist or is closed; and other repositories' bodies (found
  by the cross-repository searches above) that expect this repository to act on an item
  that does not exist. Check inbound references before any `close` or
  `merge`.
- Goal: when the operator or the head names a current goal, judge every open
  work item once against it. `keep <reason>`: the item serves the goal now, and
  the reason names how; a keep without a reason is not a verdict. `close`: the
  item is done, overtaken, or not worth its lifetime cost now; when it is not
  done, add one sentence "reopen when <trigger>".
- Point: does the problem the item names still exist? If not, `close`.
- Landed but waiting for a live proof only the operator can give: `keep —
  unclear`, with that question on the operator list. Mark nothing "unverified".

A nearly empty board (two open items or fewer, claimed or not) skips Pass 1 detail: run
both aco commands, apply Pass 2 to each item, and report in under five
lines.

## Output

Exactly one line per open item, then a short trailing block: unowned pull
requests, due audits, queries run, and the closing list. A never-flag item gets
`keep — clear — <reason>`, an idea `idea — clear`. Clear lines omit the
bracketed field.

```text
<owner>/<repo>#<n> keep <reason>|close|merge into #m|re-cut|body stale|label idea|idea — clear|unclear — <evidence> [— recommendation; default: <verdict>]
```

- Evidence: the merged PR or sha, the overtaking ruling or landing with its
  link, or the false sentence and why it is false. Terse references
  (file:line, PR, sha) suffice. Empty `recovery`/`uncut` lists give no line.
- `clear` means the head may apply the verdict. `unclear` carries the
  evidence both ways, a recommendation, and a default.
- Unruled expectation lines (`aco rulings`, `items[].expectation_state`) go
  on the operator list.
- End with the `unclear` lines grouped per `<owner>/<repo>`: the operator's
  list, one short question per item with the recommendation and the default.

## Bounds

- Read-only and report-only. Git is limited to fetch, log, show, grep,
  ls-tree, cat-file, rev-parse, and status. Cross-repository work uses `gh search issues`,
  `gh issue view`, `gh pr list`, and read-only `gh search code` (to test a claim about
  consumers) only; list the `gh` calls you made.
- An active claim is never flagged `close` or `merge`; its false sentence is
  still reported as `body stale` for its lane.
- An idea (it carries the board's idea label; `aco next` lists it under
  `ideas:`, and `board --json` marks it `idea`) is judged only for
  being overtaken by the vision, a ruling or a landing: overtaken → close,
  otherwise verdict `idea`, left alone. Age is never a reason. An idea whose
  body has grown a plan, a scope or slices is a finding ("elaborated before its
  pull"). A deferred or blocked item with a projection is judged on its merits.
- Never flag: a container with open children, anything the operator touched
  recently unless independently proven landed, or a real dependency from
  GitHub's `blocked_by` relation. Idle age alone is never proof of completion.
- One pass, one report. No loops, no fixes, no persistent marker, tracking
  issue, or state-ref write.
- In doubt between keep and close, the line is `unclear`, recommends close with
  a reopen trigger, and defaults to close. An idea in the operator's words, or
  an item he touched recently, defaults to keep.
- The run proposes no freeze.
- Retiring a document with a banner, and contradictions between documents,
  belong to `docs-cleanup`.
