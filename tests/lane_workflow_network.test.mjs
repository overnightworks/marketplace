// A network failure of a relayed printer call is retried; a call that stays unreachable ends the lane awaiting-head, any other error still ends it failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumeArgs, resumeTip, APPROVE, PASS, greenCi, defectWithoutDraft, mergeOnlyFix, mergedOnlyTip, noWait } from './lane_workflow_harness.mjs'

const acoMarker = 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com'
const acoDown = { network_stdout: JSON.stringify({ reason: 'unreachable' }), network_error: 'aco: forge unreachable' }
const ghDown = 'Could not resolve host: github.com'
const throughCi = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }
// A retried read adds exactly the one failed attempt to the gh calls of a clean run.
const RETRIED_READS = 1
async function cleanRunGhCalls() {
  const { calls } = await runLane(resumeArgs, throughCi, noWait)
  return calls.gh
}

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
  assert.equal(calls.gh, await cleanRunGhCalls() + RETRIED_READS)
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
  "GitHub's GraphQL rate limit is reached; it resets at 2026-11-19 21:00 UTC",
  "GitHub's REST rate limit is reached; its reset time could not be read",
  "GitHub's secondary rate limit is reached; try again in a minute",
]

for (const message of rateLimitMessages) {
  test(`AC-rate-limit-retry: a ci read that GitHub's rate limit refuses once is retried and the lane goes on (${message.slice(0, 30)})`, async () => {
    const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { network_error: message, network_fails: 1 }, ...throughCi }, noWait)
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(calls.gh, await cleanRunGhCalls() + RETRIED_READS)
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

test('AC-rate-limit-retry: the head action names no landing when a clean merge of main moved the tip past the review and the tester re-ran on it', async () => {
  const testFailure = { where: 'mergeable', kind: 'defect', text: 't', rule: 'r', evidence: 'e' }
  const { result } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': { verdict: 'FAIL', blocking: [testFailure], followups: [] }, 'ci-0': greenCi(resumeTip), 'fix-1': mergeOnlyFix, 'e2e-1': PASS, 'ci-1': greenCi(mergedOnlyTip), 'ci-read-1': { network_error: rateLimitMessages[0], network_fails: 'always' } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'], result.reason)
  assert.ok(!(result.requiredHeadActions ?? []).some(action => /check-runs|aco land/.test(action)))
})

test('AC-rate-limit-retry: a pull request read that fails with another error ends the lane failed after one call', async () => {
  const { result, calls } = await runLane(resumeArgs, { 'ci-read-0': { view_code: 1, view_error: 'gh: HTTP 500' }, ...throughCi }, noWait)
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.equal(calls.gh, 1)
})

// A read refused on each of the printer's three tries, then the rate limit shows its quota at zero for the first RATE_EXHAUSTED_CALLS waits and refilled after.
const refused = { network_error: rateLimitMessages[0], network_fails: 3 }
const RATE_EXHAUSTED_CALLS = 2
const WITHIN_THE_HOUR = 1800
const OVER_THE_HOUR = 7200

test('AC-rate-limit-wait: a scope read refused on every in-printer try waits for the reset and the lane reaches ready-to-land', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'scope-resume': { ...refused, rate_exhausted_calls: RATE_EXHAUSTED_CALLS, rate_reset_in: WITHIN_THE_HOUR }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.some(label => label.startsWith('scope-resume-wait')))
})

test('AC-rate-limit-wait: a ci read refused on every in-printer try waits for the reset and the lane reaches ready-to-land', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'ci-read-0': { ...refused, rate_exhausted_calls: RATE_EXHAUSTED_CALLS, rate_reset_in: WITHIN_THE_HOUR }, ...throughCi }, noWait)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.some(label => label.startsWith('ci-read-0-wait')))
})

test('AC-rate-limit-wait: a reset more than an hour ahead ends the lane awaiting-head at scope after one wait', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'scope-resume': { ...refused, rate_exhausted_calls: RATE_EXHAUSTED_CALLS, rate_reset_in: OVER_THE_HOUR } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.match(result.reason, /GitHub is unreachable[\s\S]*rate limit refused[\s\S]*more than an hour/)
  assert.equal(launchedAgents.filter(label => label.startsWith('scope-resume-wait')).length, 1)
})

for (const [name, scenario] of [['unreadable', { rate_error: 'gh: HTTP 500' }], ['naming no reset', { rate_exhausted_calls: 0 }]]) {
  test(`AC-rate-limit-wait: a rate_limit read ${name} ends the lane awaiting-head at scope as without a wait`, async () => {
    const { result } = await runLane(resumeArgs, { 'scope-resume': { ...refused, ...scenario } }, noWait)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
    assert.match(result.reason, /GitHub is unreachable[\s\S]*rate limit refused/)
  })
}

test('AC-rate-limit-wait: a quota that stays at zero ends the lane awaiting-head after the hard cap of waits', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'scope-resume': { ...refused, rate_exhausted_calls: 1000, rate_reset_in: WITHIN_THE_HOUR } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.ok(launchedAgents.filter(label => label.startsWith('scope-resume-wait')).length <= 16)
})

// A rerun the limit refuses again waits a second round: the quota shows zero on the first wait call, refilled on the second, and again on the third.
const refusedTwice = { ...refused, network_fails: 6 }
const SECOND_ROUND_FIRST_WAIT_CALL = 3

test('AC-rate-limit-wait: a rerun refused again whose rate limit then shows no exhausted quota ends the lane awaiting-head', async () => {
  const { result } = await runLane(resumeArgs, { 'scope-resume': { ...refusedTwice, rate_exhausted_calls: 1, rate_reset_in: WITHIN_THE_HOUR } }, noWait)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.match(result.reason, /nothing exhausted any more/)
})

// A one-second total bound with a skew that keeps the reset within it makes the total reachable; the harness skips the printer's sleep, so the seconds the printer reports as slept are read from the run.
const withConstants = (constants) => ({ transform: (source) => Object.entries(constants).reduce((text, [name, seconds]) => text.replace(new RegExp(`const ${name} = \\d+$`, 'm'), `const ${name} = ${seconds}`), noWait.transform(source)) })
const tinyBound = withConstants({ RATE_LIMIT_SLEEP_SECONDS: 1, RATE_LIMIT_WAIT_BOUND_SECONDS: 1, RATE_LIMIT_RESET_SKEW_SECONDS: 3600 })
const defaultBound = withConstants({ RATE_LIMIT_SLEEP_SECONDS: 240 })

test('AC-rate-limit-wait: the seconds slept add up across rerun rounds and end the lane awaiting-head past the total bound', async () => {
  const { result, launchedAgents, rateLimitSleeps } = await runLane(resumeArgs, { 'scope-resume': { ...refusedTwice, rate_exhausted_calls: 1, rate_exhausted_again_at: SECOND_ROUND_FIRST_WAIT_CALL, rate_reset_in: WITHIN_THE_HOUR } }, tinyBound)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.match(result.reason, /held after waiting 2 seconds/)
  assert.equal(launchedAgents.filter(label => label.startsWith('scope-resume-wait')).length, SECOND_ROUND_FIRST_WAIT_CALL)
  assert.deepEqual(rateLimitSleeps.slice(0, 1), [1])
})

// The printer sleeps toward a reset at most sleep_within (the total bound plus the skew, 3660 s) ahead and reports nothing slept for a later one.
for (const [name, resetIn, sleeps] of [['within sleep_within sleeps', 3600, true], ['more than sleep_within ahead skips the sleep', 3700, false]]) {
  test(`AC-rate-limit-wait: a reset ${name}`, async () => {
    const { rateLimitSleeps } = await runLane(resumeArgs, { 'scope-resume': { ...refused, rate_exhausted_calls: 1000, rate_reset_in: resetIn } }, defaultBound)
    assert.equal(rateLimitSleeps[0] > 0, sleeps, `slept ${rateLimitSleeps[0]}`)
  })
}

// A wait whose sleep reaches the reset lets the rerun go on even when the slept total passes the bound: the reset is checked first.
test('AC-rate-limit-wait: a sleep that reaches the reset reruns the step although the total slept passes the bound', async () => {
  const reachesReset = withConstants({ RATE_LIMIT_SLEEP_SECONDS: 3, RATE_LIMIT_WAIT_BOUND_SECONDS: 0 })
  const { result, rateLimitSleeps } = await runLane(resumeArgs, { 'scope-resume': { ...refused, rate_exhausted_calls: 1, rate_reset_in: 3 }, ...throughCi }, reachesReset)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(rateLimitSleeps[0] > 0)
})
