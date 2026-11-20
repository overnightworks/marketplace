// A run's misses see the review approvals of the earlier runs stored on the claim, which its begin reads back through aco lane-record show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, partReplaced, storedOwnRun, storedEarlierRun, resumeArgs, resumeTip, olderTip, resumeFixedTip, tidy, defectWithoutDraft, resumeFix, secondFix, APPROVE } from './lane_workflow_harness.mjs'

const materialRun = { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } }, foldIn: [tidy] }
const reviewRaises = { verdict: 'REVISE', blocking: [{ ...defectWithoutDraft, where: 't.py:2' }], followups: [] }
const gateRaises = { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }
const proofs = { regression: [1, 2].map(number => ({ finding: number, test: 't.py::test_rule', failedBefore: true, passesAfter: true })) }
// Round 1 of a material run: both the review and the gate raise a finding, so the run itself holds no approval before the gate's finding.
const gateAfterNoOwnApproval = { 'fix-1': resumeFix, 'r1-review': reviewRaises, 'r1-gate': gateRaises, 'fix-2': { ...secondFix, ...proofs }, 'r2-review': APPROVE, 'r2-gate': APPROVE }
const recordOf = async (begin, args = materialRun) => {
  const run = await runLane(args, { ...gateAfterNoOwnApproval, begin })
  assert.equal(run.writtenRecords.length, 1)
  return { record: JSON.parse(run.writtenRecords[0]), result: run.result }
}
const gateCounts = ({ record }) => [record.blocking.gate, record.misses.gate]

test('run-misses: a gate finding after an earlier run\'s review approval is a miss when this run follows', async () => {
  assert.deepEqual(gateCounts(await recordOf({ stored_runs: [storedEarlierRun(['approve', olderTip]), storedOwnRun(true)] })), [1, 1])
})

test('run-misses: a run with no earlier runs counts its misses as the run alone does', async () => {
  assert.deepEqual(gateCounts(await recordOf({ stored_runs: [storedOwnRun(true)] })), [1, 0])
})

test('run-misses: an earlier run\'s revise verdict is no approval', async () => {
  assert.deepEqual(gateCounts(await recordOf({ stored_runs: [storedEarlierRun(['revise', olderTip]), storedOwnRun(true)] })), [1, 0])
})

test('run-misses: a gate finding on the sha an earlier review approved is no miss', async () => {
  assert.deepEqual(gateCounts(await recordOf({ stored_runs: [storedEarlierRun(['approve', resumeFixedTip]), storedOwnRun(true)] })), [1, 0])
})

test('run-misses: a run that does not follow counts only its own approvals', async () => {
  assert.deepEqual(gateCounts(await recordOf({ stored_runs: [storedEarlierRun(['approve', olderTip]), storedOwnRun(false)] })), [1, 0])
})

test('run-misses: a failed read leaves misses out of the record, names the gap in the result and keeps the status', async () => {
  const read = await recordOf({ stored_runs: [storedEarlierRun(['approve', olderTip]), storedOwnRun(true)] })
  const failed = await recordOf({ show_code: 2, show_error: 'the stored runs of #1 cannot be used: bad shape' })
  assert.equal('misses' in failed.record, false)
  assert.equal(failed.record.blocking.gate, 1)
  assert.match(failed.result.missesGap, /aco lane-record show exited 2: the stored runs of #1 cannot be used: bad shape/)
  assert.equal(read.result.missesGap, undefined)
  assert.deepEqual([failed.result.status, failed.result.stage], [read.result.status, read.result.stage])
})

test('run-misses: the printer relays only the exit code, the error, this run\'s follows and the approving shas of the earlier runs', async () => {
  const lines = []
  const withNoise = { ...storedEarlierRun(['approve', olderTip], ['revise', resumeTip], ['approve', olderTip]), record: { ...storedEarlierRun().record, risk: 'material', note: 'free text', verdicts: [{ stage: 'review', verdict: 'approve', sha: olderTip }, { stage: 'gate', verdict: 'approve', sha: resumeTip }, { stage: 'review', verdict: 'revise', sha: resumeTip }] } }
  await runLane(materialRun, { ...gateAfterNoOwnApproval, begin: { stored_runs: [withNoise, storedOwnRun(true)], edit: (printed) => { lines.push(printed); return printed } } })
  assert.deepEqual(JSON.parse(lines[0]).v.lane, { code: 0, err: '', follows: true, approved: [olderTip] })
})

test('run-misses: stored runs the printer cannot read count as a failed read', async () => {
  const run = await runLane(materialRun, { ...gateAfterNoOwnApproval, begin: { stored_runs: [storedEarlierRun(['approve', olderTip])] } })
  const record = JSON.parse(run.writtenRecords[0])
  assert.equal('misses' in record, false)
  assert.ok(run.result.missesGap)
})

// The review precedes the tester and CI in every run, so no entry point shows a finding of theirs before this run's own approval; the rule is driven on a history built for it.
const missesOf = async (history, earlier) => {
  const probe = `return JSON.stringify(laneRecord({ routing: ROUTING, history: ${JSON.stringify(history)}, fixRole: null, fixRounds: { review: 0, gate: 0, ci: 0, test: 0 }, risk: 'normal', earlier: ${JSON.stringify(earlier)} }))`
  const { result } = await runLane(resumeArgs, {}, { transform: partReplaced('laneRouting', probe) })
  return JSON.parse(result.routingLine).misses
}
const unapprovedRound = [{ after: 1, by: 'review', tip: resumeTip, verdict: 'REVISE', blocking: ['t.py:9'] }]
const followingApproval = { follows: true, approved: [olderTip] }

for (const [stage, entry] of [['ci', { after: 1, by: 'ci-0', verdict: 'red', blocking: ['ci.py:1'], deterministic: [] }], ['test', { after: 1, by: 'e2e-0', verdict: 'FAIL', blocking: ['probe: login'] }]]) {
  test(`run-misses: a ${stage} finding of a run without an own approval is a miss after an earlier run's approval`, async () => {
    assert.equal((await missesOf([...unapprovedRound, entry], followingApproval))[stage], 1)
    assert.equal((await missesOf([...unapprovedRound, entry], { ...followingApproval, follows: false }))[stage], 0)
    assert.equal((await missesOf([...unapprovedRound, entry], { follows: true, approved: [] }))[stage], 0)
  })
}

test('run-misses: a deterministic ci finding whose fix proves no behaviour change is no miss after an earlier run\'s approval', async () => {
  const lint = { after: 1, by: 'ci-0', verdict: 'red', blocking: ['ci.py:1'], deterministic: ['ci.py:1'] }
  const proof = { after: 2, by: 'fix-proof', unchanged: ['ci.py:1'] }
  assert.equal((await missesOf([...unapprovedRound, lint, proof], followingApproval)).ci, 0)
  assert.equal((await missesOf([...unapprovedRound, lint], followingApproval)).ci, 1)
})
