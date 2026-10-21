# Depth lens

Judge each module by what a caller must learn (invariants, ordering, errors,
configuration, performance) against the behaviour it gives. A deep module has a
small interface over much behaviour; a shallow one costs nearly as much to
learn as it does. Do not score it as a line ratio. Hand-offs: architecture.md
(Lens 2, seam count). Per suspect module:

- **Deletion test.** Imagine it removed: complexity that vanishes means a
  pass-through; complexity that reappears across its callers means it
  earned its place.
- **Test surface.** Tests should need only the interface; tests that reach
  past it, or need heavy arrangement, show the wrong shape. For each
  production entry point, check whether tests drive it or a test-only
  sibling (a function with no production caller, a copy of a worker script, a
  fake that re-implements a production step); report the shipped path as
  unproven and name the real adapter the tests should move onto.
- **Seam count.** One adapter behind a port is a hypothetical seam; two
  real ones make a seam (architecture.md Lens 2 counts them).
- **Enforcement.** When an interface carries an ordering or "callers must
  not" rule only in a docstring or an assert, look for a caller that
  already breaks it (a flush defeats a dirty-session assert). A broken
  rule goes on the defects list.

Findings that reshape an interface are `needs plan review`. Concepts after
mattpocock/skills, `engineering/codebase-design` and
`engineering/improve-codebase-architecture`
(https://github.com/mattpocock/skills, MIT licence).
