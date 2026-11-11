// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, courierBriefOf, resumedLane, APPROVE, greenCi, finding, webauthTips, webauthReplay, agentProvidersReplay, answersWith, resumeTip, tidy, defectWithoutDraft, resumeFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, secondFix, mergedOnlyTip, conflictsWithMain, mergeOnlyFix } from './lane_workflow_harness.mjs'

const readWorkflow = (file) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${file}`, import.meta.url), 'utf8')

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
  ['normal', { build: ['haiku', 'high'], 'fix-1': ['haiku', 'high'], 'e2e-0': ['sonnet', 'medium'] }],
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
  assert.match(brief, /Hygiene in test code .* is a \*\*defect\*\* whose proof is the diff/)
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

test('delegated-line: every agent prompt the lane and its children start opens with the delegated line', async () => {
  const line = 'This is a delegated step started by a head, not a main session: skip the session-start routine and do only this brief.'
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
  for (const [risk, deltaFrom] of [['normal'], ['material'], ['normal', resumeTip], ['material', resumeTip]]) {
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

// ---- the lane learns every child's protocol before any agent starts
const protocolConstant = (child) => `LANE_${child.replace('lane-', '').toUpperCase()}_PROTOCOL`
const protocolOfLane = (child) => Number(readWorkflow('lane.js').match(new RegExp(`^const ${protocolConstant(child)} = (\\d+)$`, 'm'))[1])
const queryAnswer = /^if \(A\.protocolQuery\) return .*\n/m
const installedChildren = {
  'newer': (child) => (source) => source.replace(new RegExp(`^const ${protocolConstant(child)} = (\\d+)$`, 'm'), (_, number) => `const ${protocolConstant(child)} = ${Number(number) + 1}`),
  'older': (child) => (source) => source.replace(queryAnswer, '').replace(new RegExp(`^const ${protocolConstant(child)} = (\\d+)$`, 'm'), (_, number) => `const ${protocolConstant(child)} = ${Number(number) - 1}`),
}

for (const child of ['lane-build', 'lane-relay', 'lane-review', 'lane-test', 'lane-ci']) {
  for (const [direction, skewed] of Object.entries(installedChildren)) {
    test(`protocol-preflight: a ${direction} installed ${child} ends the lane at input naming both numbers and /reload-plugins, and no agent starts`, async () => {
      const { result, launchedAgents } = await runLane(resumedLane, {}, { child: `atelier:${child}`, transformQueriedChild: skewed(child) })
      const installed = protocolOfLane(child) + (direction === 'newer' ? 1 : -1)
      assert.deepEqual([result.status, result.stage], ['failed', 'input'])
      assert.match(result.reason, new RegExp(`${child} speaks protocol ${installed}, this lane speaks protocol ${protocolOfLane(child)}`))
      assert.match(result.reason, /\/reload-plugins/)
      assert.deepEqual(launchedAgents, [])
    })
  }
}

test('protocol-preflight: a lane with a build brief ends at input before the builder starts', async () => {
  const buildLane = { item: 358, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded' }
  const { result, launchedAgents } = await runLane(buildLane, { build: { pr: 2, tip: resumeTip, blocked: false } }, { child: 'atelier:lane-review', transformQueriedChild: installedChildren.older('lane-review') })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.deepEqual(launchedAgents, [])
})

test('protocol-preflight: only the mismatching child is named in the reason', async () => {
  const { result } = await runLane(resumedLane, {}, { child: 'atelier:lane-ci', transformQueriedChild: installedChildren.newer('lane-ci') })
  assert.match(result.reason, /lane-ci speaks protocol/)
  assert.doesNotMatch(result.reason, /lane-review/)
})
