// The builder runs as laneBuild inside the lane script; a crash fails the lane at build naming it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, partReplaced, resumeArgs, resumeFixedTip, resumeTip, defectWithoutDraft } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

test('a builder part that throws fails the lane at build naming the error', async () => {
  const { result } = await runLane(builtLane, { build: built }, { transform: partReplaced('laneBuild', "throw new Error('the builder part exploded')") })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, /lane-build.*the builder part exploded/)
})

test('the builder schema requires no check report and its prompt asks for no quality check', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  assert.deepEqual(agentCalls.build.options.schema.required, ['pr', 'tip', 'blocked'])
  assert.doesNotMatch(agentCalls.build.prompt, /quality check|noQualityGate/)
})

// A builder or fixer without a result: the lane's checkpoint step saves what the worktree holds.
const checkpointTip = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
const blocking = defectWithoutDraft

test('a builder without a result and with work in the worktree returns awaiting-head with the checkpoint tip and the resume arguments', async () => {
  const { result } = await runLane(builtLane, { build: null, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip } })
  assert.deepEqual([result.status, result.stage, result.pr, result.tip], ['awaiting-head', 'build', 7, checkpointTip])
  assert.deepEqual([result.resume.pr, result.resume.tip], [7, checkpointTip])
  assert.ok(result.resume.fixFirst[0].evidence.endsWith('\nb'))
})

test('a builder without a result and with a clean worktree keeps the failed result', async () => {
  const { result } = await runLane(builtLane, { build: null, 'checkpoint-build': { work: false } })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, /the builder returned no result/)
})

test('a fixer without a result and with work in the worktree returns awaiting-head with the remaining findings as fixFirst', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: true, head: resumeFixedTip } })
  assert.deepEqual([result.status, result.stage, result.pr, result.tip], ['awaiting-head', 'fix', 1, resumeFixedTip])
  assert.deepEqual(result.resume, { pr: 1, tip: resumeFixedTip, fixFirst: [blocking] })
})

test('a fixer without a result and with a clean worktree keeps the failed result', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: false } })
  assert.deepEqual([result.status, result.stage, result.tip], ['failed', 'fix', resumeTip])
  assert.match(result.reason, /the fixer returned no result/)
})
