// A network failure of a relayed printer call is retried; a call that stays unreachable ends the lane awaiting-head, any other error still ends it failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumeArgs, resumeTip, APPROVE, PASS, greenCi } from './lane_workflow_harness.mjs'

const noWait = { child: 'atelier:lane-relay', transformChild: (source) => source.replace(/^const NETWORK_WAIT_SECONDS = \d+$/m, 'const NETWORK_WAIT_SECONDS = 0') }
const acoDown = 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com'
const ghDown = 'Could not resolve host: github.com'
const throughCi = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

test('AC-network-retry: a scope call that fails once with a network error is retried and the lane goes on', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'scope-resume': { network_error: acoDown, network_fails: 1 }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(calls.aco, 2)
})

test('AC-network-retry: a scope call that fails every time ends the lane awaiting-head, unreachable, with the resume of the scope stop', async () => {
  const { result, calls, launchedAgents } = await runLane(resumeArgs, { 'scope-resume': { network_error: acoDown, network_fails: 'always' } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.match(result.reason, /GitHub is unreachable: brief[\s\S]*new run with pr and tip once/)
  assert.equal(calls.aco, 3)
  assert.ok(!launchedAgents.some(label => label.includes('review')))
})

test('AC-network-retry: a ci read whose first gh call fails with a network error is retried and the lane goes on', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { network_error: ghDown, network_fails: 1 }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(calls.gh, 5)
})

test('AC-network-retry: a ci read that stays unreachable ends the lane awaiting-head at ci and the pending tester is settled first', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'ci-read-0': { network_error: ghDown, network_fails: 'always' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /GitHub is unreachable: view[\s\S]*new run with pr 1 and tip /)
  assert.ok(launchedAgents.includes('e2e-0'))
})

test('AC-network-retry: an error that is no network error ends the lane failed after one call', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
  assert.equal(calls.aco, 1)
})
