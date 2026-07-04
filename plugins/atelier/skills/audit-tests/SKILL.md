---
name: audit-tests
description: Audit test discipline and coverage quality. Use when asked to review tests, check behavioral coverage, find brittle tests, verify parallel-test safety, or judge whether a change is tested at the right layer.
---

Audit tests against the current repository testing guidance. Passing tests are
not enough; judge whether the suite proves behavior clearly, deterministically,
and at the right altitude.

## Procedure

1. Define mode from the request. For a change audit, inspect changed source and
   tests. For a full audit, enumerate the suite scope.
2. Run the configured test command when needed to verify current state.
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
  external processes.
- Determinism: tests avoid sleeps, wall-clock races, shared mutable state, and
  order dependence.
- Parallel safety: tests can run concurrently without shared filesystem,
  environment, port, process, or global-state collisions.
- Maintainability: repeated scenarios are data-driven or fixture-backed when
  repetition would hide intent.
- Spec traceability: when the repository defines a human-readable requirements
  spec, e2e/acceptance tests declare the requirement ids they prove and
  orphans fail in both directions; when e2e tests exist with no spec scheme,
  recommend one as a finding. Unit tests stay exempt — their names are their
  spec.
- Failure clarity: assertion messages, test names, and fixtures make the broken
  behavior easy to identify.

## Output

Return findings grouped by check:

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
