# Hygiene lens

Audit code hygiene against the code policy's "Code" section (guidance lookup
in `SKILL.md`) and the repository's facts. Configured tools own mechanical
checks (formatting, imports, types, dead code, complexity); this lens is
semantic judgment after reading the code.

## Procedure

1. Run the read-only quality tools the repository configures (manifest,
   `README.md`, or `.github/workflows/`); when none, skip this step.
2. Read candidate code in context. Report only issues a fixer can address
   concretely.

## Checklist

The code policy owns the rules. Each bullet is one check heading; look for:

- comments and docstrings that restate the next line instead of a
  non-obvious contract or tradeoff; functions with more than one job or no
  plain name;
- abstractions without real callers or that remove no duplication or
  complexity; shared helpers in a dumping-ground module rather than owned by a
  domain concept;
- loose dictionaries hiding a contract, and primitives where a path,
  identifier, enum or domain type belongs;
- validation defending impossible internal states instead of real boundaries;
- compatibility code, deprecated aliases and future parameters without
  current callers; inheritance without a real is-a relationship.

Severity: `HIGH` code shape that hides behavior or makes future changes
unsafe; `MEDIUM` clear maintainability drift.
