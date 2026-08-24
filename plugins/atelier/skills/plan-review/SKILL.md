---
name: plan-review
description: Review implementation plans before coding. Use when asked to vet a plan for clarity, scope, acceptance criteria, dependencies, contradictions, or implementability.
---

Review one named plan or design artifact. Judge whether an implementation agent
could execute it without inventing missing decisions.

## Procedure

1. Require a plan path or explicit plan text.
2. Read repository guidance that constrains the plan.
3. Check the plan against the checklist below.
4. Return a verdict; do not edit unless explicitly asked.

## Checklist

- Intent: one coherent goal and a clear done state.
- Scope: one plan covers one coherent change, not several independent features.
- Acceptance criteria: each criterion is objective and verifiable.
- Specificity: vague words do not hide decisions an implementer must make.
- Dependencies: referenced files, APIs, decisions, or prior work exist.
- Architecture fit: the plan respects current boundaries or explicitly proposes
  a justified boundary change.
- Reuse before invent: every new owner the plan creates (enum member, field,
  module, format, mechanism) is justified against a search for an existing one.
  An existing contract or ADR that already owns the concept means reuse or
  extend it, not add a parallel one; a new boundary needs a stated reason no
  existing owner can honestly hold it. Flag the same concept (status, token,
  capability, link) modeled twice, not only duplicated guidance.
- Standards and libraries: prefer an existing standard or maintained library
  over a hand-rolled equivalent unless a named reason rejects it.
- Provider neutrality: provider-specific detail (flags, file formats, launch
  mechanics) lives behind the adapter boundary; the concept and contract layer
  stays neutral. Flag any provider baked into the neutral contract layer.
- Verification: tests, static checks, manual checks, or review gates prove the
  requested behavior.
- Deletion/simplification: the plan names what can be removed or simplified when
  the work lands.

## Verdict

End with exactly one block:

```text
VERDICT: PASS
REASON: <one line>
```

```text
VERDICT: REVISE
REASON: <one line>
DEMANDS:
- <specific required change>
```

```text
VERDICT: KILL
REASON: <one paragraph>
```

Use `PASS` only when the plan is ready to implement. Use `REVISE` for concrete
fixable gaps. Use `KILL` when the intent, approach, or architecture is wrong.
