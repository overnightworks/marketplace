# Tests lens

Audit tests against the code policy's "Tests" section (guidance lookup in
`SKILL.md`) and the repository's `AGENTS.md` or `CLAUDE.md` test facts. Judge
whether the suite proves behavior clearly, deterministically and at the right
altitude; passing is not enough.

Hand-offs: depth.md (Test size shape check), deadweight.md.

## Procedure

1. Mode: a change audit inspects changed source and tests; a full audit
   enumerates the suite scope; a named test file is audited against the source
   it covers.
2. Find the test command in `README.md`, `AGENTS.md` or `.github/workflows/`
   and run only the tests covering the scope when current state matters; with
   no documented command, judge from source and say so.
3. Cross-reference source behavior against tests; prefer behavior contracts
   over line-count reasoning.

## Checklist

The code policy owns the rules; each line is what this audit adds.

- Suite shape: before judging single tests, name the suite's layers, what each
  proves, and where a mock stands in for a boundary that a fake or the real
  dependency would prove more cheaply. When the shape makes every behaviour
  expensive (for example, call-count assertions as the main proof), report one
  target-shape finding instead of one finding per test.
- Behavior coverage: every new or changed behavior has a test or an explicit,
  justified reason it cannot. Code with no production caller is not a
  coverage finding; hand it to `deadweight.md` (frozen or dead). A gap on a
  branch that cannot occur under the trust model or the types is a deletion,
  not a missing test: hand it to `deadweight.md` as a cut.
- Right altitude and assertions: pure logic is tested directly; integration
  paths use real entry points without reimplementing production flow; tests
  assert user-visible output, state, errors or contracts, not private details.
- Dependency control: a test in a unit file that needs a live dependency is a
  finding: it belongs in the integration suite (or a separate marker or
  directory where there is no integration split).
- Determinism: no sleeps, wall-clock races, shared mutable state or order
  dependence.
- Parallel safety: tests run concurrently without shared filesystem,
  environment, port, process or global-state collisions; judge it from the
  source (fixed paths, ports, environment writes, module-level state) when no
  parallel run command is documented.
- Maintainability: repeated scenarios are data-driven or fixture-backed when
  repetition would hide intent; a builder a test file writes privately for a
  contract another test file already builds is a duplication finding.
- Spec traceability: when the repository defines a human-readable requirements
  spec, e2e/acceptance tests declare the requirement ids they prove and
  orphans fail in both directions; e2e tests with no spec scheme get a
  recommendation as a finding. Unit tests stay exempt.
- Failure clarity: assertion messages, test names and fixtures make the broken
  behavior easy to identify.

## Test size

One owner for judging whether tests are too large:

- Shape: when tests need heavy arrangement, or test:src rises well above its
  history, run the `depth.md` lens on the module under test; test explosion is
  usually a shallow-module symptom.
- Ballast: a module whose test-to-production line ratio is more than twice the
  median ratio of the repository's modules, without behavioral justification.
  Pair module and test by name (`x.py` with `test_x.py`); list the unpaired
  files and leave them out of the median. Near-duplicate test parametrization
  is a quality finding here. A case that runs today's code path again is
  ballast only when it pins no stated behaviour (its name, docstring or a
  requirement) that a plausible regression would break.
- Cuts: a test that proves a ruled sentence, a spec criterion or a defect
  reference is never cut for length alone; it may merge into a table-driven
  test that proves the same. Judge lines per proven behaviour, not in total: a
  cut that deletes a behaviour's only proof is a loss, not a saving.
