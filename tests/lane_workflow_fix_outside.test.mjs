// Drives the atelier lane workflow script through a fixer's answers given outside the tree, its unchanged tips and its unanswered batches with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, APPROVE, finding, resumeTip, olderTip, tidy, defectWithoutDraft, resumeFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, docsFinding, proofOf } from './lane_workflow_harness.mjs'

const answeredOutsideTheTree = [
  ['a pull request body edit', 'PR body, section Verification'],
  ['an item comment', 'https://github.com/o/r/issues/1#issuecomment-1'],
]

const settledByTheHead = 'the head settled this in the item body and the pull request body'
const outsideEntries = [
  ['without deltaFrom', {}],
  ['with deltaFrom equal to the tip', { deltaFrom: resumeTip, answers: settledByTheHead }],
]

const settledRun = (extraArgs, outsideAnswers = [{ finding: 1, where: 'PR body' }]) => runLane({ ...resumeArgs, ...extraArgs, fixFirst: [docsFinding] }, { 'fix-1': { ...unchangedFix, outside: outsideAnswers }, ...reachesTheEnd })
const settledArgs = { deltaFrom: resumeTip, answers: settledByTheHead }

for (const [what, where] of answeredOutsideTheTree) {
  for (const [entry, extraArgs] of outsideEntries) {
    test(`a docs finding answered by ${what} at an unchanged tip ${entry} reaches the raiser's re-check, which reads it live`, async () => {
      const { result, agentCalls } = await settledRun(extraArgs, [{ finding: 1, where }])
      assert.equal(result.status, 'ready-to-land')
      const prompt = agentCalls['r1-review'].prompt
      assert.match(prompt, /read live what the fixer edited outside the tree/)
      assert.ok(prompt.includes(where))
    })
  }
}

test('a finding the fixer lists in outside and also reports as removed, at an unchanged tip, reaches the re-check', async () => {
  const removedAndOutside = { ...unchangedFix, regression: [proofOf(1, { resolution: 'removed' })], outside: [{ finding: 1, where: 'PR body' }] }
  const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [docsFinding] }, { 'fix-1': removedAndOutside, ...reachesTheEnd })
  assert.equal(result.status, 'ready-to-land')
  assert.match(agentCalls['r1-review'].prompt, /read live what the fixer edited outside the tree/)
})

test('a removal with no diff and no outside answer fails at fix and says a body answer belongs in outside', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [docsFinding] }, { 'fix-1': { ...unchangedFix, regression: [proofOf(1, { resolution: 'removed' })] } })
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.match(result.reason, /no diff.*outside/)
})

test('the fix brief sends a body answer to outside, never removed, and carries the answers of the head when the run has them', async () => {
  const { agentCalls } = await settledRun(settledArgs)
  const prompt = agentCalls['fix-1'].prompt
  assert.match(prompt, /reported in outside, never as removed/)
  assert.ok(prompt.includes(settledByTheHead))
  const { agentCalls: without } = await settledRun({})
  assert.ok(!without['fix-1'].prompt.includes(settledByTheHead))
})

test('a body-settled finding at an unchanged tip is re-checked with the answers of the head, the finding verbatim, both bodies read live and the whole tip as the range', async () => {
  const { agentCalls } = await settledRun(settledArgs)
  const prompt = agentCalls['r1-review'].prompt
  assert.ok(prompt.includes(settledByTheHead))
  assert.ok(prompt.includes(docsFinding.text) && prompt.includes(docsFinding.evidence))
  assert.match(prompt, /item body[^.]*pull request body[^.]*live|live[^.]*item body[^.]*pull request body/)
  assert.match(prompt, /the unchanged tip does more or less than the changed body asks/)
  assert.doesNotMatch(prompt, new RegExp(`git (diff|log -p --first-parent --remerge-diff) ${resumeTip}\\.\\.HEAD`))
})

test('a body-settled finding on a material lane re-checks with the gate as well, both reading the answers of the head and the unchanged tip', async () => {
  const { result, agentCalls } = await runLane({ ...resumeArgs, ...settledArgs, risk: 'material', fixFirst: [docsFinding] }, { 'fix-1': { ...unchangedFix, outside: [{ finding: 1, where: 'PR body' }] }, ...reachesTheEnd, 'r1-gate': { ...APPROVE, codexExit: 0 } })
  assert.equal(result.status, 'ready-to-land')
  for (const reviewer of ['r1-review', 'r1-gate']) {
    assert.ok(agentCalls[reviewer], `${reviewer} runs`)
    assert.ok(agentCalls[reviewer].prompt.includes(settledByTheHead))
    assert.match(agentCalls[reviewer].prompt, /the unchanged tip does more or less than the changed body asks/)
  }
})

test('a body-settled finding with a deltaFrom older than the tip keeps the delta range and does not call the tip unchanged', async () => {
  const { result, agentCalls } = await settledRun({ ...settledArgs, deltaFrom: olderTip })
  assert.equal(result.status, 'ready-to-land')
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, new RegExp(`only this delta: git diff ${olderTip}\\.\\.HEAD`))
  assert.doesNotMatch(prompt, /unchanged tip|judge the whole tip/)
})

test('a body-settled finding at an unchanged tip ends with an approving review at that tip and a green record', async () => {
  const { result } = await settledRun(settledArgs)
  const lastReview = result.history.filter(entry => entry.by === 'review').at(-1)
  assert.equal(lastReview.verdict, 'APPROVE')
  assert.equal(lastReview.tip, resumeTip)
  assert.equal(result.history.at(-1).verdict, 'GREEN')
})

test('a blocked fixer ends escalated with the resume of the carried batch, and a new run with it plus a tip is accepted', async () => {
  const batch = [docsFinding]
  const { result } = await runLane({ ...resumeArgs, fixFirst: batch }, { 'fix-1': { ...resumeFix, printed: '', blocked: true, blockedReason: 'the body must change' } })
  assert.deepEqual([result.status, result.stage], ['escalated', 'fix'])
  assert.deepEqual(result.resume, { pr: resumeArgs.pr, deltaFrom: resumeTip, fixFirst: batch })
  assert.match(result.reason, /the branch's current head as tip/)
  const again = await runLane({ ...resumeArgs, ...result.resume, tip: resumeTip }, { 'fix-1': { ...unchangedFix, outside: [{ finding: 1, where: 'PR body' }] }, ...reachesTheEnd })
  assert.equal(again.result.status, 'ready-to-land')
})

test('with repo set the re-check reads the body and the comment from that repository', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, repo: 'owner/name', fixFirst: [docsFinding] }, { 'fix-1': { ...unchangedFix, outside: [{ finding: 1, where: 'PR body' }] }, ...reachesTheEnd })
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, /gh pr view \S+ -R owner\/name --json body/)
  assert.match(prompt, /gh issue view \S+ -R owner\/name --comments/)
})

test('an unchanged tip whose outside answers leave a blocking finding unanswered still stops with the fixer changed nothing', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [docsFinding, defectWithoutDraft] }, { 'fix-1': { ...unchangedFix, outside: [{ finding: 1, where: 'PR body' }, { finding: 2, where: ' ' }] } })
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.match(result.reason, /the fixer changed nothing/)
})

for (const location of ['PR body, section Verification', 'https://github.com/o/r/pull/9#issuecomment-1']) test(`outside-fold-in: a fold-in answered outside by its number (${location}) at an unchanged tip goes on to the re-check, which reads it live, and counts as folded`, async () => {
  const outside = [{ foldIn: 1, where: location }]
  const { result, agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': { ...unchangedFix, outside }, ...reachesTheEnd })
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.tip, resumeTip)
  assert.ok(agentCalls['r1-review'].prompt.includes(`read live what the fixer edited outside the tree (fold-in x.py:1: ${location})`))
  assert.deepEqual(result.folded.map(f => f.where), [tidy.where])
})

test('outside-fold-in: a blocking finding answered outside beside a fold-in found already done goes on to the re-check at an unchanged tip', async () => {
  const outside = [{ finding: 1, where: 'PR body, section Verification' }]
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy], fixFirst: [docsFinding] }, { 'fix-1': { ...unchangedFix, outside, resolved: [satisfied(tidy)] }, ...reachesTheEnd })
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.tip, resumeTip)
})

const unansweredBatches = [
  ['a fold-in with no answer', { foldIn: [tidy] }, []],
  ['a fold-in whose answer names no place', { foldIn: [tidy] }, [{ foldIn: 1, where: ' ' }]],
  ['a fold-in answered outside under a number that is no fold-in', { foldIn: [tidy] }, [{ foldIn: 2, where: 'PR body' }]],
  ['a fold-in answered outside beside a blocking finding left unanswered', { foldIn: [tidy], fixFirst: [defectWithoutDraft] }, [{ foldIn: 1, where: 'PR body' }]],
  ['a blocking finding answered outside beside a fold-in left unanswered', { foldIn: [tidy], fixFirst: [docsFinding] }, [{ finding: 1, where: 'PR body' }]],
]

for (const [what, batch, outside] of unansweredBatches) {
  test(`outside-fold-in: an unchanged tip with ${what} still stops with the fixer changed nothing`, async () => {
    const { result } = await runLane({ ...resumeArgs, ...batch }, { 'fix-1': { ...unchangedFix, outside } })
    assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer changed nothing'])
  })
}


test('a failed lane result that never began names the abandon release command with the record path', async () => {
  const { result } = await runLane(resumeArgs, { sync: { head_code: 128 } })
  assert.equal(result.status, 'failed')
  assert.ok(result.requiredHeadActions.some(action => /aco release 1 --abandoned REASON --record \/s\/lane-record\.json/.test(action)))
})
