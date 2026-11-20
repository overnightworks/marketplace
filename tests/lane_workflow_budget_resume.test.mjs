import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumeArgs, defectWithoutDraft, roundTip, roundRed, reviewedRoundFix, roundReviews, APPROVE, PASS, greenCi } from './lane_workflow_harness.mjs'

const tolerates = { timeout: 5000 }

// A lane that ends on a spent budget names the arguments of the run that continues it.
const spentRun = {
  'ci-red': [{ ci: 1 }, { ...roundReviews, 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': roundRed(0), 'ci-1': roundRed(1), 'fix-1': reviewedRoundFix(1) }],
  unresolved: [{ review: 0 }, { 'r0-review': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] } }],
}
for (const [status, [budgets, answers]] of Object.entries(spentRun)) {
  test(`budget-resume: a lane whose budget is spent ends ${status} with the resume that starts a new run at the fixer`, tolerates, async () => {
    const { result } = await runLane({ ...resumeArgs, budgets }, answers)
    assert.equal(result.status, status, result.reason)
    const { resume } = result
    assert.deepEqual(resume, { pr: result.pr, tip: result.tip, deltaFrom: result.tip, fixFirst: result.lastBlocking })
    assert.ok(resume.fixFirst.length > 0)
    assert.match(result.reason, /new run with the arguments in resume starts at the fixer and reviews only its commits/)
    const again = await runLane({ ...resumeArgs, ...resume, budgets: { ci: 5 } }, { ...roundReviews, 'fix-1': { ...reviewedRoundFix(1), head: roundTip(5), parents: [resume.tip] }, 'ci-0': greenCi(roundTip(5)), 'e2e-0': PASS })
    assert.notEqual(again.result.stage, 'input', again.result.reason)
    assert.ok(again.launchedAgents.indexOf('fix-1') >= 0 && !again.launchedAgents.includes('r0-review'))
  })
}
