// A material lane whose Codex gate is refused for its routed model runs the opus/high stand-in in the same round and keeps it for the run; nothing else that fails a gate counts as a refusal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, storedLane, storedGateRun, storedOwnRun, olderTip, resumeArgs, resumeFix, resumeFixedTip, resumeTip, APPROVE, PASS, greenCi, finding } from './lane_workflow_harness.mjs'

const materialLane = { ...resumeArgs, risk: 'material', productionPaths: ['src/'] }
const sampledLane = { ...resumeArgs, item: 10 }
const gateFinding = finding('src/gate.py:3', 'the stand-in finding')
const REVISE = { verdict: 'REVISE', blocking: [gateFinding], followups: [] }
const productionFix = { 'fix-1': { ...resumeFix, files: ['src/x.py'] } }
const reachesTheEnd = { 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

// The model the courier starts Codex with is the routed one; the refusal line names it, as Codex prints it.
const modelOf = (prompt) => /codex exec .* -m (\S+) /.exec(prompt)[1]
const refusalLine = (model) => `ERROR: The '${model}' model is not supported when using Codex with a ChatGPT account.`
const refused = ({ codexExit = 1, line = refusalLine } = {}) => (prompt) => ({
  verdict: 'failed', blocking: [], followups: [], codexExit, note: 'tail', refusal: { line: line(modelOf(prompt)) },
})
const ordinaryFailure = { verdict: 'failed', blocking: [], followups: [], codexExit: 1, note: 'boom' }
const refusedGate = { 'r0-review': APPROVE, 'r0-gate': refused(), 'r0-gate-standin': APPROVE, ...reachesTheEnd }
const isCodexCourier = (call) => call.prompt.includes('codex exec')

test('gate-refusal: a refused gate beside an approving review is replaced in its round by an opus/high gate and the lane reaches ready-to-land', async () => {
  const { result, agentCalls, launchedAgents } = await runLane(materialLane, refusedGate)
  assert.equal(result.status, 'ready-to-land')
  const { model, effort } = agentCalls['r0-gate-standin'].options
  assert.deepEqual([model, effort], ['opus', 'high'])
  assert.deepEqual(launchedAgents.filter(label => /^r0-/.test(label)), ['r0-review', 'r0-gate', 'r0-gate-standin'])
  assert.ok(result.history.some(entry => entry.by === 'gate' && entry.verdict === 'APPROVE'))
})

test('gate-refusal: a gate routed to the stand-in by the head is named without a refusal as its reason', async () => {
  const { result } = await runLane({ ...materialLane, routing: { gate: { model: 'opus', effort: 'high' } } }, { 'r0-review': APPROVE, 'r0-gate': APPROVE, ...reachesTheEnd })
  const [action] = result.requiredHeadActions.filter(line => /stand-in as the final gate/.test(line))
  assert.doesNotMatch(action, /refused/)
})

test('gate-refusal: the record, the routing line, the result routing and the head actions name the stand-in as the gate', async () => {
  const run = await runLane(materialLane, refusedGate)
  const { result } = run
  const { model, effort } = result.routing.gate
  assert.deepEqual([model, effort], ['opus', 'high'])
  assert.match(result.routingLine, new RegExp(`; gate ${model}/${effort}; land `))
  assert.equal(storedLane(run).stages.gate, `${model}/${effort}`)
  assert.equal(result.requiredHeadActions.filter(line => /stand-in as the final gate/.test(line)).length, 1)
})

test('gate-refusal: the review\'s REVISE is kept beside the stand-in\'s verdict and goes to a fixer', async () => {
  const { result, launchedAgents } = await runLane(materialLane, { ...refusedGate, 'r0-review': REVISE, ...productionFix, 'r1-review': APPROVE, 'r1-gate': APPROVE, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.ok(launchedAgents.includes('fix-1'))
  assert.ok(result.history.some(entry => entry.by === 'review' && entry.verdict === 'REVISE'))
})

test('gate-refusal: a re-check after the stand-in\'s REVISE runs on the stand-in and starts no second Codex courier', async () => {
  const { result, agentCalls } = await runLane(materialLane, { ...refusedGate, 'r0-gate-standin': REVISE, ...productionFix, 'r1-review': APPROVE, 'r1-gate': APPROVE, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  const recheck = agentCalls['r1-gate']
  assert.deepEqual([recheck.options.model, recheck.options.effort], [result.routing.gate.model, result.routing.gate.effort])
  assert.ok(!Object.values(agentCalls).filter(isCodexCourier).some(call => call !== agentCalls['r0-gate']))
})

test('gate-refusal: a stand-in that ends without a verdict fails the lane at review', async () => {
  const failedStandIn = { verdict: 'failed', blocking: [], followups: [], note: 'ended' }
  const { result, launchedAgents } = await runLane(materialLane, { 'r0-review': APPROVE, 'r0-gate': refused(), 'r0-gate-standin': failedStandIn, 'r0-gate-standin-retry': failedStandIn })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.ok(launchedAgents.includes('r0-gate-standin') && launchedAgents.includes('r0-gate-standin-retry'))
})

// The courier's re-read prompt holds no codex command, so the exit-0 refusal is a fixed answer the re-read repeats.
const routedGateModel = (await runLane(materialLane, {})).result.routing.gate.model
const exitZeroRefusal = { verdict: 'failed', blocking: [], followups: [], codexExit: 0, note: 'tail', refusal: { line: refusalLine(routedGateModel) } }
const notRefusals = [
  ['a clean Codex exit', { 'r0-gate': exitZeroRefusal, 'r0-gate-reread': exitZeroRefusal }],
  ['another model', { 'r0-gate': refused({ line: () => refusalLine('another-model') }) }],
  ['a line without the ERROR prefix', { 'r0-gate': refused({ line: (model) => refusalLine(model).replace('ERROR: ', '') }) }],
  ['a line that only mentions the refusal', { 'r0-gate': refused({ line: (model) => `warning: ${refusalLine(model)}` }) }],
  ['a metadata warning', { 'r0-gate': refused({ line: (model) => `warning: Model metadata for \`${model}\` not found. Defaulting to fallback metadata.` }) }],
  ['a login error', { 'r0-gate': refused({ line: () => 'ERROR: Not logged in' }) }],
  ['an ordinary failed run', { 'r0-gate': ordinaryFailure }],
]
for (const [name, answers] of notRefusals) {
  test(`gate-refusal: ${name} is no refusal, the lane fails at review and starts no stand-in`, async () => {
    const { result, launchedAgents } = await runLane(materialLane, { 'r0-review': APPROVE, ...answers })
    assert.deepEqual([result.status, result.stage], ['failed', 'review'])
    assert.ok(!launchedAgents.includes('r0-gate-standin'))
  })
}

test('gate-refusal: a refused Codex review (reviewer codex) is no refusal of the gate and fails the lane', async () => {
  const { result, launchedAgents } = await runLane({ ...materialLane, reviewer: 'codex' }, { 'r0-review': refused(), 'r0-gate': { ...APPROVE, codexExit: 0 } })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.ok(!launchedAgents.some(label => label.includes('standin')))
})

test('gate-refusal: the sampled look of a normal lane with a refused gate stays skipped and starts no stand-in', async () => {
  const { result, launchedAgents } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': refused(), ...reachesTheEnd })
  assert.deepEqual([result.status, result.sampled], ['ready-to-land', 'skipped'])
  assert.ok(!launchedAgents.includes('r0-gate-standin'))
  assert.match(result.routingLine, /gate none/)
})

test('gate-refusal: the owed gate re-check of a normal lane refused for its model starts no stand-in and fails at review', async () => {
  const stored = { stored_runs: [storedGateRun(['revise', olderTip]), storedOwnRun()] }
  const { result, launchedAgents } = await runLane(sampledLane, { 'r0-review': APPROVE, 'r0-gate': refused(), 'r0-gate-standin': APPROVE, begin: stored })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.ok(!launchedAgents.includes('r0-gate-standin'))
  assert.match(result.reason, /tail/)
})
