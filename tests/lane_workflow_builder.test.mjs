// The builder runs as the lane-build child under a protocol number; a refusal or a crash fails the lane at build naming it.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_BUILD_PROTOCOL = (\d+)$/m)?.[1])
const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const driveBuilder = (options) => runLane(builtLane, { build: built }, { ...options, child: 'atelier:lane-build' })

test('lane-build-protocol: a child with another protocol number fails the lane at build naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result } = await driveBuilder({ transformChild: (source) => source.replace(/^const LANE_BUILD_PROTOCOL = \d+$/m, `const LANE_BUILD_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
})

test('lane-build-protocol: lane.js and lane-build.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-build')), protocolOf(readWorkflow('lane')))
})
