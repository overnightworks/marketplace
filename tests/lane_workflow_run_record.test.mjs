// Each run stores its record on the claim: it begins right after its input checks and adds the record once at its end, through aco lane-record begin and add.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, resumeArgs, resumeTip, tidy, reachesTheEnd, APPROVE, satisfied, unchangedFix, PASS, greenCi, noWait } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const worktreeHead = 'ab'.repeat(20)
const FULL_SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[0-9a-f]{32}$/
const readyAnswers = { ...reachesTheEnd, 'r0-review': APPROVE }
const withFixer = { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, ...reachesTheEnd }

// The value of an option in the arguments of one aco lane-record call, or the values up to the next option.
const optionValues = (call, option) => {
  const from = call.indexOf(option)
  if (from < 0) return undefined
  const rest = call.slice(from + 1)
  const end = rest.findIndex(word => word.startsWith('--'))
  return end < 0 ? rest : rest.slice(0, end)
}
const callOf = (calls, verb) => calls.find(call => call[1] === verb)

test('run-record: a build run begins right after the branch check, with no start tip, and its add repeats the run id', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(builtLane, { build: built, 'r0-review': APPROVE })
  const begin = callOf(laneRecordCalls, 'begin')
  assert.deepEqual(begin.slice(0, 3), ['lane-record', 'begin', '1'])
  assert.match(optionValues(begin, '--run')[0], RUN_ID)
  assert.equal(optionValues(begin, '--start-tip'), undefined)
  assert.deepEqual(Object.keys(agentCalls).slice(0, 3), ['branch', 'begin', 'build'])
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'add'), '--run'), optionValues(begin, '--run'))
})

test('run-record: a build run stopped at its builder adds --ran build alone, with the worktree head as its end tip', async () => {
  const { result, laneRecordCalls } = await runLane(builtLane, { build: { blocked: true, blockedReason: 'the brief is contradictory' }, add: { head: worktreeHead } })
  assert.deepEqual([result.status, result.stage], ['escalated', 'build'])
  const add = callOf(laneRecordCalls, 'add')
  assert.deepEqual(optionValues(add, '--ran'), ['build'])
  assert.deepEqual(optionValues(add, '--end-tip'), [worktreeHead])
  assert.equal(add[3], '/s/lane-record.json')
})

test('run-record: a run started with pr and tip begins after its sync with the synced head as start tip', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(resumeArgs, readyAnswers)
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'begin'), '--start-tip'), [resumeTip])
  assert.deepEqual(Object.keys(agentCalls).slice(0, 3), ['branch', 'sync', 'begin'])
})

test('run-record: a short tip reaches aco as the 40 digits git resolves', async () => {
  const shortTip = 'abcdef0'
  const { laneRecordCalls } = await runLane({ ...resumeArgs, tip: shortTip }, { ...readyAnswers, 'r0-review': { ...APPROVE } })
  const [startTip] = optionValues(callOf(laneRecordCalls, 'begin'), '--start-tip')
  const [endTip] = optionValues(callOf(laneRecordCalls, 'add'), '--end-tip')
  assert.match(startTip, FULL_SHA)
  assert.match(endTip, FULL_SHA)
  assert.ok(startTip.startsWith(shortTip))
})

for (const [name, answers] of [
  ['the sync relay line is unreadable', { sync: { printed: 'not a relay line' } }],
  ['the sync finds the tip without origin/main', { sync: { main_code: 1 } }],
  ['the sync git command fails', { sync: { head_code: 128 } }],
]) {
  test(`run-record: a run that ends at sync because ${name} is never begun and keeps the record in the abandon release`, async () => {
    const { result, laneRecordCalls } = await runLane(resumeArgs, answers)
    assert.equal(result.stage, 'sync')
    assert.deepEqual(laneRecordCalls, [])
    assert.ok(result.requiredHeadActions.some(action => action.includes('aco release 1 --abandoned REASON --record /s/lane-record.json')))
  })
}

for (const [name, args, answers, expected] of [
  ['a review and the e2e test', resumeArgs, readyAnswers, ['review', 'test']],
  ['a fixer', { ...resumeArgs, foldIn: [tidy] }, withFixer, ['review', 'fix', 'test']],
  ['a gate review', { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }, { ...readyAnswers, 'r0-gate': APPROVE }, ['review', 'test', 'gate']],
  ['a builder', builtLane, { build: built, 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }, ['build', 'review', 'test']],
]) {
  test(`run-record: a begun run with ${name} names the stages it started and no stage whose slot in the record is none`, async () => {
    const run = await runLane(args, answers)
    assert.equal(run.result.status, 'ready-to-land')
    const ran = optionValues(callOf(run.laneRecordCalls, 'add'), '--ran')
    assert.deepEqual(ran, expected)
    const record = JSON.parse(run.writtenRecords[0])
    assert.deepEqual(ran.filter(stage => record.stages[stage] === 'none'), [])
    assert.deepEqual(['fix', 'test', 'gate'].filter(stage => record.stages[stage] !== 'none'), expected.filter(stage => ['fix', 'test', 'gate'].includes(stage)))
  })
}

test('run-record: a run that started no stage stores nothing, since aco takes no empty --ran', async () => {
  const { result, laneRecordCalls } = await runLane(resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' } })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin'])
})

test('run-record: a refused begin ends the run awaiting-head at record with aco\'s refusal and starts no agent', async () => {
  const refusal = 'run r was added already; it cannot be begun again'
  const { result, launchedAgents, laneRecordCalls } = await runLane(resumeArgs, { begin: { begin_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.deepEqual(launchedAgents, ['sync'])
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin'])
})

test('run-record: a refused add turns a ready-to-land run into awaiting-head at record that names the status it would have had and offers no landing', async () => {
  const refusal = 'only the holder may add a run to #1'
  const { result } = await runLane(resumeArgs, { ...readyAnswers, add: { add_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.match(result.reason, /ready-to-land/)
  assert.deepEqual((result.requiredHeadActions ?? []).filter(action => action.includes('aco land')), [])
})

test('run-record: a refused add keeps the status and reason the run would have ended with in the reason, and the run adds once', async () => {
  const refusal = 'the stored runs of #1 were written since this command read them'
  const { result, laneRecordCalls } = await runLane(resumeArgs, { 'r0-review': { verdict: 'architectural', blocking: [], followups: [] }, add: { add_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.match(result.reason, /escalated.*review.*architectural verdict/)
  assert.equal(laneRecordCalls.filter(call => call[1] === 'add').length, 1)
})

test('run-record: a run whose end tip git cannot resolve ends awaiting-head at record without calling aco add', async () => {
  const { result, laneRecordCalls } = await runLane(resumeArgs, { ...readyAnswers, add: { resolve_code: 128 } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.match(result.reason, /Needed a single revision/)
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin'])
})

for (const [name, answer, expected] of [
  ['unreadable line', { printed: 'not a relay line' }, /is not a relay line/],
  ['missing answer', null, /ended without a result/],
]) {
  test(`run-record: a begin whose relay has a ${name} ends the run awaiting-head at record`, async () => {
    const { result } = await runLane(resumeArgs, { begin: answer })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
    assert.match(result.reason, expected)
  })

  test(`run-record: an add whose relay has a ${name} ends the run awaiting-head at record`, async () => {
    const { result } = await runLane(resumeArgs, { ...readyAnswers, add: answer })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
    assert.match(result.reason, expected)
  })
}

test('run-record: the landing action of a stored run goes without --record', async () => {
  const { result } = await runLane(resumeArgs, readyAnswers)
  assert.equal(result.status, 'ready-to-land')
  assert.ok(result.requiredHeadActions.includes(`land with \`aco land 1 --head ${resumeTip}\` only while the pull request head is still ${resumeTip}`))
  assert.ok(result.requiredHeadActions.every(action => !action.includes('--record')))
})

test('run-record: the abandon action of a begun run goes without --record', async () => {
  const { result } = await runLane(resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' } })
  assert.ok(result.requiredHeadActions.includes('to abandon the lane instead, run `aco release 1 --abandoned REASON`'))
})

test('run-record: the check-run action of a CI that cannot be read goes without --record', async () => {
  const unreachable = { network_error: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)', network_fails: 'always' }
  const { result } = await runLane(resumeArgs, { ...readyAnswers, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip), 'ci-read-0': unreachable }, noWait)
  const action = result.requiredHeadActions.find(entry => entry.includes('check-runs'))
  assert.ok(action, JSON.stringify(result.requiredHeadActions))
  assert.ok(action.includes(`aco land 1 --head ${resumeTip}`) && !action.includes('--record'))
})

test('run-record: the minted run id is the one of the branch relay line and the same in begin and add', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(resumeArgs, readyAnswers)
  const [runId] = optionValues(callOf(laneRecordCalls, 'begin'), '--run')
  assert.ok(agentCalls.begin.prompt.includes(`'${runId}'`))
  assert.ok(agentCalls.add.prompt.includes(`'${runId}'`))
})
