// The explorative tester runs as laneTest inside the lane script; a crash or a malformed answer fails the lane at test naming it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi, partReplaced } from './lane_workflow_harness.mjs'

const driveTester = (options) => runLane(resumedLane, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumedLane.tip) }, options)

test('a tester part that throws fails the lane at test naming the error', async () => {
  const { result } = await driveTester({ transform: partReplaced('laneTest', "throw new Error('the child exploded')") })
  assert.deepEqual([result.status, result.stage], ['failed', 'test'])
  assert.match(result.reason, /the child exploded/)
})

test('a tester answer without a verdict fails the lane at test naming what came back', async () => {
  const { result } = await driveTester({ transform: partReplaced('laneTest', "return { surprise: 'no verdict' }") })
  assert.deepEqual([result.status, result.stage], ['failed', 'test'])
  assert.match(result.reason, /lane-test answered without a verdict.*surprise/)
})
