---
name: write-docs
description: Author or restructure documentation calibrated to its audience and altitude. Use when asked to write documentation for humans or for AI agents, create an architecture overview, document a feature, API, or process, decide where a piece of documentation belongs, or split docs by audience. For auditing existing doc trees use docs-cleanup; for AGENTS.md/skills/agents use agent-documentation.
---

Everything a reader meets must have a reason to be read by *that* reader.
Audience and altitude are decided before the first sentence, and duplicated
or ownerless information is a defect, not a style choice.

## Procedure

1. Name the reader and their decision: a human operator acting, a human
   engineer changing code, or an AI agent executing. Name the altitude:
   overview (mental model), working knowledge, or precise contract. If no
   concrete reader would change a decision by reading it, do not write it.
2. Find the owner first. If the fact already lives somewhere, update or link
   the owner — never copy. Copies drift; write views, not copies. A view
   states its source of truth and can be regenerated from it.
3. Calibrate to the reader:
   - **AI/agent docs**: compact, precise, deterministic wording; contracts,
     invariants, boundaries, and verification commands; no visuals, no
     motivation prose beyond the why that constrains decisions.
   - **Human overview**: abstract but accurate; lead with the mental model;
     one diagram (visualize skill) beats three paragraphs of structure; cut
     every detail the reader makes no decision about.
   - **Human detail** (spec, API, runbook): complete and exact — names,
     types, commands verified against code; sequence/state diagrams with UML
     precision where order or lifecycle matters.
4. For behavior, prefer linking the human-readable requirement to the
   executable test that proves it over re-describing the behavior in prose —
   a linked spec cannot silently rot; prose can.
5. Verify every concrete claim (paths, names, commands, shapes) against
   source before writing it. Mark unknowns as unknowns.
6. Re-read the result as the named reader. Delete every sentence they do not
   need. If two audiences genuinely need the same territory, give each its
   own view with one owner of the shared facts.

## Hard Limits

- No documentation without a named reader and decision.
- No duplicated facts across documents; link or derive instead.
- No planned or imagined behavior presented as current fact.
- Do not pad human overviews with implementation trivia, or agent docs with
  narrative.

## Output

Return: changed or created paths; per document the audience, altitude, and
the decision it serves; claims verified; and what was deliberately left out
or linked instead of written.
