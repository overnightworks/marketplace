// A CI answer that is not green while checks are still pending ends the lane awaiting-head; a failed check with a pending one goes to a fixer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tip, lane, required, check, ciAnswer, driveCi } from './lane_workflow_harness.mjs'

const stillQueued = [
  ['only pending checks in the listing', [check(required, 'pending'), check('Python: tests', 'pending'), check('lint', 'pass')], undefined, /"Python: tests", "quality \/ verdict"/],
  ['a head run not completed and a required check missing', [check('lint', 'pass')], [{ status: 'queued', name: 'quality' }], /"quality"/],
]
for (const [what, checks, head_runs, named] of stillQueued) {
  test(`ci-pending: a not green answer without failing checks and ${what} ends awaiting-head at ci with no fixer`, async () => {
    const { result, launchedAgents } = await driveCi(ciAnswer(checks, { green: false }), lane, { head_runs })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
    assert.match(result.reason, named)
    assert.match(result.reason, new RegExp(`pr ${lane.pr} and tip ${tip}`))
    assert.ok(!launchedAgents.includes('fix-2'))
    assert.deepEqual(result.history.at(-1), { ...result.history.at(-1), by: 'ci-0', verdict: 'PENDING', blocking: [] })
  })
}

const pendingWatcherFinding = { where: 'checks', kind: 'test-gap', text: 'CI is not finished, which is not a failure', rule: 'CI must finish', evidence: 'gh pr checks lists pending checks' }
const manyPending = [...Array.from({ length: 17 }, (_, index) => check(`job ${index}`, 'pending')), check('lint', 'pass')]

const redWhilePending = [
  ['a failed check and a pending check in the listing', ciAnswer([check('b', 'fail'), check(required, 'pending')], { green: false })],
  ['a mergeable finding of the watcher and only pending checks in the listing', ciAnswer([check(required, 'pending')], { green: false, failing: [{ where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }] })],
]
for (const [what, answer] of redWhilePending) {
  test(`ci-pending: a not green answer with ${what} goes to a fixer and is RED`, async () => {
    const { result, launchedAgents } = await driveCi(answer)
    assert.ok(launchedAgents.includes('fix-2'))
    assert.notEqual(result.status, 'awaiting-head')
    assert.equal(result.history.find(entry => entry.by === 'ci-0').verdict, 'RED')
  })
}

const watcherFindingIgnored = [
  ['a watcher failing entry and only pending checks in the listing', ciAnswer([check(required, 'pending')], { green: false, failing: [{ where: 'b', kind: 'defect', text: 'fails', rule: 'CI check b', evidence: 'boom' }] })],
  ['a checks test-gap entry, 17 pending checks and the required verdict missing', ciAnswer(manyPending, { green: false, failing: [pendingWatcherFinding] })],
]
for (const [what, answer] of watcherFindingIgnored) {
  test(`ci-pending: a not green answer with ${what} ends awaiting-head at ci with no fixer, PENDING and without blocking`, async () => {
    const { result, launchedAgents } = await driveCi(answer)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
    assert.ok(!launchedAgents.includes('fix-2'))
    assert.deepEqual(result.history.find(entry => entry.by === 'ci-0'), { ...result.history.find(entry => entry.by === 'ci-0'), verdict: 'PENDING', blocking: [] })
  })
}

test('ci-pending: a completed head run leaves a not green answer without pending checks to today\'s handling', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { green: false }), lane, { head_runs: [{ status: 'completed', name: 'quality' }] })
  assert.notEqual(result.status, 'awaiting-head')
  assert.equal(result.history.at(-1).verdict, 'RED')
})
