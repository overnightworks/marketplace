// The lane workflow reports CI green only from the copied check listing of the tip, never from the CI agent's word.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane } from './lane_workflow_harness.mjs'

const tip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const lane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip }
const tidy = { where: 'x.py:1', text: 'tidy the import order', kind: 'follow-up (fix in place)' }
const alreadySatisfied = { oldTip: tip, mergedBase: tip, tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
const reachesCi = { 'fix-1': alreadySatisfied, 'r1-review': { verdict: 'APPROVE', blocking: [], followups: [] }, 'e2e-0': { verdict: 'PASS', blocking: [], followups: [] } }
const required = 'quality / verdict'
const check = (name, bucket) => ({ name, bucket })
const ciAnswer = (checks, extra = {}) => ({ head: tip, green: true, failing: [], checks, requiredChecks: [required], ...extra })
const driveCi = (ci, args = lane) => runLane({ ...args, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ci })

const unproven = [
  ['a pending check', [check(required, 'pass'), check('Python: tests', 'pending')], /Python: tests/],
  ['a red check among several passing ones', [check(required, 'pass'), check('a', 'pass'), check('b', 'fail'), check('c', 'pass')], /b/],
  ['a red check together with a pending one', [check(required, 'pass'), check('b', 'fail'), check('c', 'pending')], /b/],
  ['a cancelled check', [check(required, 'pass'), check('b', 'cancel')], /b/],
  ['a required check missing from the listing', [check('Python: tests', 'pass')], /quality \/ verdict/],
  ['a required check listed as pending', [check(required, 'pending')], /quality \/ verdict/],
  ['a required check listed as skipping', [check(required, 'skipping')], /quality \/ verdict/],
  ['a red check and a required check missing', [check('Python: tests', 'fail')], /Python: tests[\s\S]*quality \/ verdict/],
  ['a red check and a required check pending', [check('b', 'fail'), check(required, 'pending')], /"b"[\s\S]*quality \/ verdict/],
  ['an empty listing', [], /no checks/i],
]
for (const [what, checks, reason] of unproven) {
  test(`#266 AC-ci-listing-proof: ${what} fails the lane at ci although the agent says green`, async () => {
    const { result, launchedAgents } = await driveCi(ciAnswer(checks))
    assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
    assert.match(result.reason, reason)
    assert.equal(result.history.at(-1).by, 'ci-0')
    assert.equal(result.history.at(-1).verdict, 'RED')
    assert.ok(!launchedAgents.includes('fix-2'))
  })
}

test('#266 AC-ci-listing-proof: a required check error fails the lane at ci naming the error and launches no fixer', async () => {
  const { result, launchedAgents } = await driveCi(ciAnswer([check(required, 'pass')], { requiredChecksError: 'HTTP 403: forbidden' }))
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /HTTP 403: forbidden/)
  assert.equal(result.history.at(-1).by, 'ci-0')
  assert.equal(result.history.at(-1).verdict, 'RED')
  assert.ok(!launchedAgents.includes('fix-2'))
})

const proven = [
  ['a clean listing', [check(required, 'pass'), check('a', 'pass')]],
  ['a skipping check', [check(required, 'pass'), check('a', 'skipping')]],
]
for (const [what, checks] of proven) {
  test(`#266 AC-ci-listing-proof: ${what} reaches ready-to-land`, async () => {
    const { result } = await driveCi(ciAnswer(checks))
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(result.history.at(-1).verdict, 'GREEN')
  })
}

test('#266 AC-ci-listing-proof: a conflicting pull request answered with empty arrays and green false still goes to a fixer', async () => {
  const failing = [{ where: 'mergeable', kind: 'defect', text: 'conflicts', rule: 'GitHub runs no CI on a conflicting pull request', evidence: 'CONFLICTING' }]
  const { launchedAgents } = await driveCi({ head: tip, green: false, failing, checks: [], requiredChecks: [] })
  assert.ok(launchedAgents.includes('fix-2'))
})

test('#266 AC-ci-listing-proof: green false with a failing finding still goes to a fixer', async () => {
  const failing = [{ where: 'Python: tests', kind: 'defect', text: 'fails', rule: 'CI check Python: tests', evidence: 'boom' }]
  const { launchedAgents } = await driveCi(ciAnswer([check('Python: tests', 'fail')], { green: false, failing }))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('#266 AC-ci-listing-proof: green false with all checks passing does not become ready-to-land', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { green: false }))
  assert.notEqual(result.status, 'ready-to-land')
  assert.equal(result.history.at(-1).verdict, 'RED')
})

test('#266 AC-ci-listing-proof: with repo set the CI brief names the repository and the worktree cd is gone', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]), { ...lane, repo: 'o/n' })
  const brief = agentCalls['ci-0'].prompt
  assert.match(brief, /repos\/o\/n\/rules\/branches/)
  assert.match(brief, / -R o\/n/)
  assert.doesNotMatch(brief, /cd '\/w'/)
})

test('#266 AC-ci-listing-proof: without repo the CI brief runs the listing and rules commands in the worktree', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.match(agentCalls['ci-0'].prompt, /cd '\/w' && gh api repos\/\{owner\}\/\{repo\}\/rules\/branches/)
})

test('#266 AC-ci-listing-proof: the CI brief carries the API-error rule, the conflicting-PR empty arrays and the re-watch rule', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  const brief = agentCalls['ci-0'].prompt
  assert.match(brief, /requiredChecksError/)
  assert.match(brief, /never `\[\]`/)
  assert.match(brief, /checks: \[\] and requiredChecks: \[\]/)
  assert.match(brief, /watch again before you copy the listing/)
  assert.match(brief, /--json name,bucket/)
})

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_CI_PROTOCOL = (\d+)$/m)?.[1])
const drivePassingCi = (options) => runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ciAnswer([check(required, 'pass')]) }, options)

test('#311 lane-ci-protocol: a child with another protocol number fails the lane at ci naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await drivePassingCi({ transformChild: (source) => source.replace(/^const LANE_CI_PROTOCOL = \d+$/m, `const LANE_CI_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.ok(!launchedAgents.includes('ci-0'))
})

test('#311 lane-ci-protocol: a call without the pull request number fails the lane at ci naming the missing args', async () => {
  const { result } = await drivePassingCi({ alterChildArgs: ({ pr: _pr, worktree: _worktree, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /missing args: .*pr.*worktree/)
})

test('#311 lane-ci-protocol: a child that throws fails the lane at ci naming the error', async () => {
  const { result } = await drivePassingCi({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /the child exploded/)
})

test('#311 lane-ci-protocol: lane.js and lane-ci.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-ci')), protocolOf(readWorkflow('lane')))
})

test('#311 lane-ci-protocol: the ci agent is launched by the lane-ci child, not by lane.js', async () => {
  const { launchedByChild, launchedAgents } = await drivePassingCi({})
  assert.deepEqual(launchedByChild['atelier:lane-ci'], ['ci-0'])
  assert.ok(launchedAgents.includes('ci-0'))
})
