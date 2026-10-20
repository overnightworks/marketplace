# Hygiene lens

Audit code hygiene against the code policy's "Code" section (see the guidance
lookup in `SKILL.md`) and the repository's facts, else the conventions the code
itself follows. Let configured tools own mechanical checks such as formatting,
imports, type errors, dead code, and known complexity thresholds. This lens is
for semantic judgment after reading the code.

## Procedure

1. Scope: for a change, the changed files first; for a named file or
   directory, that target.
2. Run the read-only quality tools the repository configures (linter and type
   checker settings in the manifest, `README.md`, or `.github/workflows/`);
   when none are configured, skip this step.
3. Read candidate code in context. Report only issues a fixer can address
   concretely.

## Checklist

The code policy owns the rules; this is the list of what the audit looks for.

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

## Severity examples

Group findings under one heading per checklist item.
`HIGH` for code shape that hides behavior or makes future changes unsafe.
`MEDIUM` for clear maintainability drift. `LOW` for localized or arguable
issues.

Hand-offs: none.
