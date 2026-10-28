// The Codex courier runs as the lane-codex child under a protocol number; a refusal or a crash fails the lane naming it.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_CODEX_PROTOCOL = (\d+)$/m)?.[1])
const driveGate = (options) => runLane({ ...resumedLane, risk: 'material' }, { 'r0-review': APPROVE }, { ...options, child: 'atelier:lane-codex' })

test('#340 lane-codex-protocol: a child with another protocol number fails the lane at review naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await driveGate({ transformChild: (source) => source.replace(/^const LANE_CODEX_PROTOCOL = \d+$/m, `const LANE_CODEX_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.ok(!launchedAgents.includes('r0-gate'))
})

test('#340 lane-codex-protocol: a call without the worktree fails the lane at review naming the missing args', async () => {
  const { result } = await driveGate({ alterChildArgs: ({ worktree: _worktree, scratch: _scratch, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /missing args: .*worktree.*scratch/)
})

test('#340 lane-codex-protocol: a child that throws fails the lane at review naming the error', async () => {
  const { result } = await driveGate({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /the child exploded/)
})

test('#340 lane-codex-protocol: an answer without a verdict fails the lane at review naming what came back', async () => {
  const { result } = await driveGate({ transformChild: () => "return { surprise: 'no verdict' }" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-codex answered without a verdict.*surprise/)
})

test('#340 lane-codex-protocol: lane.js and lane-codex.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-codex')), protocolOf(readWorkflow('lane')))
})

test('#340 lane-codex-protocol: the gate courier is launched by the lane-codex child, not by lane.js', async () => {
  const { launchedByChild, launchedAgents } = await driveGate({})
  assert.deepEqual(launchedByChild['atelier:lane-codex'], ['r0-gate'])
  assert.ok(launchedAgents.includes('r0-gate'))
})
