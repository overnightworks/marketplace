# Tests lens

Audit tests against the code policy's "Tests" section (see the guidance lookup
in `SKILL.md`) and the repository's `AGENTS.md` or `CLAUDE.md` for its test
facts, else the conventions the suite itself follows. Passing tests are not
enough; judge whether the suite proves behavior clearly, deterministically, and
at the right altitude.

## Procedure

1. Define mode from the request. For a change audit, inspect changed source
   and tests. For a full audit, enumerate the suite scope. For a named test
   file, audit that file against the source it covers.
2. Find the test command in `README.md`, `AGENTS.md`, or `.github/workflows/`
   and run only the tests that cover the scope when current state matters;
   when no command is documented, judge from source and say so.
3. Cross-reference source behavior against tests. Prefer behavior contracts
   over line-count reasoning.

## Checklist

The code policy owns the rules; each line below is what this audit adds.

- Behavior coverage: every new or changed behavior has a test or an explicit,
  justified reason it cannot.
- Right altitude: pure logic is tested directly; integration paths use real
  entry points without reimplementing production flow in the test.
- Observable assertions: tests assert user-visible output, state, errors, or
  contracts instead of private implementation details.
- Dependency control: a test in a unit file that needs a live dependency is a
  finding: it belongs in the integration suite (or a separate marker or
  directory where the repository has no integration split).
- Determinism: no sleeps, wall-clock races, shared mutable state, or order
  dependence.
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

## Test size

One owner for judging whether tests are too large:

- Shape: when tests need heavy arrangement, or test:src rises well above its
  history, run the `depth.md` lens on the module under test; test explosion is
  usually a shallow-module symptom.
- Ballast: a module whose test-to-production line ratio is more than twice the
  median ratio of the repository's modules, without behavioral justification.
  Pair module and test by name (`x.py` with `test_x.py`); list the files left
  unpaired and leave them out of the median. Near-duplicate test
  parametrization is a quality finding here.
- Cuts: a test that proves a ruled sentence, a spec criterion or a defect
  reference is never cut for length alone; it may merge into a table-driven
  test that proves the same. Judge lines per proven behaviour, not in total: a
  cut that deletes a behaviour's only proof is a loss, not a saving.

## Severity examples

`HIGH` for missing behavior coverage, live dependencies in pure tests, or
known flakiness. `MEDIUM` for brittle coupling, unsafe parallelism, or unclear
duplicated tests. `LOW` for localized polish.
