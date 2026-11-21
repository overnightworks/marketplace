// A Claude agent that fails with its account usage limit ends the lane awaiting-head at its stage; any other failure stays failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi, finding } from './lane_workflow_harness.mjs'

const weeklyLimit = "You've hit your weekly limit · resets Nov 20"
const limitWordings = [
  "You've hit your limit · resets 5pm (Europe/Berlin)",
  'Opus limit reached',
]
const failing = (message) => () => { throw new Error(message) }
const blocking = finding('a.py:1', 'defect')
const REVISE = { verdict: 'REVISE', blocking: [blocking], followups: [] }

const stages = [
  ['review', { 'r0-review': failing(weeklyLimit) }, {}],
  ['fix', { 'r0-review': REVISE, 'fix-1': failing(weeklyLimit) }, { fixFirst: [blocking] }],
  ['test', { 'r0-review': APPROVE, 'e2e-0': failing(weeklyLimit), 'ci-0': greenCi(resumedLane.tip) }, {}],
  ['ci', { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': failing(weeklyLimit) }, {}],
]

for (const [stage, answers, resumeExtra] of stages) {
  test(`a usage limit in the ${stage} stage returns awaiting-head with the reset text and the resume arguments`, async () => {
    const { result, launchedAgents } = await runLane(resumedLane, answers)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', stage])
    assert.match(result.reason, /usage limit.*resets Nov 20/)
    assert.equal(result.claudeLimit.resetsAt, 'Nov 20')
    assert.ok(Array.isArray(result.history))
    assert.ok(!launchedAgents.includes('r0-review-retry'))
    if (stage !== 'review') assert.deepEqual(result.resume, { pr: resumedLane.pr, tip: resumedLane.tip, ...resumeExtra })
  })
}

test('a builder without a result whose checkpoint agent hits the limit keeps the inspect-the-worktree warning', async () => {
  const { result } = await runLane({ ...resumedLane, pr: undefined, tip: undefined, build: 'the brief' }, { build: null, 'checkpoint-build': failing(weeklyLimit) })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'build'])
  assert.match(result.reason, /resets Nov 20.*uncommitted work/)
})

test('a usage limit without a reset time says so', async () => {
  const { result } = await runLane(resumedLane, { 'r0-review': failing('You have hit your usage limit.') })
  assert.equal(result.status, 'awaiting-head')
  assert.match(result.reason, /names no reset time/)
})

test('a usage limit of a builder with nothing to save resumes with the build brief', async () => {
  const { result } = await runLane({ ...resumedLane, pr: undefined, tip: undefined, build: 'the brief' }, { build: failing(weeklyLimit) })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'build'])
  assert.match(result.reason, /resets Nov 20/)
})

for (const wording of limitWordings) {
  test(`the wording "${wording}" is a usage limit`, async () => {
    const { result } = await runLane(resumedLane, { 'r0-review': failing(wording) })
    assert.equal(result.status, 'awaiting-head')
  })
}

const ordinaryFailures = [
  ['review', { 'r0-review': failing('socket hang up') }],
  ['review (rate limit)', { 'r0-review': failing('HTTP 429: rate limit exceeded') }],
  ['review (context limit)', { 'r0-review': failing('context limit reached') }],
  ['test', { 'r0-review': APPROVE, 'e2e-0': failing('socket hang up'), 'e2e-0-retry': failing('socket hang up'), 'ci-0': greenCi(resumedLane.tip) }],
]

for (const [stage, answers] of ordinaryFailures) {
  test(`a failure in the ${stage} stage that is no usage limit stays failed`, async () => {
    const { result } = await runLane(resumedLane, answers)
    assert.equal(result.status, 'failed')
    assert.equal(result.claudeLimit, undefined)
  })
}

test('a limit in one reviewer keeps the other reviewer\'s verdict and finding in the result and the resume', async () => {
  const material = { ...resumedLane, risk: 'material' }
  const { result } = await runLane(material, { 'r0-review': failing(weeklyLimit), 'r0-gate': { ...REVISE, codexExit: 0 } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'review'])
  assert.ok(result.history.some(entry => entry.by === 'gate' && entry.verdict === 'REVISE'))
  assert.deepEqual(result.lastBlocking, [blocking])
  assert.deepEqual(result.resume.fixFirst, [blocking])

  const { launchedAgents } = await runLane({ ...material, ...result.resume }, { 'fix-1': failing(weeklyLimit) })
  assert.equal(launchedAgents.find(label => label.startsWith('fix-')), 'fix-1')
  assert.ok(!launchedAgents.includes('r0-review'))
})

test('a lane stopped by the usage limit writes no record', async () => {
  const { result, agentCalls } = await runLane(resumedLane, { 'r0-review': failing(weeklyLimit) })
  assert.equal(result.status, 'awaiting-head')
  assert.equal(result.record, undefined)
  assert.deepEqual(Object.keys(agentCalls).filter(label => label.startsWith('record-')), [])
})

// The Workflow runtime does not throw at a usage limit too far out to wait for: agent() returns null and the runtime's own log names the limit, so an account that cannot start a probe agent either is the limit.
const runtimeEnds = (...labels) => Object.fromEntries(labels.flatMap(label => [[label, null], [`limit-probe-${label}`, null]]))
const runtimeStages = [
  ['fix', { 'r0-review': REVISE, ...runtimeEnds('fix-1') }, { fixFirst: [blocking] }],
  ['ci', { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumedLane.tip), ...runtimeEnds('ci-read-0') }, {}],
]

for (const [stage, answers, resumeExtra] of runtimeStages) {
  test(`an agent the runtime ends with null at the ${stage} stage while the account cannot start another returns awaiting-head with the resume arguments`, async () => {
    const { result } = await runLane(resumedLane, answers)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', stage])
    assert.deepEqual(result.claudeLimit.resetsAt, null)
    assert.deepEqual(result.resume, { pr: resumedLane.pr, tip: resumedLane.tip, ...resumeExtra })
  })
}

test('an agent that ends with null while another agent of its model starts stays failed', async () => {
  const { result } = await runLane(resumedLane, { 'r0-review': REVISE, 'fix-1': null })
  assert.equal(result.status, 'failed')
  assert.equal(result.claudeLimit, undefined)
})

const probeErrors = [
  ['names the usage limit with a reset time', weeklyLimit, 'awaiting-head', 'Nov 20'],
  ['is an unrelated error', 'socket hang up', 'failed', undefined],
]

for (const [name, message, status, resetsAt] of probeErrors) {
  test(`a probe agent whose own call ${name} ends the lane ${status}`, async () => {
    const { result } = await runLane(resumedLane, { 'r0-review': REVISE, 'fix-1': null, 'limit-probe-fix-1': failing(message) })
    assert.equal(result.status, status)
    assert.equal(result.claudeLimit?.resetsAt, resetsAt)
  })
}
