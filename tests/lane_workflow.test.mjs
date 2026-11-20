// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runLane, partReplaced, courierBriefOf, resumedLane, APPROVE, PASS, resumeFixedTip, greenCi, finding, webauthTips, webauthReplay, agentProvidersReplay, answersWith, resumeTip, olderTip, tidy, defectWithoutDraft, resumeFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, secondFix, mergedOnlyTip, conflictsWithMain, mergeOnlyFix, delegatedLineOfContract } from './lane_workflow_harness.mjs'

const misspelledChoices = [
  ['risk', 'Material'], ['risk', 'MATERIAL'], ['risk', 'high'],
  ['reviewer', 'Codex'], ['reviewer', 'terra'],
]

for (const [name, value] of misspelledChoices) {
  test(`refuses ${name} ${JSON.stringify(value)} before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, [name]: value })
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'input')
    assert.deepEqual(launchedAgents, [])
  })
}

const malformedEntries = [
  ['fixFirst', [defectWithoutDraft, 'src/a.py:3 breaks the rule'], /fixFirst\[1\] is not an object/],
  ['fixFirst', [{ ...defectWithoutDraft, evidence: undefined }], /fixFirst\[0\] lacks evidence/],
  ['fixFirst', 'src/a.py:3', /fixFirst must be a list/],
  ['foldIn', [tidy, { where: 'x.py:2', text: 'rename it' }], /foldIn\[1\] lacks owner/],
  ['foldIn', ['x.py:2 rename it'], /foldIn\[0\] is not an object/],
]

for (const [name, entries, reason] of malformedEntries) {
  test(`refuses ${name} ${JSON.stringify(entries).slice(0, 40)} at input naming the entry before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, [name]: entries })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, reason)
    assert.deepEqual(launchedAgents, [])
  })
}

const refusedItems = ['fix/sonar-s1110', '12; id', '0', '-3', '1.5']

for (const item of refusedItems) {
  test(`refuses the item ${JSON.stringify(item)} that is not an issue number before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, item })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /only issue items.*by hand/)
    assert.deepEqual(launchedAgents, [])
  })
}

const refusedRoutings = [
  ['an unknown role', { janitor: { effort: 'low' } }],
  ['an unknown model', { build: { model: 'gpt-5.6-terra' } }],
  ['an effort beyond the efforts', { fix: { effort: 'xhigh' } }],
  ['opus above its medium cap', { review: { model: 'opus', effort: 'high' } }],
  ['opus kept at the high effort a role defaults to', { build: { model: 'opus' } }],
  ['the dropped model fable', { review: { model: 'fable', effort: 'medium' } }],
  ['a Codex rework', { rework: { model: 'gpt-6-astra' } }],
  ['a Claude review model for a Codex reviewer', { review: { model: 'sonnet' }, __reviewer: 'codex' }],
  ['a Codex builder', { build: { model: 'gpt-6-astra' } }],
  ['an inherited property name as the gate model', { gate: { model: 'constructor' } }],
  ['a non-string model', { build: { model: ['sonnet'] } }],
  ['an inherited property name as the role', { constructor: { effort: 'low' } }],
]

for (const [what, routing] of refusedRoutings) {
  test(`AC-routing-refusal: refuses a routing override with ${what} before any agent starts`, async () => {
    const { __reviewer, ...overrides } = routing
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk: 'material', reviewer: __reviewer, routing: overrides })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

const refusedClaudeGates = [
  ['opus at medium', { model: 'opus', effort: 'medium' }],
  ['opus at low', { model: 'opus', effort: 'low' }],
  ['sonnet at its default effort', { model: 'sonnet' }],
  ['sonnet at high', { model: 'sonnet', effort: 'high' }],
  ['haiku at high', { model: 'haiku', effort: 'high' }],
]

for (const [what, gate] of refusedClaudeGates) {
  test(`AC-gate-standin-refusal: refuses a gate on ${what} at input, naming the one Opus stand-in`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk: 'material', routing: { gate } })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /stand-in.*opus.*high/)
    assert.deepEqual(launchedAgents, [])
  })
}

test('AC-gate-standin-refusal: opus above medium stays refused for every other role', async () => {
  const { result } = await runLane({ ...resumedLane, risk: 'material', routing: { gate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'high' } } })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.match(result.reason, /build.*opus.*capped at medium/)
})

const defaultRoutingByRole = [
  ['sync', 'haiku', 'low'],
]

for (const [label, model, effort] of defaultRoutingByRole) {
  test(`AC-default-routing: ${label} runs on ${model} at ${effort} effort by default`, async () => {
    const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
    assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], [model, effort])
  })
}

const reviewRoutingByRisk = [
  ['normal', 'claude', 'sonnet', 'high'], ['material', 'claude', 'opus', 'medium'],
  ['normal', 'codex', 'gpt-6-astra', 'medium'], ['material', 'codex', 'gpt-6-astra', 'high'],
]

for (const [risk, reviewer, model, effort] of reviewRoutingByRisk) {
  test(`AC-review-by-risk: a ${risk} lane's ${reviewer} review runs on ${model} at ${effort} effort by default`, async () => {
    const { agentCalls, result } = await runLane({ ...resumedLane, risk, reviewer })
    assert.deepEqual(result.routing.review, { model, effort })
    const call = agentCalls['r0-review']
    const ran = reviewer === 'codex' ? call.prompt.match(/-m (\S+) -c model_reasoning_effort=(\w+)/).slice(1) : [call.options.model, call.options.effort]
    assert.deepEqual(ran, [model, effort])
  })
}

const writerRoutingByRisk = [
  ['normal', { build: ['sonnet', 'medium'], 'fix-1': ['sonnet', 'medium'], 'e2e-0': ['sonnet', 'medium'] }],
  ['material', { build: ['sonnet', 'high'], 'fix-1': ['sonnet', 'high'], 'e2e-0': ['sonnet', 'high'] }],
]

for (const [risk, expected] of writerRoutingByRisk) {
  test(`AC-default-routing: a ${risk} lane's build, fix and test agents run on ${JSON.stringify(expected)}`, async () => {
    const { agentCalls } = await runLane({ ...webauthReplay.args, build: 'b', risk }, answersWith(webauthReplay, { kind: 'test-gap', mutation: true }))
    for (const [label, modelAndEffort] of Object.entries(expected)) {
      assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], modelAndEffort, label)
    }
  })
}

test('AC-gate-separation: a Claude builder gets the Codex gpt-6-astra gate at high effort', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  const gatePrompt = agentCalls['r0-gate'].prompt
  assert.match(gatePrompt, /-m gpt-6-astra -c model_reasoning_effort=high/)
  assert.doesNotMatch(gatePrompt, /terra|sol/i)
})

const standInGate = { gate: { model: 'opus', effort: 'high' } }

const standInRoutings = [
  ['opus at high', { model: 'opus', effort: 'high' }],
  ['opus without an effort', { model: 'opus' }],
]

for (const [what, gate] of standInRoutings) {
  test(`AC-gate-standin: a gate on ${what} on a material lane runs as a fresh Claude reviewer beside the first review, with no courier`, async () => {
    const { agentCalls, launchedAgents, result } = await runLane({ ...resumeArgs, risk: 'material', routing: { gate } }, { 'r0-review': APPROVE, 'r0-gate': APPROVE, 'e2e-0': reachesTheEnd['e2e-0'], 'ci-0': reachesTheEnd['ci-0'] })
    const call = agentCalls['r0-gate']
    assert.deepEqual([call.options.agentType, call.options.model, call.options.effort], [agentCalls['r0-review'].options.agentType, 'opus', 'high'])
    assert.match(call.prompt, /final gate \(architecture, data safety, public contract\)/)
    assert.doesNotMatch(call.prompt, /codex exec|courier/)
    assert.deepEqual(launchedAgents.filter(label => label.startsWith('r0-')), ['r0-review', 'r0-gate'])
    assert.deepEqual(result.routing.gate, { model: 'opus', effort: 'high' })
    assert.equal(result.status, 'ready-to-land')
    assert.equal(result.requiredHeadActions.filter(action => /stand-in/.test(action)).length, 1)
    assert.match(result.routingLine, laneRecordLine)
  })
}

test('AC-gate-standin: a normal lane starts no gate even when routing.gate names the stand-in', async () => {
  const { launchedAgents, result } = await runLane({ ...resumeArgs, routing: standInGate }, { 'r0-review': APPROVE, 'e2e-0': reachesTheEnd['e2e-0'], 'ci-0': reachesTheEnd['ci-0'] })
  assert.ok(!launchedAgents.some(label => label.includes('gate')))
  assert.deepEqual(result.routing.gate, { model: 'opus', effort: 'high' })
  assert.ok(!result.requiredHeadActions.some(action => /stand-in/.test(action)))
})

test('AC-gate-standin: without the override the gate stays the Codex courier and the result shows it', async () => {
  const { agentCalls, result } = await runLane({ ...resumedLane, risk: 'material' })
  assert.deepEqual(agentCalls['r0-gate'].options.agentType, 'general-purpose')
  assert.deepEqual(result.routing.gate, { model: 'gpt-6-astra', effort: 'high' })
})

test('AC-gate-revise-kept: the courier brief returns a REVISE from a clean Codex exit unchanged and never as failed', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  assert.match(agentCalls['r0-gate'].prompt, /holds 0 and .* is valid JSON, return its verdict, blocking and followups UNCHANGED.*a REVISE with blocking findings is never failed/s)
})

test('AC-override: a routing override sets a role\'s model and effort within the model\'s cap', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, routing: { review: { model: 'opus', effort: 'medium' } } })
  assert.deepEqual([agentCalls['r0-review'].options.model, agentCalls['r0-review'].options.effort], ['opus', 'medium'])
})

test('AC-remeasure: every lane result records each role\'s model and effort and which stage found each blocking finding', async () => {
  const replay = webauthReplay
  const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
  assert.deepEqual(result.routing.gate, { model: 'gpt-6-astra', effort: 'high' })
  assert.deepEqual(result.routing.build, { model: 'sonnet', effort: 'high' })
  assert.deepEqual(result.routing.rework, { model: 'sonnet', effort: 'high' })
  assert.deepEqual(result.history.find(entry => entry.by === 'gate').blocking, ['src/webauth/oidc.py:315'])
})

test('AC-remeasure-test-and-ci: the e2e and CI history entries carry their blocking locations', async () => {
  const replay = webauthReplay
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['e2e-0'] = { verdict: 'FAIL', blocking: [finding('probe: login redirect', 'the redirect loses the state')], followups: [] }
  answers['ci-0'] = { head: webauthTips.secondFix, green: false, failing: [finding('ci: lint', 'ruff fails')] }
  const { result } = await runLane(replay.args, answers)
  assert.deepEqual(result.history.find(entry => entry.by === 'e2e-0').blocking, ['probe: login redirect'])
  assert.deepEqual(result.history.find(entry => entry.by === 'ci-0').blocking, ['ci: lint'])
})

test('AC-reviewer-stopgap: a reviewer brief carries the stopgap refusals and narrows test-gap to a behaviour without a test', async () => {
  const { agentCalls } = await runLane(resumedLane)
  const brief = agentCalls['r0-review'].prompt
  assert.match(brief, /800 lines or more/)
  assert.doesNotMatch(brief, /defect:#n/)
  assert.match(brief, /a new test whose name does not state the behaviour it pins/)
  assert.match(brief, /a behaviour has no test/)
  assert.match(brief, /Hygiene in test code .* is a \*\*defect\*\* whose proof is the diff, not a mutation; it carries no test draft/)
  assert.match(brief, /a test beside its real entry point \(a private reader or helper instead of the surface the contract names\) included, because that behaviour has no test at its boundary; its proof is a mutation, as for any test-gap/)
  assert.match(brief, /as the contract's section "Reviews" defines them/)
  assert.match(brief, /Reproduce a behaviour on origin\/main before calling it pre-existing/)
  assert.doesNotMatch(brief, /tripwire by operator ruling|when the change introduces a defect against/)
})

const firstReviewRoundByRisk = [
  [undefined, ['r0-review']],
  ['normal', ['r0-review']],
  ['material', ['r0-review', 'r0-gate']],
]

for (const [risk, reviewers] of firstReviewRoundByRisk) {
  test(`risk ${JSON.stringify(risk)} passes input and starts the reviews ${reviewers.join(' and ')}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk }, { 'r0-review': APPROVE, 'r0-gate': { ...APPROVE, codexExit: 0 } })
    assert.notEqual(result.stage, 'input')
    assert.deepEqual(launchedAgents.slice(0, 2 + reviewers.length), ['sync', 'scope-resume', ...reviewers])
  })
}

// Two recorded lane runs that stopped at a fix (journals wf_ef1e8c59-bcb and wf_a3d28910-a89), keyed by agent label.
// Tips, files, finding wheres, verdicts and proofs are copied as recorded; the prose of findings and follow-ups, and
// some follow-up wheres, are shortened.
// Each fixer proved an honest test-gap finding with a mutation it reported only in prose, so the guard stopped the run.

const gateRevise = agentProvidersReplay.answers['r0-gate']

const contradictoryCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 0, note: 'Verdict was REVISE, not failed' }

const emptyRevise = { verdict: 'REVISE', blocking: [], followups: [], codexExit: 0, reportPath: '/scratch/r0-gate-out.json' }

const courierAnswersByExit = [
  ['a REVISE with a clean Codex exit goes to a fixer', { ...gateRevise, codexExit: 0 }, undefined, ['ready-to-land', undefined], true, 0],
  ['a REVISE without a clean Codex exit stops the lane', { ...gateRevise, codexExit: 1 }, undefined, ['failed', 'review'], false, 0],
  ['a failed courier without a marker stops the lane', { verdict: 'failed', blocking: [], followups: [], codexExit: -1, note: 'no marker' }, undefined, ['failed', 'review'], false, 0],
  ['a failed courier with a clean exit is re-read once and the re-read REVISE goes to a fixer', contradictoryCourier, { ...gateRevise, codexExit: 0 }, ['ready-to-land', undefined], true, 1],
  ['a failed courier whose re-read returns a verdict without a clean exit stops the lane', contradictoryCourier, { ...gateRevise, codexExit: 1 }, ['failed', 'review'], false, 1],
  ['a failed courier with a clean exit whose re-read fails again stops the lane', contradictoryCourier, contradictoryCourier, ['failed', 'review'], false, 1],
  ['an empty REVISE with a clean exit is re-read once and the re-read REVISE with findings goes to a fixer', emptyRevise, { ...gateRevise, codexExit: 0 }, ['ready-to-land', undefined], true, 1],
  ['an empty REVISE followed by an empty REVISE stops the lane', emptyRevise, emptyRevise, ['failed', 'review'], false, 1],
  ['an empty REVISE without a clean exit gets no re-read', { ...emptyRevise, codexExit: 1 }, undefined, ['failed', 'review'], false, 0],
]

for (const [what, gateAnswer, rereadAnswer, outcome, reachesFixer, rereads] of courierAnswersByExit) {
  test(`AC-gate-revise-reaches-fixer: ${what}`, async () => {
    const answers = { ...agentProvidersReplay.answers, 'r0-gate': gateAnswer, ...(rereadAnswer && { 'r0-gate-reread': rereadAnswer }) }
    const { result, launchedAgents } = await runLane(agentProvidersReplay.args, answers)
    assert.deepEqual([result.status, result.stage], outcome)
    assert.equal(launchedAgents.includes('fix-1'), reachesFixer)
    assert.equal(launchedAgents.filter(label => label.startsWith('r0-gate-reread')).length, rereads)
  })
}

test('an empty REVISE that stays empty after the re-read fails naming the report path', async () => {
  const answers = { ...agentProvidersReplay.answers, 'r0-gate': emptyRevise, 'r0-gate-reread': emptyRevise }
  const { result } = await runLane(agentProvidersReplay.args, answers)
  assert.match(result.reason, /without any blocking finding/)
  assert.ok(result.reason.includes(emptyRevise.reportPath))
})

test('AC-courier-final-action: the courier and its re-read name StructuredOutput as their only final action', async () => {
  const { agentCalls } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'r0-gate': contradictoryCourier, 'r0-gate-reread': { ...gateRevise, codexExit: 0 } })
  const copySentenceByLabel = { 'r0-gate': /verbatim from the out\.json into the StructuredOutput call/, 'r0-gate-reread': /verbatim into the StructuredOutput call/ }
  for (const [label, copySentence] of Object.entries(copySentenceByLabel)) {
    assert.match(agentCalls[label].prompt, copySentence, label)
    assert.match(agentCalls[label].prompt, /only final action is the StructuredOutput call; never write a text answer first/, label)
  }
})

test('delegated-line: every agent prompt the lane starts opens with the delegated line', async () => {
  const line = delegatedLineOfContract()
  const answers = { ...agentProvidersReplay.answers, 'r0-gate': contradictoryCourier, 'r0-gate-reread': { ...gateRevise, codexExit: 0 } }
  const unreadableSync = await runLane(resumedLane, { sync: { printed: '{"crc":"pending","v":"pending"}' }, 'sync-reread': {} })
  assert.ok(unreadableSync.launchedAgents.includes('sync-reread'))
  const { launchedAgents, launchedPrompts: laneAgentPrompts, agentCalls } = await runLane(agentProvidersReplay.args, answers)
  const launchedPrompts = [...unreadableSync.launchedPrompts, ...laneAgentPrompts]
  for (const label of ['build', 'r0-review', 'r0-gate', 'r0-gate-reread', 'fix-1', 'e2e-0', 'ci-0']) assert.ok(launchedAgents.includes(label), label)
  for (const prompt of launchedPrompts) assert.ok(prompt.startsWith(`${line}\n`), prompt.slice(0, 120))
  assert.equal(courierBriefOf(agentCalls['r0-gate'].prompt).brief.split('\n')[0], line)
})

// The recorded answers as a reviewer and fixer briefed with finding kinds would give them: the test-gap finding
// carries the kind its reviewer gives it, and its proof the mutation its fixer reported. The other options vary
// that proof: whether it passes after the fix, whether it names the finding's where exactly, a near match of it,
// or is left out, and whether the fixer adds a failing proof for a where no blocking finding has (its fold-in's).

const reachesToCi = { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, ...reachesTheEnd }

const jobLogCommandByRepo = [
  { repo: undefined, command: "cd '/w' && gh run view <run-id> --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200" },
  { repo: 'o/r', command: "gh run view <run-id> -R o/r --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200" },
]

for (const { repo, command } of jobLogCommandByRepo) {
  test(`the CI agent reads each red job's own log up to its first error line (${repo ?? 'worktree repository'})`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, repo, foldIn: [tidy] }, reachesToCi)
    const brief = agentCalls['ci-0'].prompt
    assert.ok(brief.includes(command), brief)
    assert.match(brief, /--json name,state,bucket,link/)
  })
}

const ciBriefClauses = [
  { duty: 'a check whose link is not an Actions job has no log command', clause: /not an Actions job link/ },
  { duty: 'listed findings become one entry each', clause: /one failing entry per listed finding/ },
  { duty: 'a plain red check stays one entry', clause: /without such a list stays one entry/ },
  { duty: 'the log line prefix stays out of the evidence', clause: /UNKNOWN STEP/ },
  { duty: 'a Fix line is not a finding', clause: /`Fix:` line belongs to the finding above/ },
  { duty: 'a log without an error line is reported as such', clause: /log held no error line/ },
  { duty: 'a derived red check is left out', clause: /derived: leave it out/ },
]

for (const { duty, clause } of ciBriefClauses) {
  test(`the CI brief covers it: ${duty}`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, reachesToCi)
    assert.match(agentCalls['ci-0'].prompt, clause)
  })
}

test('two Sonar findings listed by the CI agent reach the fixer as two findings, each with its where and rule', async () => {
  const sonar = (where, rule) => ({ where, kind: 'defect', text: 'Refactor this exception test', rule, evidence: `sonar ${where} - ${rule}: Refactor this exception test` })
  const failing = [sonar('tests/test_edge_apply.py:498', 'python:S5778'), sonar('tests/test_step_ca_init.py:685', 'python:S5779')]
  const answers = { ...reachesToCi, 'ci-0': { head: resumeTip, green: false, failing }, 'fix-2': resumeFix }
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, answers)
  const fixerBrief = agentCalls['fix-2'].prompt
  for (const { where, rule } of failing) {
    assert.ok(fixerBrief.includes(where), fixerBrief)
    assert.ok(fixerBrief.includes(rule), fixerBrief)
  }
})

const wholeLaneRounds = [
  ['every fold-in satisfied at an unchanged tip', { foldIn: [tidy] }, { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] } }],
  ['fixFirst', { fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] } }],
  ['foldIn only', { foldIn: [tidy] }, { 'fix-1': resumeFix }],
  ['a merge-only fix', { fixFirst: [conflictsWithMain] }, { 'fix-1': mergeOnlyFix, 'ci-0': greenCi(mergedOnlyTip) }],
]

for (const [what, args, answers] of wholeLaneRounds) {
  for (const [risk, deltaFrom] of [['normal'], ['material'], ['normal', olderTip], ['material', olderTip], ['normal', resumeTip], ['material', resumeTip], ['normal', resumeTip.slice(0, 7)], ['material', resumeTip.slice(0, 7)]]) {
    const gated = risk === 'material'
    const diffCommand = deltaFrom ? `git diff ${deltaFrom}..HEAD` : 'git diff origin/main...HEAD'
    test(`resume round (${risk}, ${what}${deltaFrom ? ', deltaFrom' : ''}) reviews ${gated ? 'and gates ' : ''}on ${diffCommand}`, async () => {
      const gateAnswer = { 'r1-gate': { ...APPROVE, codexExit: 0 } }
      const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, ...args, risk, deltaFrom }, { ...gateAnswer, ...reachesTheEnd, ...answers })
      for (const label of gated ? ['r1-review', 'r1-gate'] : ['r1-review']) assert.ok(agentCalls[label].prompt.includes(diffCommand), `${label} in ${launchedAgents.join(',')}`)
      assert.equal(launchedAgents.includes('r1-gate'), gated)
      if (args.foldIn) assert.match(agentCalls['r1-review'].prompt, /tidy the import order/)
      if (args.fixFirst?.includes(defectWithoutDraft)) assert.equal(agentCalls['r1-review'].prompt.split(defectWithoutDraft.text).length - 1, 1)
    })
  }
}

test('a REVISE in the whole-lane round has the raiser re-check only the fixer delta', async () => {
  const revise = { verdict: 'REVISE', blocking: [{ ...finding('y.py:2', 'a defect'), kind: 'docs' }], followups: [] }
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': revise, 'fix-2': secondFix, 'r2-review': APPROVE })
  assert.match(agentCalls['r2-review'].prompt, /only this delta, the fixer's own commits: git log -p --first-parent --remerge-diff/)
  assert.ok(!agentCalls['r2-review'].prompt.includes('git diff origin/main...HEAD'))
})

test('the e2e tester builds its environment in the lane worktree, removes its playground and keeps its evidence; no text says scratch is deleted', async () => {
  const { agentCalls } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'e2e-0': null, 'e2e-0-fallback': agentProvidersReplay.answers['e2e-0'] })
  for (const label of ['e2e-0', 'e2e-0-fallback']) {
    const { prompt, options } = agentCalls[label]
    assert.match(prompt, /besides the environment the repository's own sync command creates in \/w\b/, label)
    assert.equal(prompt.match(/remove your playground/g).length, 1, label)
    assert.match(prompt, /keep your evidence under evidencePath/, label)
    assert.doesNotMatch(prompt + JSON.stringify(options.schema), /scratch[^.]*is deleted/i, label)
  }
})

test('every e2e tester, the fallback and a later run create a directory of their own instead of sharing a named one', async () => {
  const { agentCalls } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'e2e-0': null, 'e2e-0-fallback': agentProvidersReplay.answers['e2e-0'] })
  for (const label of ['e2e-0', 'e2e-0-fallback']) {
    const { prompt } = agentCalls[label]
    const scratch = agentProvidersReplay.args.scratch
    assert.match(prompt, new RegExp(`mktemp -d ${scratch}/\\S+-XXXXXX`), label)
    const namedDirectories = prompt.match(new RegExp(`${scratch}/[^\\s\`'"]*`, 'g')).filter(path => !path.includes('XXXXXX'))
    assert.deepEqual(namedDirectories, [], label)
  }
})

test('routingLine: a lane with no fix round names none for fix and no blocking findings', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.routingLine, 'Routing: build sonnet/medium; fix none; review sonnet/high; test sonnet/medium; gate none; land haiku/low. Fix rounds: 0. Blocking: none')
})

test('routingLine: a lane with a fix round names the fixer, the count and each blocking finding with the stage that raised it', async () => {
  const replay = webauthReplay
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['e2e-0'] = { verdict: 'FAIL', blocking: [finding('probe: login redirect', 'the redirect loses the state')], followups: [] }
  const { result } = await runLane(replay.args, answers)
  const rounds = result.spent.total
  assert.ok(rounds > 0)
  assert.match(result.routingLine, /^Routing: build sonnet\/high; fix sonnet\/high; review \S+\/\w+; test sonnet\/high; gate gpt-6-astra\/high; land haiku\/low\. /)
  assert.ok(result.routingLine.includes(`Fix rounds: ${rounds}.`))
  assert.ok(result.routingLine.includes('src/webauth/oidc.py:315 → gate'))
  assert.ok(result.routingLine.includes('probe: login redirect → test'))
  assert.equal(result.routingLine.split('\n').length, 1)
})

test('routingLine: findings sharing a printed location and stage print in the counted form and distinct locations stay distinct', async () => {
  const where = ['a.py:3 (first defect)', 'a.py:3 (second defect)', 'a.py:3-9 (third)', 'päth/ü.py:3 (fourth)', `${'x'.repeat(200)} one`, `${'x'.repeat(200)} two`]
  const raised = where.map(w => ({ ...finding(w, 'd'), kind: 'docs' }))
  const { result } = await runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(secondFix.head) })
  const entries = result.routingLine.split('Blocking: ')[1].split('; ')
  assert.ok(entries.includes('3× a.py:3 → review'), result.routingLine)
  assert.ok(entries.includes('päth/ü.py:3 → review'), result.routingLine)
  assert.equal(blockingCount(result.routingLine), where.length)
})

test('routingLine: a range, a parenthesised reference and a trailing comma each reduce to path and line', async () => {
  const raised = ['a.py:77-80 range', 'see (b.py:5) here', 'c.py:9, then more'].map(w => ({ ...finding(w, 'd'), kind: 'docs' }))
  const { result } = await runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(secondFix.head) })
  assert.match(result.routingLine, /Blocking: a\.py:77 → review; b\.py:5 → review; c\.py:9 → review$/)
})

// The grammar of aco's specs/lane-record.spec.md, LANREC-16 to LANREC-20, written out independently of lane.js; the lane's tests run in node without aco installed,
// so this regex stands in for aco's parser and the counted form is read the same way (n× text is part of the free text before the arrow).
const stageText = '[a-z][a-z0-9.-]*/[a-z0-9-]+'
const laneRecordLine = new RegExp(
  `^Routing: build ${stageText}; fix (?:${stageText}|none); review ${stageText}; test (?:${stageText}|none); gate (?:${stageText}|none); land ${stageText}\\. ` +
  `Fix rounds: \\d{1,3}\\.(?: Experiment: [a-z0-9-]{1,40}\\.)? Blocking: (?:none|(?:[^;]+ )?→ \\w+(?:; (?:[^;]+ )?→ \\w+)*)$`)
const blockingCount = (line) => line.split('Blocking: ')[1].split('; ').filter(part => part.split('→').length === 2)
  .reduce((sum, part) => sum + Number(/^(\d+)× /.exec(part)?.[1] ?? 1), 0)

test('routingLine: a lane with no findings prints one line that fits the LANREC grammar and 512 characters', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.match(result.routingLine, laneRecordLine)
  assert.ok(result.routingLine.length <= 512)
})

test('routingLine: a fix batch that ran as mechanical names the mechanical model for fix', async () => {
  const docsFinding = { ...finding('y.py:2', 'a docs defect'), kind: 'docs' }
  const { result } = await runLane({ ...resumeArgs, fixFirst: [docsFinding] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.match(result.routingLine, /; fix haiku\/low; /)
  assert.match(result.routingLine, laneRecordLine)
})

for (const findings of [1, 12, 25, 40, 50]) {
  test(`routingLine: ${findings} blocking findings with long free-text locations keep the line within 512 characters and the count`, async () => {
    const raised = Array.from({ length: findings }, (_, n) => ({ ...finding(`probe ${n}: ${'the login redirect loses the state '.repeat(6)}`, 'a defect'), kind: 'docs' }))
    const { result } = await runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(secondFix.head) })
    assert.ok(result.routingLine.length <= 512, String(result.routingLine.length))
    assert.match(result.routingLine, laneRecordLine)
    assert.equal(blockingCount(result.routingLine), findings)
  })
}

const revisedWith = (blocking) => runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking, followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(secondFix.head) })

test('routingLine: findings whose locations drop to nothing print one counted bare entry that holds the whole count', async () => {
  const raised = Array.from({ length: 80 }, (_, n) => ({ ...finding(`${String.fromCodePoint(0x4e00 + n)} probe`, 'a defect'), kind: 'docs' }))
  const { result } = await revisedWith(raised)
  assert.ok(result.routingLine.length <= 512)
  assert.match(result.routingLine, /Blocking: 80× → review$/)
  assert.equal(blockingCount(result.routingLine), 80)
})

test('routingLine: findings whose long locations shorten to the same text print as one counted entry with the longest location that fits', async () => {
  const raised = Array.from({ length: 30 }, (_, n) => ({ ...finding(`${'x'.repeat(70)}${n}`, 'a defect'), kind: 'docs' }))
  const { result } = await revisedWith(raised)
  assert.ok(result.routingLine.length <= 512)
  assert.match(result.routingLine, laneRecordLine)
  assert.match(result.routingLine, new RegExp(`Blocking: 30× ${'x'.repeat(60)} → review$`))
  assert.equal(blockingCount(result.routingLine), 30)
})

test('routingLine: a group of more than 999 identical findings splits into counted entries aco reads in full', async () => {
  const raised = Array.from({ length: 1001 }, (_, n) => ({ ...finding('a.py:5', `defect ${n}`), kind: 'docs' }))
  const { result } = await revisedWith(raised)
  assert.match(result.routingLine, /Blocking: 999× a\.py:5 → review; 2× a\.py:5 → review$/)
  assert.equal(blockingCount(result.routingLine), 1001)
})

test('routingLine: distinct findings that share one location each count', async () => {
  const raised = Array.from({ length: 30 }, (_, n) => ({ ...finding('a.py:5', `defect ${n}`), kind: 'docs' }))
  const { result } = await revisedWith(raised)
  assert.match(result.routingLine, /Blocking: 30× a\.py:5 → review$/)
  assert.equal(blockingCount(result.routingLine), 30)
})

test('routingLine: a finding that comes back in a later round counts once', async () => {
  const raised = [{ ...finding('a.py:5', 'defect'), kind: 'docs' }]
  const { result } = await runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-2': secondFix, 'r2-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-3': secondFix, 'r3-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(blockingCount(result.routingLine), 1, result.routingLine)
})

for (const leading of ['0× zero', '5× five', '999×', 'none yet', 'none']) {
  test(`routingLine: a location that starts with ${JSON.stringify(leading)} cannot change the count aco reads`, async () => {
    const raised = [{ ...finding(leading, 'a defect'), kind: 'docs' }, { ...finding('b.py:2', 'a defect'), kind: 'docs' }]
    const { result } = await revisedWith(raised)
    const entries = result.routingLine.split('Blocking: ')[1].split('; ')
    assert.equal(entries.length, 2, result.routingLine)
    assert.ok(entries.every(entry => !/^(?:\d+×|none)/.test(entry)), result.routingLine)
    assert.equal(blockingCount(result.routingLine), 2)
  })
}

test('routingLine: a long location with a path and a line prints only the path and the line', async () => {
  const raised = [{ ...finding('src/a/b.py:77 and then a long sentence about it', 'a defect'), kind: 'docs' }]
  const { result } = await runLane({ ...resumeArgs, fixFirst: [{ ...defectWithoutDraft }] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': { verdict: 'REVISE', blocking: raised, followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(secondFix.head) })
  assert.match(result.routingLine, /Blocking: src\/a\/b\.py:77 → review$/)
})

test('routingLine: an experiment tag becomes its own sentence before Blocking', async () => {
  const { result } = await runLane({ ...resumeArgs, experiment: 'haiku-fixer-2' }, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.match(result.routingLine, /Fix rounds: 0\. Experiment: haiku-fixer-2\. Blocking: none$/)
})

for (const experiment of ['Haiku', 'a b', '', 'x'.repeat(41), 'a;b']) {
  test(`routingLine: refuses the experiment ${JSON.stringify(experiment)} at input before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, experiment })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

for (const [what, deltaFrom, batch] of [
  ['the full sha', resumeTip, {}],
  ['a short sha', resumeTip.slice(0, 12), {}],
  ['the full sha with empty fixFirst and foldIn', resumeTip, { fixFirst: [], foldIn: [] }],
  ['a short sha with empty fixFirst and foldIn', resumeTip.slice(0, 7), { fixFirst: [], foldIn: [] }],
]) {
  test(`deltaFrom equal to the tip as ${what} ends failed at input before any agent runs, naming both resumes`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, ...batch, deltaFrom })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /without deltaFrom for a full review/)
    assert.match(result.reason, /commit before the commits no reviewer has seen/)
    assert.match(result.reason, /fixFirst or foldIn/)
    assert.deepEqual(launchedAgents, [])
  })
}

for (const deltaFrom of ['not a sha', 'ABCDEF0', 'abcdef', `${resumeTip}0`]) {
  test(`deltaFrom ${JSON.stringify(deltaFrom)} that is no lowercase 7 to 40 hex sha ends failed at input before any agent runs`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, deltaFrom })
    assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'input', 'deltaFrom is not a sha'])
    assert.deepEqual(launchedAgents, [])
  })
}

test('routing-line-problem: a lane-routing that answers with a problem leaves the lane result and names the problem in the Routing line', async () => {
  const { result } = await runLane({ ...resumeArgs, deltaFrom: 'not a sha' }, {}, { transform: partReplaced('laneRouting', "return { problem: 'the printer broke' }") })
  assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'input', 'deltaFrom is not a sha'])
  assert.match(result.routingLine, /not printed.*the printer broke/)
})

// The lane record is the file aco reads at the landing and at an abandoned release; aco's specs/lane-record.spec.md owns its schema.
const recordFile = `${resumeArgs.scratch}/lane-record.json`
const writtenRecord = (run) => {
  assert.equal(run.writtenRecords.length, 1)
  return JSON.parse(run.writtenRecords[0])
}
const modelAndEffort = (routing, role) => `${routing[role].model}/${routing[role].effort}`
const refusedRecord = { record_error: `lane record ${recordFile} is invalid: version 2 is unknown; this aco reads version 1` }
const noWait = { transform: (source) => source.replace(/const NETWORK_WAIT_SECONDS = \d+$/m, 'const NETWORK_WAIT_SECONDS = 0') }

test('lane-record: a lane that is ready to land writes the stages it ran, no findings and its approving verdict, and the landing command passes the file', async () => {
  const run = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE })
  const { result } = run
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.record, recordFile)
  assert.deepEqual(writtenRecord(run), {
    version: 1,
    stages: { build: modelAndEffort(result.routing, 'build'), fix: 'none', review: modelAndEffort(result.routing, 'review'), test: modelAndEffort(result.routing, 'test'), gate: 'none', land: modelAndEffort(result.routing, 'mechanical') },
    fix_rounds: { review: 0, gate: 0, ci: 0, test: 0 },
    blocking: { review: 0, gate: 0, ci: 0, test: 0 },
    misses: { review: 0, gate: 0, ci: 0, test: 0 },
    verdicts: [{ stage: 'review', verdict: 'approve', sha: resumeTip }],
    risk: 'normal',
  })
  assert.ok(result.requiredHeadActions.some(action => action.includes(`aco land 1 --head ${resumeTip} --record ${recordFile}`)))
  assert.match(result.routingLine, /^Routing: /)
})

test('lane-record: the experiment tag of the run is written to the record', async () => {
  const run = await runLane({ ...resumeArgs, experiment: 'trial-1' }, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.equal(writtenRecord(run).experiment, 'trial-1')
})

test('lane-record: a material lane with fix rounds counts them and the findings by the stage that raised them, ends on an approving verdict and holds no whitespace', async () => {
  const replay = webauthReplay
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['e2e-0'] = { verdict: 'FAIL', blocking: [finding('probe: login redirect', 'the redirect loses the state')], followups: [] }
  const run = await runLane(replay.args, answers)
  const record = writtenRecord(run)
  assert.equal(Object.values(record.fix_rounds).reduce((sum, count) => sum + count, 0), run.result.spent.total)
  assert.ok(record.blocking.gate > 0)
  assert.equal(record.blocking.test, 1)
  assert.equal(record.risk, 'material')
  assert.equal(record.verdicts.at(-1).verdict, 'approve')
  assert.ok(record.verdicts.some(verdict => verdict.verdict === 'revise'))
  assert.ok(record.verdicts.every(verdict => /^[0-9a-f]{40}$/.test(verdict.sha)))
  assert.doesNotMatch(run.writtenRecords[0].trim(), /\s/)
})

test('lane-record: a stand-in review counts as the gate in the record', async () => {
  const run = await runLane({ ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }, { ...reachesTheEnd, 'r0-review': APPROVE, 'r0-gate': APPROVE })
  const record = writtenRecord(run)
  assert.deepEqual(record.verdicts.map(verdict => verdict.stage), ['review', 'gate'])
  assert.notEqual(record.stages.gate, 'none')
})

// Misses follow HEAD.md's Misses rule: a gate, CI or test finding raised after a review approved the range, with the exclusions of the writer.
const ciRed = (...failing) => ({ head: resumeTip, green: false, failing })
const lintFinding = { ...finding('src/x.py:3', 'the import order is wrong'), kind: 'defect', rule: 'CI check lint', deterministic: true }
const afterApproval = { ...reachesToCi, 'r2-review': APPROVE, 'e2e-1': PASS, 'ci-1': greenCi(resumeFixedTip) }
const recordOfCiRound = async (failing, fixer) => writtenRecord(await runLane({ ...resumeArgs, foldIn: [tidy] }, { ...afterApproval, 'ci-0': ciRed(...failing), 'fix-2': { ...resumeFix, ...fixer } }))

test('lane-record: a CI finding after an approving review is a miss and the review stage has none', async () => {
  const record = await recordOfCiRound([defectWithoutDraft], { regression: [{ finding: 1, test: 't.py::test_rule', failedBefore: true, passesAfter: true }] })
  assert.deepEqual([record.blocking.ci, record.misses.ci, record.misses.review], [1, 1, 0])
})

test('lane-record: a deterministic CI finding whose fixer reports no behaviour change is no miss', async () => {
  const record = await recordOfCiRound([lintFinding], { noBehaviourChange: [1] })
  assert.deepEqual([record.blocking.ci, record.misses.ci], [1, 0])
})

test('lane-record: a deterministic CI finding without a fixer report of no behaviour change stays a miss', async () => {
  const record = await recordOfCiRound([lintFinding], {})
  assert.deepEqual([record.blocking.ci, record.misses.ci], [1, 1])
})

test('lane-record: a CI finding the reader did not mark deterministic stays a miss though the fixer reports no behaviour change', async () => {
  const record = await recordOfCiRound([{ ...lintFinding, deterministic: false }], { noBehaviourChange: [1] })
  assert.deepEqual([record.blocking.ci, record.misses.ci], [1, 1])
})

test('lane-record: a test finding after an approving review is a miss', async () => {
  const failed = { verdict: 'FAIL', blocking: [defectWithoutDraft], followups: [] }
  const run = await runLane({ ...resumeArgs, foldIn: [tidy] }, { ...afterApproval, 'e2e-0': failed, 'fix-2': { ...resumeFix, regression: [{ finding: 1, test: 't.py::test_rule', failedBefore: true, passesAfter: true }] } })
  const record = writtenRecord(run)
  assert.deepEqual([record.blocking.test, record.misses.test], [1, 1])
})

const gateRaises = { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }
const materialMissLane = { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } }, foldIn: [tidy] }
const fixProof = { regression: [{ finding: 1, test: 't.py::test_rule', failedBefore: true, passesAfter: true }] }

test('lane-record: a finding only the gate raised in the round of the approving review is no miss, one it raises in a later round is', async () => {
  const sameRound = writtenRecord(await runLane(materialMissLane, { 'fix-1': resumeFix, 'r1-review': APPROVE, 'r1-gate': gateRaises, 'fix-2': { ...secondFix, ...fixProof }, 'r2-gate': APPROVE }))
  assert.deepEqual([sameRound.blocking.gate, sameRound.misses.gate], [1, 0])
  const laterRound = writtenRecord(await runLane(materialMissLane, { 'fix-1': resumeFix, 'r1-review': APPROVE, 'r1-gate': gateRaises, 'fix-2': { ...secondFix, ...fixProof }, 'r2-gate': { ...gateRaises, blocking: [{ ...defectWithoutDraft, where: 't.py:9' }] } }))
  assert.deepEqual([laterRound.blocking.gate, laterRound.misses.gate], [2, 1])
  const ciFixRound = { ...resumeFix, files: ['src/x.py'], ...fixProof }
  const secondApprovingRound = writtenRecord(await runLane(materialMissLane, { ...reachesToCi, 'r1-review': APPROVE, 'r1-gate': APPROVE, 'e2e-0': PASS, 'ci-0': ciRed({ ...defectWithoutDraft, where: 'ci.py:1' }), 'fix-2': ciFixRound, 'r2-review': APPROVE, 'r2-gate': { ...gateRaises, blocking: [{ ...defectWithoutDraft, where: 't.py:9' }] }, 'fix-3': { ...secondFix, ...fixProof }, 'r3-gate': APPROVE, 'e2e-1': PASS, 'ci-1': greenCi(secondFix.head) }))
  assert.deepEqual([secondApprovingRound.blocking.gate, secondApprovingRound.misses.gate], [1, 0])
})

test('lane-record: a later review round is the same stage, so its finding is no miss', async () => {
  const record = writtenRecord(await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': resumeFix, 'r1-review': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }, 'fix-2': { ...resumeFix, ...fixProof } }))
  assert.deepEqual([record.blocking.review, record.misses.review], [1, 0])
})

test('lane-record: a round that fixes only the fold-ins the gate raised counts as a gate fix round, and one with no stage keeps the round where it counted', async () => {
  const gateFollowup = { ...tidy, stage: 'gate' }
  const staged = writtenRecord(await runLane({ ...resumeArgs, foldIn: [gateFollowup] }, reachesToCi))
  assert.deepEqual(staged.fix_rounds, { review: 0, gate: 1, ci: 0, test: 0 })
  const unstaged = writtenRecord(await runLane({ ...resumeArgs, foldIn: [tidy] }, reachesToCi))
  assert.deepEqual(unstaged.fix_rounds, { review: 0, gate: 0, ci: 0, test: 1 })
})

test('lane-record: a fold-in naming no known stage is refused at input', async () => {
  const { result } = await runLane({ ...resumeArgs, foldIn: [{ ...tidy, stage: 'build' }] })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.match(result.reason, /foldIn\[0\] has the stage "build"/)
})

for (const [name, args, answers, options, expected] of [
  ['failed', resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' } }, {}, ['failed', 'scope']],
  ['escalated', resumeArgs, { 'r0-review': { verdict: 'architectural', blocking: [], followups: [] } }, {}, ['escalated', 'review']],
  ['awaiting-head', resumeArgs, { 'scope-resume': { network_stdout: JSON.stringify({ reason: 'unreachable' }), network_error: 'aco: forge unreachable', network_fails: 'always' } }, noWait, ['awaiting-head', 'scope']],
]) {
  test(`lane-record: a lane that ends ${name} writes a record and names it in the result`, async () => {
    const run = await runLane(args, answers, options)
    assert.deepEqual([run.result.status, run.result.stage], expected)
    assert.equal(run.result.record, recordFile)
    assert.equal(writtenRecord(run).version, 1)
  })
}

test('lane-record: a run refused at input has no lane state and writes no record', async () => {
  const run = await runLane({ ...resumeArgs, deltaFrom: 'not a sha' })
  assert.equal(run.result.stage, 'input')
  assert.equal(run.result.record, undefined)
  assert.deepEqual(run.writtenRecords, [])
})

test('lane-record: a record that aco lane-record check refuses leaves the lane awaiting-head at record with the refusal quoted and no record to pass', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, 'record-1': refusedRecord, 'record-2': refusedRecord })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.match(result.reason, /exited 2: lane record .* is invalid: version 2 is unknown/)
  assert.equal(result.record, undefined)
  assert.match(result.recordProblem, /version 2 is unknown/)
})

test('lane-record: a file whose CRC32 differs from the record stops at the comparison, before aco lane-record check runs', async () => {
  const differing = { ...refusedRecord, record_command: (command) => command.replace(/= [0-9a-f]{8} \]/, '= 00000000 ]') }
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, 'record-1': differing, 'record-2': differing })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.match(result.recordProblem, /brief file differs from the brief the script wrote/)
  assert.doesNotMatch(result.recordProblem, /invalid/)
})

test('lane-record: the relayed line of the record step carries the exit code and no stdout of aco lane-record check', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-record-line-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const printedLine = path.join(directory, 'line')
  const teeing = { record_command: (command) => `${command} | tee ${printedLine}` }
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, 'record-1': teeing })
  assert.equal(result.record, recordFile)
  const relayed = JSON.parse(fs.readFileSync(printedLine, 'utf8')).v
  assert.equal(relayed.check.code, 0)
  assert.equal('out' in relayed.check, false)
})

test('lane-record: a record is written once for a lane that ends once', async () => {
  const { agentCalls } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.deepEqual(Object.keys(agentCalls).filter(label => label.startsWith('record-')), ['record-1'])
})
