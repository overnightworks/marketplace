// A network failure of a relayed printer call is retried; a call that stays unreachable ends the lane awaiting-head, any other error still ends it failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumeArgs, resumeTip, APPROVE, PASS, greenCi, defectWithoutDraft, mergeOnlyFix, mergedOnlyTip } from './lane_workflow_harness.mjs'

const noWait = { transform: (source) => source.replace(/const NETWORK_WAIT_SECONDS = \d+$/m, 'const NETWORK_WAIT_SECONDS = 0') }
const acoMarker = 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com'
const acoDown = { network_stdout: JSON.stringify({ reason: 'unreachable' }), network_error: 'aco: forge unreachable' }
const ghDown = 'Could not resolve host: github.com'
const throughCi = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

test('AC-network-retry: a scope call that fails once with a network error is retried and the lane goes on', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'scope-resume': { ...acoDown, network_fails: 1 }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(calls.aco, 2)
})

test('AC-network-retry: a scope call that fails every time ends the lane awaiting-head, unreachable, with the resume of the scope stop', async () => {
  const { result, calls, launchedAgents } = await runLane(resumeArgs, { 'scope-resume': { ...acoDown, network_fails: 'always' } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.match(result.reason, /GitHub is unreachable: brief[\s\S]*new run with pr and tip once/)
  assert.equal(calls.aco, 3)
  assert.ok(!launchedAgents.some(label => label.includes('review')))
})

test('AC-network-retry: a ci read whose first gh call fails with a network error is retried and the lane goes on', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { network_error: ghDown, network_fails: 1 }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(calls.gh, 7)
})

test('AC-network-retry: a ci read that stays unreachable ends the lane awaiting-head at ci and the pending tester is settled first', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'ci-read-0': { network_error: ghDown, network_fails: 'always' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'], result.reason)
  assert.match(result.reason, /GitHub is unreachable: view[\s\S]*new run with pr 1 and tip /)
  assert.ok(launchedAgents.includes('e2e-0'))
})

test('AC-network-retry: an error that is no network error ends the lane failed after one call', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
  assert.equal(calls.aco, 1)
})

test('AC-network-retry: an aco brief that fails with a network marker on stderr but without the typed reason ends the lane failed after one call', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'scope-resume': { network_error: acoMarker, network_fails: 'always' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
  assert.equal(calls.aco, 1)
})

const rateLimitMessages = [
  'GraphQL: API rate limit already exceeded for user ID 1.',
  'gh: API rate limit exceeded for user ID 1. (HTTP 403)',
  'gh: You have exceeded a secondary rate limit. (HTTP 403)',
]

for (const message of rateLimitMessages) {
  test(`AC-rate-limit-retry: a ci read that GitHub's rate limit refuses once is retried and the lane goes on (${message.slice(0, 30)})`, async () => {
    const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { network_error: message, network_fails: 1 }, ...throughCi }, noWait)
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(calls.gh, 7)
  })

  test(`AC-rate-limit-retry: a ci read refused on every try ends awaiting-head at ci with the REST head action (${message.slice(0, 30)})`, async () => {
    const { result } = await runLane(resumeArgs, { 'ci-read-0': { network_error: message, network_fails: 'always' }, ...throughCi }, noWait)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'], result.reason)
    assert.match(result.reason, /GitHub is unreachable: view[\s\S]*rate limit refused/)
    assert.ok(result.requiredHeadActions.some(action => /check-runs/.test(action) && action.includes(result.tip) && /aco land/.test(action)), result.requiredHeadActions.join('\n'))
  })

  test(`AC-rate-limit-retry: a scope read refused on every try ends awaiting-head at scope (${message.slice(0, 30)})`, async () => {
    const { result } = await runLane(resumeArgs, { 'scope-resume': { network_error: message, network_fails: 'always' } }, noWait)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
    assert.match(result.reason, /rate limit refused/)
  })
}

test('AC-rate-limit-retry: the head action names no landing when the tester has not passed', async () => {
  const { result } = await runLane(resumeArgs, { 'ci-read-0': { network_error: rateLimitMessages[0], network_fails: 'always' }, ...throughCi, 'e2e-0': { verdict: 'FAIL', blocking: [{ where: 'x', kind: 'defect', text: 't', rule: 'r', evidence: 'e' }], followups: [] } }, noWait)
  assert.equal(result.status, 'awaiting-head')
  assert.ok(!(result.requiredHeadActions ?? []).some(action => /check-runs/.test(action)))
})

test('AC-rate-limit-retry: the head action names no landing when a clean merge of main moved the tip past the last verdict', async () => {
  const { result } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, green: false, failing: [defectWithoutDraft] }, 'fix-1': mergeOnlyFix, 'ci-1': greenCi(mergedOnlyTip), 'ci-read-1': { network_error: rateLimitMessages[0], network_fails: 'always' } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'], result.reason)
  assert.ok(!(result.requiredHeadActions ?? []).some(action => /check-runs|aco land/.test(action)))
})

test('AC-rate-limit-retry: a pull request read that fails with another error ends the lane failed after one call', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { view_code: 1, view_error: 'gh: HTTP 500' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.equal(calls.gh, 1)
})
