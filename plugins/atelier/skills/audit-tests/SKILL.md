---
name: audit-tests
description: Audit test discipline and coverage quality. Use when asked to review tests, check behavioral coverage, find brittle tests, verify parallel-test safety, or judge whether a change is tested at the right layer.
---

Audit tests against the global contract's code policy (`~/.claude/CLAUDE.md`, or
`~/.codex/AGENTS.md` for Codex) and the repository's `AGENTS.md` or `CLAUDE.md`
for its test facts, else the conventions the suite itself follows. Passing
tests are not enough; judge whether the suite proves behavior clearly,
deterministically, and at the right altitude.

## Procedure

1. Define mode from the request. For a change audit, inspect changed source and
   tests. For a full audit, enumerate the suite scope. For a named test file,
   audit that file against the source it covers.
2. Find the test command in `README.md`, `AGENTS.md`, or `.github/workflows/`
   and run only the tests that cover the scope when current state matters;
   when no command is documented, judge from source and say so.
3. Cross-reference source behavior against tests. Prefer behavior contracts over
   line-count reasoning.
4. Report only confirmed test defects or coverage gaps.

## Checklist

- Behavior coverage: every new or changed behavior has a test or an explicit,
  justified reason it cannot.
- Right altitude: pure logic is tested directly; integration paths use real
  entry points without reimplementing production flow in the test.
- Observable assertions: tests assert user-visible output, state, errors, or
  contracts instead of private implementation details.
- Dependency control: pure tests do not require live services, real network, or
  external processes. A test in a unit file that needs a live dependency is a
  finding: it belongs in the integration suite (or a separate marker or
  directory where the repository has no integration split).
- Determinism: tests avoid sleeps, wall-clock races, shared mutable state, and
  order dependence.
- Parallel safety: tests can run concurrently without shared filesystem,
  environment, port, process, or global-state collisions. Judge it from the
  source (fixed paths, ports, environment writes, module-level state) when the
  repository documents no parallel run command.
- Maintainability: repeated scenarios are data-driven or fixture-backed when
  repetition would hide intent; a builder a test file writes privately for a
  contract another test file already builds is a duplication finding.
- Spec traceability: when the repository defines a human-readable requirements
  spec, e2e/acceptance tests declare the requirement ids they prove and
  orphans fail in both directions; when e2e tests exist with no spec scheme,
  recommend one as a finding. Unit tests stay exempt — their names are their
  spec.
- Failure clarity: assertion messages, test names, and fixtures make the broken
  behavior easy to identify.

## Output

Return findings under one heading per check that has findings, each in this
form:

```text
[SEVERITY] <check> - <file:line>
What: <confirmed test issue>
Why: <behavior or testing rule at risk>
Fix: <concrete change>
```

Use `HIGH` for missing behavior coverage, live dependencies in pure tests, or
known flakiness. Use `MEDIUM` for brittle coupling, unsafe parallelism, or
unclear duplicated tests. Use `LOW` for localized polish. End with `CLEAN` when
no high or medium findings remain.
