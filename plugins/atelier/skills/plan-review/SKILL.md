---
name: plan-review
description: Review implementation plans before coding. Use when asked to vet a plan for clarity, scope, acceptance criteria, dependencies, contradictions, or implementability.
---

Review one named plan or design artifact. Judge whether an implementation agent
could execute it without inventing missing decisions.

## Procedure

1. Require the plan as a file path, pasted text, or an issue body
   (`gh issue view <n> --json body --jq .body`).
2. Read the guidance that constrains the plan: the global contract's code policy
   (`~/.claude/CLAUDE.md`, or `~/.codex/AGENTS.md` for Codex), and the
   repository's `AGENTS.md` and `CLAUDE.md` for its facts.
   Skip a file that does not exist and say so.
3. Check the plan against the checklist below.
4. Return a verdict; do not edit unless explicitly asked.

A plan that is a container (roadmap, epic, slice table) is judged on its next
slice only; list later slices as out of review.

## Checklist

- Intent: one coherent goal and a clear done state.
- Scope: one plan covers one coherent change, not several independent features.
- Acceptance criteria: each criterion is objective and verifiable.
- Specificity: vague words do not hide decisions an implementer must make.
- Dependencies: referenced files, APIs, decisions, or prior work exist. Verify
  with `git grep`/`git ls-files` for files and symbols, `gh issue view <n>` or
  `gh pr view <n>` for items and pull requests; name any you could not check.
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
- Value: the body answers the pull question of the user-level contract (worth
  its lifetime cost, no other layer or tool covers it better, not an
  architecture symptom); a plan that drives a component past its declared
  sentences toward completeness is REVISE.
- Provider neutrality: provider-specific detail (flags, file formats, launch
  mechanics) lives behind the adapter boundary; the concept and contract layer
  stays neutral. Flag any provider baked into the neutral contract layer.
- Verification: tests, static checks, manual checks, or review gates prove the
  requested behavior. For a material-risk plan (as the user-level contract
  defines it; if none exists, say so and judge it as a public contract,
  persistent data, secrets, money, security, or irreversibility), the first gate needs a scenario matrix built from the plan's ruled
  sentences (see "Scenario matrix" in the explorative-testing skill) — flag
  its absence as a gap.
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
