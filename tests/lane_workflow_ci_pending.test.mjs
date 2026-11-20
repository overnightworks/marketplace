// A CI answer that is not green while checks are still pending ends the lane awaiting-head; a failed check with a pending one goes to a fixer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, tidy } from './lane_workflow_harness.mjs'

const tip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const lane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip }
const alreadySatisfied = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
const reachesCi = { 'fix-1': alreadySatisfied, 'r1-review': { verdict: 'APPROVE', blocking: [], followups: [] }, 'e2e-0': { verdict: 'PASS', blocking: [], followups: [], cells: [{ cell: 'c', result: 'held', command: 'run', exit: '0' }] } }
const required = 'quality / verdict'
const check = (name, bucket) => ({ name, bucket })
const ciAnswer = (checks, extra = {}) => ({ head: tip, green: true, failing: [], checks, requiredChecks: [required], ...extra })
const driveCi = (ci, args = lane, read, more = {}) => runLane({ ...args, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ci, ...(read && { 'ci-read-0': read }), ...more })

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

const redWhilePending = [
  ['a failed check and a pending check in the listing', ciAnswer([check('b', 'fail'), check(required, 'pending')], { green: false })],
  ['a failing finding of the watcher and only pending checks in the listing', ciAnswer([check(required, 'pending')], { green: false, failing: [{ where: 'b', kind: 'defect', text: 'fails', rule: 'CI check b', evidence: 'boom' }] })],
]
for (const [what, answer] of redWhilePending) {
  test(`ci-pending: a not green answer with ${what} goes to a fixer and is RED`, async () => {
    const { result, launchedAgents } = await driveCi(answer)
    assert.ok(launchedAgents.includes('fix-2'))
    assert.notEqual(result.status, 'awaiting-head')
    assert.equal(result.history.find(entry => entry.by === 'ci-0').verdict, 'RED')
  })
}

test('ci-pending: a completed head run leaves a not green answer without pending checks to today\'s handling', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { green: false }), lane, { head_runs: [{ status: 'completed', name: 'quality' }] })
  assert.notEqual(result.status, 'awaiting-head')
  assert.equal(result.history.at(-1).verdict, 'RED')
})
