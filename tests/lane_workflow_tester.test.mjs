// The explorative tester runs as the lane-test child under a protocol number; a refusal, a crash or a malformed answer fails the lane at test naming it.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_TEST_PROTOCOL = (\d+)$/m)?.[1])
const driveTester = (options) => runLane(resumedLane, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumedLane.tip) }, { ...options, child: 'atelier:lane-test' })

test('lane-test-protocol: a child with another protocol number returns awaiting-head at test naming both numbers and /reload-plugins', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result } = await driveTester({ transformChild: (source) => source.replace(/^const LANE_TEST_PROTOCOL = \d+$/m, `const LANE_TEST_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'test'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.match(result.requiredHeadActions.join(' '), /\/reload-plugins/)
  assert.match(result.requiredHeadActions.join(' '), /pr \d+ and tip \w+/)
})

test('lane-test-protocol: a call without the scratch directory fails the lane at test naming the missing args', async () => {
  const { result } = await driveTester({ alterChildArgs: ({ scratch: _scratch, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'test'])
  assert.match(result.reason, /missing args: .*scratch/)
})

test('lane-test-protocol: a child that throws fails the lane at test naming the error', async () => {
  const { result } = await driveTester({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'test'])
  assert.match(result.reason, /the child exploded/)
})

test('lane-test-protocol: an answer without a verdict fails the lane at test naming what came back', async () => {
  const { result } = await driveTester({ transformChild: () => "return { surprise: 'no verdict' }" })
  assert.deepEqual([result.status, result.stage], ['failed', 'test'])
  assert.match(result.reason, /lane-test answered without a verdict.*surprise/)
})

test('lane-test-protocol: lane.js and lane-test.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-test')), protocolOf(readWorkflow('lane')))
})

test('lane-test-protocol: the tester is launched by the lane-test child, not by lane.js', async () => {
  const { launchedByChild } = await driveTester({})
  assert.deepEqual(launchedByChild['atelier:lane-test'], ['e2e-0'])
})
