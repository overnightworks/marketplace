---
name: audit-architecture
description: Audit source modules for architecture drift and invariant violations. Use when asked to audit architecture, check module boundaries, verify ownership, review structural drift, or judge whether a change respects the repository design.
---

Audit the repository's source architecture. Treat the current repository
guidance and architecture docs as the rulebook. This is read-only unless the
user explicitly asks for fixes.

## Procedure

1. Define the scope from the request. For a change, inspect the diff and touched
   modules. For a full audit, enumerate the source files you cover.
2. Run configured read-only architecture tools first when they exist. Use their
   output as evidence, not as a substitute for reading the relevant code.
3. Work each checklist item below. For every hit, read surrounding code and try
   to refute it before reporting it.
4. Report only confirmed violations. Mark unknowns and skipped areas explicitly.

## Checklist

- Source of truth: authoritative state is owned in one place and not mirrored in
  globals, side files, or duplicated stores.
- Ownership: decisions and writes live in the module or boundary that owns the
  domain concept.
- Dependency direction: imports and calls follow the configured architecture
  contracts.
- External effects: filesystem, process, network, clock, randomness, and service
  calls sit behind explicit boundaries.
- Types over primitives: closed sets, identifiers, paths, and structured values
  use named types or enums when the project defines or needs them.
- Configuration: real tunables, provider choices, limits, timeouts, and secrets
  come from the configured owner instead of hidden literals.
- Signal channels: outcomes are read from the documented contract, not inferred
  from an incidental side channel.
- Failure behavior: invariant, data, integration, security, and process failures
  surface visibly instead of disappearing behind defaults.
- Concurrency: shared state, claims, and lifecycle ownership are atomic or
  guarded where parallel work can interleave.

## Output

Return findings grouped by category, highest severity first:

```text
[SEVERITY] <category> - <file:line>
What: <confirmed problem>
Why: <repository rule or invariant it breaks>
Fix: <concrete change>
```

Use `HIGH` for possible corruption, data loss, security exposure, or broken
lifecycle ownership. Use `MEDIUM` for maintainability drift that will likely rot.
Use `LOW` for arguable or localized issues. End with `CLEAN` when no high or
medium findings remain.
