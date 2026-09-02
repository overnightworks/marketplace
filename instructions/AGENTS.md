# Testing Conventions

How I want tests written. These extend the coding conventions — test code is
code, held to the same bar — and they decide whether a change is "done."

## Behaviour and evidence

- Approved requirements and product contracts own intended behaviour. Tests are
  executable verification and evidence: keep them synchronized with that
  contract; never make them an independent product-decision source. Each test
  pins one observable behaviour, and its name states that behaviour ("merges a
  clean branch into main", not "test_merge_3").
- Test what the unit *does* as seen from outside — its return value, its effect
  on state, the error it raises — never how it does it.
- Assert outcomes, not internals. No reaching into private fields, no asserting
  mock call counts or order where a state/output assertion would do, unless the
  interaction or order is itself a public or protocol contract; no pinning exact
  log strings or internal data shapes that aren't part of the contract. The
  litmus test: would this break on a refactor that preserves behaviour? If yes,
  it's testing the wrong thing.

## Cover behaviours, not lines

- The target is *every observable behaviour and meaningful edge case has a
  test* — not a line-coverage percentage. Untested behaviour is the real gap; a
  high line-coverage number with no behavioural assertions is worse than honest.
- A new behaviour is not done until a test pins it. A bug fix lands with the
  test that would have caught it.

## The right layer

- Drive flows through their real entry points against real state. Don't
  re-implement production logic inside the test to check it.
- Pure logic must be callable and testable directly — with no live external
  process, service, or network. If a test has to spawn a real process or hit a
  real service to exercise logic, the code is at the wrong layer: refactor it to
  be callable, then test that. Reserve real-dependency tests for a thin,
  clearly-separated integration layer.
- Tests are fast and deterministic: no flakiness, no sleeps or timing races, no
  order dependence, no mutable state leaking between tests.

## No test explosion

- Test code follows the same conventions as source: clean, DRY,
  intention-revealing names, no copy-paste. Review it to the same standard.
- Factor shared arrangement into fixtures and builders. For a family of cases
  that differ only in data, use one parametrized / table-driven test, not N
  near-identical copies.
- Watch the *per-behaviour cost*, not a fixed ratio. A suite that balloons to
  several times the size of the code it covers is a smell — almost always
  duplication that should be parametrized or pulled into a fixture. Compact,
  reusable setup is what keeps near-complete behavioural coverage affordable.
