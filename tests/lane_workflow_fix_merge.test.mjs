// Drives the atelier lane workflow script through a fixer that only merged main, with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, APPROVE, PASS, greenCi, conflictsWithMain, mergedOnlyTip, resumeArgs, mergeOnlyFix, defectWithoutDraft, resumeTip, reachesTheEnd } from './lane_workflow_harness.mjs'

// The relay reads the merge commit's tree and the tree git itself produces for its parents; only equal trees are a clean merge.
const mergeShapes = [
  ['a merge commit whose tree differs from git\'s own merge', { tree: 'b2b2b2b2', merge_tree: 'a1a1a1a1' }, true],
  ['a merge git cannot merge cleanly', { merge_tree_code: 1 }, true],
  ['a merge commit whose tree equals git\'s own merge', {}, false],
]

for (const [what, shape, changed] of mergeShapes) {
  test(`${what} ${changed ? 'counts as the fixer\'s change and reaches the delta review' : 'still reads as merge-only'}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...mergeOnlyFix, ...shape, files: ['tests/x.test.mjs'] }, ...reachesTheEnd, 'ci-0': greenCi(mergedOnlyTip) })
    assert.equal(launchedAgents.includes('r1-review'), changed)
    if (!changed) assert.deepEqual([result.status, result.stage, result.tip], ['awaiting-head', 'fix', mergedOnlyTip])
  })
}

const rejectedMerge = (result) => {
  assert.deepEqual([result.status, result.stage, result.tip], ['awaiting-head', 'fix', mergedOnlyTip])
  assert.match(result.reason, /the fixer only merged main and fixed nothing/)
  assert.ok(result.reason.includes(`tip ${mergedOnlyTip}`), result.reason)
}

test('a fixer that only merged main fixes nothing when a review finding, not the merge, was the finding, and the merged tip goes to the head', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': mergeOnlyFix })
  rejectedMerge(result)
  assert.ok(!launchedAgents.includes('r1-review'))
})

test('a CI finding that is not the merge answered by a clean merge of main ends awaiting-head at fix with the merged tip adopted', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, green: false, failing: [defectWithoutDraft] }, 'fix-1': mergeOnlyFix })
  rejectedMerge(result)
  assert.ok(!launchedAgents.includes('ci-1') && !launchedAgents.includes('r1-review'))
  assert.equal(result.history.at(-1).tip, mergedOnlyTip)
})

test('a mergeable CI finding answered by a clean merge of main is accepted and runs CI again', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, green: false, failing: [conflictsWithMain] }, 'fix-1': mergeOnlyFix, 'ci-1': greenCi(mergedOnlyTip) })
  assert.ok(launchedAgents.includes('ci-1'))
  assert.notEqual(result.stage, 'fix')
  assert.ok(!launchedAgents.includes('r1-review'))
})

test('the CI round fixer brief merges main only for a mergeable finding and disputes a red outside the diff, a review round keeps the plain merge', async () => {
  const ci = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, green: false, failing: [defectWithoutDraft] }, 'fix-1': mergeOnlyFix })
  assert.match(ci.agentCalls['fix-1'].prompt, /Merge origin\/main only for a finding whose where is "mergeable"/)
  assert.match(ci.agentCalls['fix-1'].prompt, /commit nothing and never answer it with a merge of main/)
  assert.doesNotMatch(ci.agentCalls['fix-1'].prompt, /Merge origin\/main if it moved/)
  const review = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': mergeOnlyFix })
  assert.match(review.agentCalls['fix-1'].prompt, /Merge origin\/main if it moved/)
  for (const prompt of [ci.agentCalls['fix-1'].prompt, review.agentCalls['fix-1'].prompt]) {
    assert.match(prompt, /Keep both sides' intent in every hunk/)
    assert.match(prompt, /merge commit holds only conflict resolutions and regenerated generated files; adaptations to main's change and fixes the static checks ask for go in commits after the merge, and the static checks run after the last merge/)
    assert.match(prompt, /incompatibly, run `git merge --abort`, commit nothing and answer blocked, naming the path, the hunk and both sides' intent/)
  }
})

