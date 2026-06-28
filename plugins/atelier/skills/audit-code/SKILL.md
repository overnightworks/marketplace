---
name: audit-code
description: Audit source code for maintainability and code-hygiene problems that static tools cannot fully judge. Use when asked to audit code quality, find code smells, review readability, or check a diff against repository coding conventions.
---

Audit code hygiene against the current repository guidance. Let configured tools
own mechanical checks such as formatting, imports, type errors, dead code, and
known complexity thresholds. This skill is for semantic judgment after reading
the code.

## Procedure

1. Define the requested scope. For a change, inspect the changed files first.
2. Run or inspect configured read-only quality tools when useful.
3. Read candidate code in context. Treat heuristic matches as false positives
   until the code proves otherwise.
4. Report only issues that a fixer can address concretely.

## Checklist

- Comments and docstrings explain non-obvious contracts or tradeoffs, not what
  the next line already says.
- Functions have one job and can be named plainly.
- Abstractions have real callers and remove real duplication or complexity.
- Data shapes are named with types or classes when loose dictionaries hide the
  contract.
- Primitive values are not used where a path, identifier, enum, or richer domain
  type belongs.
- Validation sits at real boundaries instead of defending impossible internal
  states.
- Shared helpers are owned by a real domain concept, not a dumping-ground module.
- Compatibility code, deprecated aliases, and future parameters have current
  callers or are removed.
- Inheritance represents a real is-a relationship; otherwise prefer
  composition.

## Output

Return findings grouped by checklist item:

```text
[SEVERITY] <check> - <file:line>
What: <confirmed issue>
Fix: <concrete change>
```

Use `HIGH` for code shape that hides behavior or makes future changes unsafe.
Use `MEDIUM` for clear maintainability drift. Use `LOW` for localized or
arguable issues. End with `CLEAN` when no high or medium findings remain.
