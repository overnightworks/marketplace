// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, greenCi, finding, webauthTips, webauthReplay, agentProvidersReplay, answersWith, resumeTip, tidy, defectWithoutDraft, resumeFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, secondFix, mergedOnlyTip, conflictsWithMain, mergeOnlyFix } from './lane_workflow_harness.mjs'

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

const refusedRoutings = [
  ['an unknown role', { janitor: { effort: 'low' } }],
  ['an unknown model', { build: { model: 'gpt-5.6-terra' } }],
  ['an effort above the ceiling', { fix: { effort: 'xhigh' } }],
  ['a gate on the builder\'s provider', { gate: { model: 'opus' } }],
  ['a Claude review model for a Codex reviewer', { review: { model: 'sonnet' }, __reviewer: 'codex' }],
  ['a Codex builder', { build: { model: 'gpt-6-astra' } }],
  ['an inherited property name as the gate model', { gate: { model: 'constructor' } }],
  ['a non-string model', { build: { model: ['sonnet'] } }],
  ['an inherited property name as the role', { constructor: { effort: 'low' } }],
]

for (const [what, routing] of refusedRoutings) {
  test(`#90 AC-routing-refusal: refuses a routing override with ${what} before any agent starts`, async () => {
    const { __reviewer, ...overrides } = routing
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk: 'material', reviewer: __reviewer, routing: overrides })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

const defaultRoutingByRole = [
  ['sync', 'haiku', 'low'], ['r0-review', 'sonnet', 'medium'],
]

for (const [label, model, effort] of defaultRoutingByRole) {
  test(`#90 AC-default-routing: ${label} runs on ${model} at ${effort} effort by default`, async () => {
    const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
    assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], [model, effort])
  })
}

test('#90 AC-default-routing: the build, fix and test agents run on sonnet at medium effort by default', async () => {
  const { agentCalls } = await runLane({ ...webauthReplay.args, build: 'b' }, answersWith(webauthReplay, { kind: 'test-gap', mutation: true }))
  for (const label of ['build', 'fix-1', 'e2e-0']) {
    assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], ['sonnet', 'medium'], label)
  }
})

test('#90 AC-gate-separation: a Claude builder gets the Codex gpt-6-astra gate at high effort', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  const gatePrompt = agentCalls['r0-gate'].prompt
  assert.match(gatePrompt, /-m gpt-6-astra -c model_reasoning_effort=high/)
  assert.doesNotMatch(gatePrompt, /terra|sol/i)
})

test('#128 AC-gate-revise-kept: the courier brief returns a REVISE from a clean Codex exit unchanged and never as failed', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  assert.match(agentCalls['r0-gate'].prompt, /holds 0 and .* is valid JSON, return its verdict, blocking and followups UNCHANGED.*a REVISE with blocking findings is never failed/s)
})

test('#90 AC-codex-reviewer: a Codex reviewer runs gpt-6-astra at medium effort', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, reviewer: 'codex' })
  assert.match(agentCalls['r0-review'].prompt, /-m gpt-6-astra -c model_reasoning_effort=medium/)
})

test('#90 AC-override: a routing override sets a role\'s model and effort within the ceiling', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, routing: { review: { model: 'opus', effort: 'high' } } })
  assert.deepEqual([agentCalls['r0-review'].options.model, agentCalls['r0-review'].options.effort], ['opus', 'high'])
})

test('#90 AC-remeasure: every lane result records each role\'s model and effort and which stage found each blocking finding', async () => {
  const replay = webauthReplay
  const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
  assert.deepEqual(result.routing.gate, { model: 'gpt-6-astra', effort: 'high' })
  assert.deepEqual(result.routing.build, { model: 'sonnet', effort: 'medium' })
  assert.deepEqual(result.history.find(entry => entry.by === 'gate').blocking, ['src/webauth/oidc.py:315'])
})

test('#103 AC-remeasure-test-and-ci: the e2e and CI history entries carry their blocking locations', async () => {
  const replay = webauthReplay
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['e2e-0'] = { verdict: 'FAIL', blocking: [finding('probe: login redirect', 'the redirect loses the state')], followups: [] }
  answers['ci-0'] = { head: webauthTips.secondFix, green: false, failing: [finding('ci: lint', 'ruff fails')] }
  const { result } = await runLane(replay.args, answers)
  assert.deepEqual(result.history.find(entry => entry.by === 'e2e-0').blocking, ['probe: login redirect'])
  assert.deepEqual(result.history.find(entry => entry.by === 'ci-0').blocking, ['ci: lint'])
})

test('#90 AC-reviewer-stopgap: a reviewer brief carries the stopgap refusals and narrows test-gap to a behaviour without a test', async () => {
  const { agentCalls } = await runLane(resumedLane)
  const brief = agentCalls['r0-review'].prompt
  assert.match(brief, /800 lines or more/)
  assert.doesNotMatch(brief, /defect:#n/)
  assert.match(brief, /a new test whose name does not state the behaviour it pins/)
  assert.match(brief, /a behaviour has no test/)
  assert.match(brief, /Hygiene in test code .* is a \*\*defect\*\* whose proof is the diff/)
})

const firstReviewRoundByRisk = [
  [undefined, ['r0-review']],
  ['normal', ['r0-review']],
  ['material', ['r0-review', 'r0-gate']],
]

for (const [risk, reviewers] of firstReviewRoundByRisk) {
  test(`risk ${JSON.stringify(risk)} passes input and starts the reviews ${reviewers.join(' and ')}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk })
    assert.notEqual(result.stage, 'input')
    assert.deepEqual(launchedAgents, ['sync', 'scope-resume', ...reviewers])
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
  test(`#128 AC-gate-revise-reaches-fixer: ${what}`, async () => {
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

test('#128 AC-courier-final-action: the courier and its re-read name StructuredOutput as their only final action', async () => {
  const { agentCalls } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'r0-gate': contradictoryCourier, 'r0-gate-reread': { ...gateRevise, codexExit: 0 } })
  const copySentenceByLabel = { 'r0-gate': /verbatim from the out\.json into the StructuredOutput call/, 'r0-gate-reread': /verbatim into the StructuredOutput call/ }
  for (const [label, copySentence] of Object.entries(copySentenceByLabel)) {
    assert.match(agentCalls[label].prompt, copySentence, label)
    assert.match(agentCalls[label].prompt, /only final action is the StructuredOutput call; never write a text answer first/, label)
  }
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
    assert.match(brief, /--json name,state,link/)
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
  for (const [risk, deltaFrom] of [['normal'], ['material'], ['normal', resumeTip], ['material', resumeTip]]) {
    const gated = risk === 'material'
    const diffCommand = deltaFrom ? `git diff ${deltaFrom}..HEAD` : 'git diff origin/main...HEAD'
    test(`#290 defect:#290 resume round (${risk}, ${what}${deltaFrom ? ', deltaFrom' : ''}) reviews ${gated ? 'and gates ' : ''}on ${diffCommand}`, async () => {
      const gateAnswer = { 'r1-gate': { ...APPROVE, codexExit: 0 } }
      const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, ...args, risk, deltaFrom }, { ...gateAnswer, ...reachesTheEnd, ...answers })
      for (const label of gated ? ['r1-review', 'r1-gate'] : ['r1-review']) assert.ok(agentCalls[label].prompt.includes(diffCommand), `${label} in ${launchedAgents.join(',')}`)
      assert.equal(launchedAgents.includes('r1-gate'), gated)
      if (args.foldIn) assert.match(agentCalls['r1-review'].prompt, /tidy the import order/)
      if (args.fixFirst?.includes(defectWithoutDraft)) assert.equal(agentCalls['r1-review'].prompt.split(defectWithoutDraft.text).length - 1, 1)
    })
  }
}

test('#290 defect:#290 a REVISE in the whole-lane round has the raiser re-check only the fixer delta', async () => {
  const revise = { verdict: 'REVISE', blocking: [{ ...finding('y.py:2', 'a defect'), kind: 'docs' }], followups: [] }
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': revise, 'fix-2': secondFix, 'r2-review': APPROVE })
  assert.match(agentCalls['r2-review'].prompt, /only this delta: git diff/)
  assert.ok(!agentCalls['r2-review'].prompt.includes('git diff origin/main...HEAD'))
})
