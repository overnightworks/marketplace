---
name: visualize
description: Produce accurate diagrams-as-code for documentation. Use when a document needs an architecture overview, dependency graph, sequence, state, flow, or data-model diagram, or when asked to visualize a system, process, or structure for human readers.
---

A diagram is a set of claims, not decoration. Every node and edge asserts
something a reader will believe; derive them from authoritative sources and
verify them like any other documented fact.

## Procedure

1. Name the question the diagram answers and the audience who asks it. No
   question, no diagram. One diagram answers one question.
2. Derive from authoritative sources — code, import-boundary configuration,
   schemas, event contracts, route tables — never from memory or prose docs.
   Verify every node and edge against its source before drawing.
3. Pick the form by the question, not by habit:
   - structure and ownership → component/container diagram (C4-style altitude:
     context for outsiders, container for operators, component for engineers);
   - dependency direction → a graph generated from the boundary config;
   - behavior over time between parties → sequence diagram (UML semantics);
   - lifecycle of one thing → state diagram (UML semantics);
   - data shape → entity-relationship;
   - a user's path → flowchart.
4. Write diagrams as code inside the document — Mermaid when the host renders
   it (GitHub/GitLab do), so diffs review like code and agents can maintain
   them. Reserve heavier UML tooling for when Mermaid's notation genuinely
   cannot express the precision needed.
5. Keep the node count at the audience's altitude: collapse everything the
   reader makes no decision about. Names in the diagram match names in the
   code exactly.
6. Verify the render (render it, or screenshot via the see skill) and
   re-check each edge against source once after drawing.
7. Caption every diagram with the question it answers and the source it
   derives from, so the next editor regenerates instead of redrawing from
   imagination.

## Hard Limits

- No decorative diagrams, and no diagram that duplicates a table or list that
  says it better.
- Do not draw planned architecture as current structure; label aspirational
  parts explicitly or leave them out.
- A diagram contradicting the code is a defect to fix immediately, in
  whichever of the two is wrong.

## Output

Return the diagram block(s) plus, per diagram: the question answered, the
audience, and the sources each claim was verified against.
