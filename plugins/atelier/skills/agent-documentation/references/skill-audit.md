# Skill audit pass

Reader: an agent auditing one installed skill (a `SKILL.md` and its files).
Sources, read 18.10.2026:
- S1: https://code.claude.com/docs/en/skills.md
- S2: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md
- S3: https://code.claude.com/docs/en/plugin-evals.md
- S4: the installed skill-creator, `~/.claude/skills/**/skill-creator`

## Procedure

1. Run `python3 scripts/check_skills.py` from the root of the checkout being
   audited. It owns the machine-checkable rules (frontmatter, name,
   description length, body size, linked files) and prints only pass/fail.
   Any failure is a finding; do not re-check those rules by hand. Default
   when the script is absent: apply the S1/S2 frontmatter, name, description
   and body-size limits by hand.
2. Read the skill, then apply the rules below in addition to
   agent-documentation's own `SKILL.md` Checklist, without repeating its Token
   economy and Clarity items. Each finding names its evidence type: `static`,
   `usage`, `procedure-round` or `eval`.
3. Run the overlap, usage and benefit checks below.
4. Collect the Gaps from misses.
5. Return one distributor issue for the run (see Output).

## Judgement rules

Each rule is a finding when the skill breaks it. All evidence type `static`
unless stated.

- Description: says what the skill does and when to use it, with concrete
  trigger phrases, the key use first. Cadence rules, product names and
  history do not belong in it (S1, S2).
- Concise body: only what Claude lacks. A paragraph Claude would produce
  without the skill is a finding (S2).
- Degrees of freedom: a fragile, order-dependent task gets exact steps or a
  command; an open task gets direction, not a script (S2).
- No time-sensitive text: no "before <date>", "currently", version-bound
  claims. Dated history belongs in a decision record (S2).
- Consistent terminology: one term per concept across the skill and its
  linked files (S2).
- Works on Haiku, Sonnet and Opus: a step that only a stronger model can
  follow unaided needs more explicit wording (S2).
- Side effects: a skill that commits, pushes, deploys, deletes or posts sets
  `disable-model-invocation` so only a person starts it (S1).
- Pointers (lookup rule): every pointer to another file, document, command or
  workflow names its concrete source (`AGENTS.md`, a CI workflow, the README,
  the contract) or a lookup rule, and states a default for when that source is
  absent. "See the usual docs" and "run the checks" are findings (S1, S2).
  This file follows the same rule.

## Overlap

Compare the skill's description with every other installed skill's
description. When auditing a repository, take them from its
`plugins/*/skills/*/SKILL.md` files (the listing the session shows may be an
older installed copy); use the listing only when no checkout is present. A
colliding skill that exists only in the session's skill listing (installed,
not in the repository) has its listing text as the source.
Name each collision as a pair plus the trigger phrase both match, and the
owner that should keep it. Evidence: `static`.

## Usage

Data source: `/skill-doctor` (needs Claude Code v2.1.252 or later per S1,
terminal session only, unavailable over Remote Control); when it is
unavailable, count the `"name":"Skill"` tool uses per `"skill":"<plugin>:<name>"`
or bare `"skill":"<name>"` in `~/.claude/projects/**/*.jsonl` (default: report
`usage` as `UNKNOWN` and name the source tried). A skill nobody invokes is a
retire-or-fix-trigger candidate, never deleted automatically. Evidence:
`usage`.

## Benefit over no skill

Does the skill beat the no-skill baseline (S1-S3)?
- Every skill: a Haiku follow-the-procedure round. A fresh Haiku agent gets
  the skill and one concrete task and runs it (take the task from the skill's
  own "Use when" trigger and state it in the report; if the trigger names
  none, say so); every point where it guessed or asked is a finding.
  Evidence: `procedure-round`.
- High-use or high-risk skills only (high-use: in the top quarter of the
  plugin's skills by the Usage count, never when `usage` is `UNKNOWN`;
  high-risk: it writes, lands, or decides scope): a trigger and outcome eval
  on Sonnet, with the skill-creator loop (S4) or `claude plugin eval` (S3).
  Cost as read 18.10.2026: a toy case about $0.41 at 3 runs per arm (S3), the
  skill-creator loop about 360 `claude -p` calls per skill (S4). Default when
  skill-creator is not installed: run only the Haiku round. Evidence: `eval`.
- Default when no budget is named: Haiku round for all, evals for none.

## Gaps

Missing rules or checks come from misses: findings a later stage caught after
an earlier review approved (the escalation and re-measurement lines in the
item journals, per the head contract's "Model routing": `instructions/HEAD.md`
in the marketplace repository, else `HEAD.md` beside the installed contract
`~/.claude/CLAUDE.md`;
default when neither exists: the reviews and CI failures of the last landed
lanes).
Do not propose a check from imagination.

## Output

One distributor issue per audit run, holding the numbered findings, each with
skill, rule, evidence type and evidence. Write each finding as a `FINDING`
line in the format of agent-documentation's own `SKILL.md` Output, with
severity from the global contract's classification (`~/.claude/CLAUDE.md`):
`blocking` is a defect against the skill's contract or a repository rule, or
anything touching data safety, security, secrets, a public contract or a
failing check; `follow-up` is polish with no behavioural effect, or work
outside the audited skill's scope. Default when no contract is installed: the same
two classes with that definition. A finding becomes its own item only when it
is dispatched. Write the body per the `aco` skill. Defaults when aco is not
installed: the repository's issue template; in a dry run, the FINDING lines
under a one-line header.
