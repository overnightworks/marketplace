// A builder may report an abbreviated sha; the lane expands it once, so the verdicts that name the full sha count for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, resumeTip, reachesTheEnd, APPROVE } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

test('a build reported with a short tip whose review approves ends ready-to-land at the full sha', async () => {
  const { result } = await runLane(builtLane, { build: { ...built, tip: resumeTip.slice(0, 7) }, ...reachesTheEnd, 'scope-0': { remote_tip: resumeTip, head: resumeTip }, 'r0-review': APPROVE })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(result.tip, resumeTip)
})
