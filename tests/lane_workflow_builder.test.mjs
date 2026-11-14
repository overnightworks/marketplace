// The builder runs as laneBuild inside the lane script; a crash fails the lane at build naming it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, partReplaced } from './lane_workflow_harness.mjs'

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
