// One normal lane in ten, the one whose item number is divisible by ten, gets the final gate on the tip its review approved, as a measurement of what one review lets through.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, storedLane, storedOwnRun, storedEarlierRun, storedGateRun, resumeArgs, resumeFix, resumeFixedTip, resumeTip, olderTip, APPROVE, PASS, greenCi, gateRaises } from './lane_workflow_harness.mjs'

const sampledLane = { ...resumeArgs, item: 10 }
// The gate is a Codex courier, whose clean exit comes with its verdict.
const gateApprove = { ...APPROVE, codexExit: 0 }
const gateRevise = { ...gateRaises, codexExit: 0 }
const fixedForGate = { ...resumeFix, regression: [{ finding: 1, test: 't.py::test_rule', failedBefore: true, passesAfter: true }] }
const reachesTheEnd = { 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }
const afterFix = { 'fix-1': fixedForGate, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) }
const limitedCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 1, note: 'tail', limit: { line: 'You have hit your usage limit.', resetsAt: null } }
const failedCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 1, note: 'the model is refused' }
const hungCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: -1, note: 'Codex run silent past the threshold and killed' }
const gateLabels = (launched) => launched.filter(label => label.includes('gate'))
const ranOfAdds = (calls) => calls.filter(call => call[1] === 'add').map(call => call.slice(call.indexOf('--ran') + 1))

test('sampled-gate: the gate starts after the review approves and before the tester and reads the whole lane', async () => {
  const { launchedAgents, agentCalls, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd })
  assert.deepEqual(launchedAgents.filter(label => /^(r0-|e2e)/.test(label)), ['r0-review', 'r0-gate', 'e2e-0'])
  assert.match(agentCalls['r0-gate'].prompt, /the whole lane: git diff origin\/main\.\.\.HEAD/)
  assert.deepEqual([result.status, result.sampled], ['ready-to-land', true])
})

test('sampled-gate: a blocking finding of the look is counted under gate on a normal lane and is no miss', async () => {
  const run = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateRevise, 'r1-gate': gateApprove, ...afterFix })
  assert.equal(run.result.status, 'ready-to-land')
  const record = storedLane(run)
  assert.deepEqual([record.risk, record.blocking.gate, record.misses.gate], ['normal', 1, 0])
  assert.deepEqual(gateLabels(run.launchedAgents), ['r0-gate', 'r1-gate'])
})

test('sampled-gate: a first sample on a run with deltaFrom hands the gate the whole lane', async () => {
  const { agentCalls } = await runLane({ ...sampledLane, deltaFrom: olderTip, answers: 'the fix answers it' }, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd })
  assert.match(agentCalls['r0-review'].prompt, new RegExp(`${olderTip}\\.\\.HEAD`))
  assert.match(agentCalls['r0-gate'].prompt, /the whole lane: git diff origin\/main\.\.\.HEAD/)
  assert.doesNotMatch(agentCalls['r0-gate'].prompt, /only this delta/)
})

for (const item of [1, 11, 99]) {
  test(`sampled-gate: item ${item}, not divisible by ten, starts no gate`, async () => {
    const { launchedAgents, result } = await runLane({ ...resumeArgs, item }, { 'r0-review': APPROVE, ...reachesTheEnd })
    assert.deepEqual([gateLabels(launchedAgents), result.sampled], [[], false])
  })
}

for (const [ending, answers] of [['limited', { 'r0-gate': limitedCourier }], ['failed', { 'r0-gate': failedCourier }], ['hung', { 'r0-gate': hungCourier, 'r0-gate-retry': hungCourier }]]) {
  test(`sampled-gate: a ${ending} look is skipped and leaves no gate in the record`, async () => {
    const run = await runLane(sampledLane, { 'r0-review': APPROVE, ...answers, ...reachesTheEnd })
    const { result } = run
    assert.deepEqual([result.status, result.sampled], ['ready-to-land', 'skipped'])
    assert.ok(result.sampledReason)
    assert.ok(run.launchedAgents.includes('e2e-0'))
    assert.match(result.routingLine, /gate none/)
    assert.deepEqual(run.writtenRecords.map(text => JSON.parse(text).stages.gate), run.writtenRecords.map(() => 'none'))
    assert.deepEqual(ranOfAdds(run.laneRecordCalls), [['review'], ['test']])
  })
}

test('sampled-gate: a gate on the builder\'s provider gives no independent look and is skipped without starting one', async () => {
  const { launchedAgents, result } = await runLane({ ...sampledLane, routing: { gate: { model: 'opus', effort: 'high' } } }, { 'r0-review': APPROVE, ...reachesTheEnd })
  assert.deepEqual([gateLabels(launchedAgents), result.sampled], [[], 'skipped'])
})

test('sampled-gate: a re-check that ends without a verdict awaits the head at review with resume arguments, never skipped', async () => {
  const { result, launchedAgents } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateRevise, 'fix-1': fixedForGate, 'r1-gate': limitedCourier })
  assert.deepEqual([result.status, result.stage, result.sampled], ['awaiting-head', 'review', true])
  assert.equal(result.deltaFrom, resumeTip)
  assert.match(result.reason, /start a new run with pr and tip, deltaFrom and answers as returned/)
  assert.ok(!launchedAgents.some(label => /^(e2e|ci)/.test(label)))
})

test('sampled-gate: a run after a stored gate REVISE re-checks with the gate beside the review and takes no new sample', async () => {
  const { launchedAgents, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd, begin: { stored_runs: [storedGateRun(['revise', olderTip]), storedOwnRun()] } })
  assert.deepEqual([gateLabels(launchedAgents), result.sampled], [['r0-gate'], true])
  assert.deepEqual(launchedAgents.filter(label => /^(r0-|e2e)/.test(label)), ['r0-review', 'r0-gate', 'e2e-0'])
})

test('sampled-gate: a run after a stored gate approval starts no gate', async () => {
  const { launchedAgents, result } = await runLane(sampledLane, { 'r0-review': APPROVE, ...reachesTheEnd, begin: { stored_runs: [storedGateRun(['approve', olderTip]), storedOwnRun()] } })
  assert.deepEqual([gateLabels(launchedAgents), result.sampled], [[], false])
})

const lostRun = { ...storedEarlierRun(), end_tip: null, ran: null, record: null }
test('sampled-gate: a lane whose read of the stored runs fails awaits the head at record and starts no gate', async () => {
  const { launchedAgents, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd, begin: { show_code: 2, show_error: 'bad shape' } })
  assert.deepEqual([result.status, result.stage, result.sampled, gateLabels(launchedAgents)], ['awaiting-head', 'record', false, []])
})

for (const [what, lost] of [['a run without a record', lostRun], ['a run that does not follow', { ...storedEarlierRun(), follows: false }]]) {
  test(`sampled-gate: a lane whose stored runs show ${what} owes the gate on the whole lane, beside the review, and takes no second sample`, async () => {
    const { launchedAgents, agentCalls, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd, begin: { stored_runs: [lost, storedOwnRun()] } })
    assert.deepEqual([result.status, result.sampled, gateLabels(launchedAgents)], ['ready-to-land', true, ['r0-gate']])
    assert.match(agentCalls['r0-gate'].prompt, /the whole lane: git diff origin\/main\.\.\.HEAD/)
  })
}

test('sampled-gate: a lane with a lost run and deltaFrom hands the gate the whole lane and the review the delta', async () => {
  const { agentCalls } = await runLane({ ...sampledLane, deltaFrom: olderTip, answers: 'the fix answers it' }, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd, begin: { stored_runs: [lostRun, storedOwnRun()] } })
  assert.match(agentCalls['r0-review'].prompt, new RegExp(`only this delta: .*${olderTip}\\.\\.HEAD`))
  assert.match(agentCalls['r0-gate'].prompt, /the whole lane: git diff origin\/main\.\.\.HEAD/)
  assert.doesNotMatch(agentCalls['r0-gate'].prompt, /only this delta/)
})

test('sampled-gate: a lane with a lost run whose gate gives no verdict awaits the head at review, never skipped', async () => {
  const { launchedAgents, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': limitedCourier, ...reachesTheEnd, begin: { stored_runs: [lostRun, storedOwnRun()] } })
  assert.deepEqual([result.status, result.stage, result.sampled], ['awaiting-head', 'review', true])
  assert.ok(!launchedAgents.some(label => /^(e2e|ci)/.test(label)))
})

test('sampled-gate: a resumed run with no earlier stored run, whose own entry does not follow, takes the sample', async () => {
  const { launchedAgents, result } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': gateApprove, ...reachesTheEnd, begin: { stored_runs: [storedOwnRun(false)] } })
  assert.deepEqual([result.status, result.sampled, gateLabels(launchedAgents)], ['ready-to-land', true, ['r0-gate']])
})
