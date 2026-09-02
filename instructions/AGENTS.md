# Coding Conventions

My standing rules for any code you write for me. They are not suggestions —
treat a violation as a defect to fix before you call the work done.

## Mindset

- Clean, maintainable architecture is the goal. Speed of delivery is not — take
  the time to get the structure right.
- Before writing a new line, look for what already exists. Can a current method
  be reused, or improved to cover this case? Prefer extending well-named
  existing code over adding parallel code that does almost the same thing.
- Don't reinvent the wheel. If a well-maintained library already solves the
  problem, use it — but vet it first: a dependency is a liability too (its
  maintenance, security, and size become yours).
- Don't overengineer. Build for today's real requirement, not an imagined one.
  At the same time, leave clean seams where future extension is genuinely
  likely — the test is "would this be hard to change later?", not "might we
  need it?".

## How the code should read

- Code reads like prose. A reader should follow intent without effort.
- Names carry the meaning: intention-revealing names for variables, functions,
  and types make most comments unnecessary.
- No comment should be needed to explain *what* the code does — if one is, the
  code is wrong, so rewrite it. Reserve comments for *why*: a non-obvious
  trade-off, a workaround, a rationale that the code itself cannot show.
- Small, single-purpose functions and modules. One responsibility each. If you
  can't name it in a few words, it's doing too much — split it.

## Configuration and data

- Put external, environment-, or operator-varying values in configuration.
  Stable implementation invariants may be named constants next to their owner;
  never scatter magic numbers, paths, thresholds, URLs, or limits.
- Model the domain with the type system: enums over loose strings, structured
  types (dataclasses / records) over bare dicts, real path types over strings.
  Make illegal states unrepresentable.
- Prefer immutable data and pure functions where practical; isolate side
  effects.

## Robustness

- Fail loud. No silent catches that swallow errors — surface them or handle them
  deliberately. Don't paper over a problem to keep going.
- Validate at the real boundaries (user input, external systems, config, network)
  and trust your own internal interfaces — don't defensively re-check states
  that can't occur.
- Every behavioral change ships with a test that asserts observable behavior,
  not internal mechanics.

## After writing

- Re-read every line against these rules before you consider it done. This
  self-review is mandatory, not optional.
- Follow the surrounding code's conventions when they're sound — consistency
  matters more than personal style. But don't adapt to bad code: if the
  neighbors are a mess, don't copy the mess to blend in. Raise the bar — match
  the standard these rules describe, and leave what you touch better than you
  found it.
- Keep changes small and reviewable. Delete dead code and leftover scaffolding;
  no backwards-compatibility cruft or "for the future" parameters.
