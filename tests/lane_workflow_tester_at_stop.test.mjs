// A run that ends at fix while its tester still runs waits for the tester and reports its answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, greenCi, tidy, APPROVE } from './lane_workflow_harness.mjs'

const tip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const lane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip, foldIn: [tidy] }
const alreadySatisfied = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
const redOn = (name, ids) => {
  const finding = { where: name, kind: 'defect', text: `${name} fails`, rule: `CI check ${name}`, evidence: 'boom' }
  return { name, link: `https://github.com/o/n/actions/runs/${ids[0]}/job/${ids[1]}`, runId: ids[0], jobId: ids[1], failingStep: `Run ${name}`, findings: [finding] }
}
const redJobs = [redOn('Node: tests', ['11', '22']), redOn('Python: tests', ['11', '23'])]
const redCi = { ...greenCi(tip), green: false, failing: redJobs.flatMap(job => job.findings), checks: [{ name: 'quality / verdict', bucket: 'pass' }, ...redJobs.map(job => ({ name: job.name, bucket: 'fail' }))], red: redJobs }
const disputed = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], blocked: false, disputed: [{ where: 'Node: tests', text: 'Node: tests fails', counterEvidence: 'the same job passes on main; the failing test is not in the diff' }] }

// The tester answers only after the fixer returned, so the run ends at fix while the tester still runs.
const endsAtFixWithTesterAnswering = (testerAnswer) => {
  let fixerReturned
  const afterFixer = new Promise(resolve => { fixerReturned = resolve })
  return runLane(lane, {
    'fix-1': alreadySatisfied, 'r1-review': APPROVE, 'ci-0': redCi,
    'fix-2': { ...disputed, edit: (printed) => { fixerReturned(); return printed } },
    'e2e-0': async () => { await afterFixer; return testerAnswer },
  })
}

test('a run that ends at fix while its tester runs carries the tester verdict in its history and its findings', async () => {
  const testerFinding = { where: 'e.py:1', text: 'the drive breaks', rule: 'the flow works', evidence: 'exit 1' }
  const failed = { verdict: 'FAIL', blocking: [testerFinding], followups: [], cells: [{ cell: 'drives the entry point', result: 'failed', command: 'run it', exit: '1' }] }
  const { result } = await endsAtFixWithTesterAnswering(failed)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'fix'])
  assert.ok(result.history.some(entry => entry.by === 'e2e-0' && entry.verdict === 'FAIL'))
  assert.deepEqual(result.testerAtStop.blocking.map(f => f.where), ['e.py:1'])
})

for (const [name, testerAnswer, named] of [
  ['returns no verdict', { verdict: 'failed', followups: [] }, /tester returned no usable result/],
  ['was kept from running by the load wait', { verdict: 'failed', lockBusy: true, followups: [] }, /load wait kept the tester from running/],
  ['passes without a driven cell', { verdict: 'PASS', blocking: [], followups: [], cells: [] }, /PASS without driven cells/],
  ['fails without a blocking finding', { verdict: 'FAIL', blocking: [], followups: [], cells: [] }, /FAIL verdict came without any blocking finding/],
]) {
  test(`a run that ends at fix names a tester that ${name} in its reason`, async () => {
    const { result } = await endsAtFixWithTesterAnswering(testerAnswer)
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'fix'], result.reason)
    assert.match(result.reason, named)
    assert.equal(result.testerAtStop, undefined)
  })
}
