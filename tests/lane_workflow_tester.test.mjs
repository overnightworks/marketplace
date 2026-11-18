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

test('every follow-up the lane reports names the stage that raised it', async () => {
  const note = (where, owner = '#9') => ({ where, text: `note on ${where}`, owner })
  const args = { ...resumedLane, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }
  const { result } = await runLane(args, {
    'r0-review': { ...APPROVE, followups: [note('a.py:1')] }, 'r0-gate': { ...APPROVE, followups: [note('b.py:1')] },
    'e2e-0': { ...PASS, followups: [note('c.py:1')] }, 'ci-0': greenCi(resumedLane.tip),
  })
  assert.deepEqual(Object.fromEntries(result.followups.map(f => [f.where, f.stage])), { 'a.py:1': 'review', 'b.py:1': 'gate', 'c.py:1': 'test' })
})
