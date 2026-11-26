// The builder runs as laneBuild inside the lane script; a crash fails the lane at build naming it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, partReplaced, resumeArgs, resumeFixedTip, resumeTip, olderTip, defectWithoutDraft, unchangedFix, reachesTheEnd, APPROVE } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

test('a builder part that throws fails the lane at build naming the error', async () => {
  const { result } = await runLane(builtLane, { build: built }, { transform: partReplaced('laneBuild', "throw new Error('the builder part exploded')") })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, /lane-build.*the builder part exploded/)
})

test('the builder schema requires no check report and its prompt asks for no quality check', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  assert.deepEqual(agentCalls.build.options.schema.required, ['pr', 'tip', 'reuse', 'blocked'])
  assert.doesNotMatch(agentCalls.build.prompt, /quality check|noQualityGate/)
})

test('the builder prompt asks for the owner extended or the search that found none', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  assert.match(agentCalls.build.prompt, /reuse: the owner you extended \(module and function\), or the search you ran and why nothing found fits/)
})

// A builder or fixer without a result: the lane's checkpoint step saves what the worktree holds.
const checkpointTip = 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
const blocking = defectWithoutDraft
// The relay lists at most 50 paths, so only a longer list cannot be judged and stops the scope check.
const unjudgeableOutside = ['board.py', ...Array.from({ length: 50 }, (_, index) => `src/mod_${index}.py`)]

test('a builder without a result and with work in the worktree returns awaiting-head with the checkpoint tip and the resume arguments', async () => {
  const { result } = await runLane(builtLane, { build: null, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip } })
  assert.deepEqual([result.status, result.stage, result.pr, result.tip], ['awaiting-head', 'build', 7, checkpointTip])
  assert.deepEqual([result.resume.pr, result.resume.tip], [7, checkpointTip])
  assert.ok(result.resume.fixFirst[0].evidence.endsWith('\nb'))
})

for (const [name, answer] of [['pr 0', { ...built, pr: 0 }], ['no pr', { tip: built.tip, reuse: built.reuse, blocked: false }]]) {
  test(`a builder answer with ${name} ends awaiting-head at build with the draft pull request before any review or test`, async () => {
    const { result, launchedAgents } = await runLane(builtLane, { build: answer, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip } })
    assert.deepEqual([result.status, result.stage, result.pr, result.tip], ['awaiting-head', 'build', 7, checkpointTip])
    assert.deepEqual([result.resume.pr, result.resume.tip], [7, checkpointTip])
    assert.deepEqual(launchedAgents.filter(label => /review|gate|test/.test(label)), [])
  })
}

test('a blocked builder answer without a pull request ends escalated at build with its reason', async () => {
  const { result } = await runLane(builtLane, { build: { blocked: true, blockedReason: 'the brief is contradictory' } })
  assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'build', 'the brief is contradictory'])
})

test('a builder without a result and with a clean worktree keeps the failed result', async () => {
  const { result } = await runLane(builtLane, { build: null, 'checkpoint-build': { work: false } })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, /the builder returned no result/)
})

test('a fixer without a result and with work in the worktree returns awaiting-head with the remaining findings as fixFirst', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: true, head: resumeFixedTip } })
  assert.deepEqual([result.status, result.stage, result.pr, result.tip], ['awaiting-head', 'fix', 1, resumeFixedTip])
  assert.deepEqual(result.resume, { pr: 1, tip: resumeFixedTip, fixFirst: [blocking] })
})

test('a fixer without a result and with a clean worktree keeps the failed result', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: false } })
  assert.deepEqual([result.status, result.stage, result.tip], ['failed', 'fix', resumeTip])
  assert.match(result.reason, /the fixer returned no result/)
})

const failedCheckpoints = [
  ['a failed git command', builtLane, { build: null, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip, head_code: 1 } }, 'build'],
  ['a pull request number that is missing after a build', builtLane, { build: null, 'checkpoint-build': { work: true, head: checkpointTip } }, 'build'],
  ['a pull request number that is not valid after a build', builtLane, { build: null, 'checkpoint-build': { work: true, pr: 0, head: checkpointTip } }, 'build'],
  ['a fix checkpoint at the old tip', { ...resumeArgs, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: true, head: resumeTip } }, 'fix'],
]

for (const [what, args, answers, stage] of failedCheckpoints) {
  test(`a checkpoint with ${what} keeps the failed result`, async () => {
    const { result } = await runLane(args, answers)
    assert.deepEqual([result.status, result.stage], ['failed', stage])
  })
}

test('a checkpoint outside the claim after a build stops at scope and still hands the head the unfinished build brief', async () => {
  const { result } = await runLane(builtLane, { build: null, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip }, 'scope-checkpoint-build-0': { outside_claim: unjudgeableOutside } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'scope'])
  assert.deepEqual([result.resume.pr, result.resume.tip], [7, checkpointTip])
  assert.ok(result.resume.fixFirst[0].evidence.endsWith('\nb'))
})

test('a carried fixer without a result whose checkpoint is outside the claim names the head deltaFrom as the origin of the new run', async () => {
  const { result } = await runLane({ ...resumeArgs, deltaFrom: olderTip, fixFirst: [blocking] }, { 'fix-1': null, 'checkpoint-fix': { work: true, head: resumeFixedTip }, 'scope-checkpoint-fix-1': { outside_claim: unjudgeableOutside } })
  assert.equal(result.stage, 'scope')
  assert.match(result.reason, new RegExp(`deltaFrom ${olderTip}`))
  assert.deepEqual(result.resume.fixFirst, [blocking])
})

// The resume the lane hands out after a build checkpoint carries the lane's own finding.
const checkpointFinding = async () => (await runLane(builtLane, { build: null, 'checkpoint-build': { work: true, pr: 7, head: checkpointTip } })).result.resume.fixFirst[0]

const unchangedCheckpointRuns = [
  ['the checkpoint finding alone and the brief reported met', (own) => [own], true, true],
  ['the checkpoint finding alone and the brief not reported met', (own) => [own], false, false],
  ['another finding alone and the brief reported met', () => [blocking], true, false],
  ['the checkpoint finding beside another finding and the brief reported met', (own) => [own, blocking], true, false],
]

for (const [what, findings, briefMet, goesOn] of unchangedCheckpointRuns) {
  test(`a fixer that changes nothing with ${what} ${goesOn ? 'reaches the review of the whole lane' : 'still ends the lane failed at fix'}`, async () => {
    const fixFirst = findings(await checkpointFinding())
    const { result, launchedAgents, agentCalls } = await runLane({ ...resumeArgs, deltaFrom: olderTip, fixFirst }, { ...reachesTheEnd, 'fix-1': { ...unchangedFix, briefMet } })
    assert.deepEqual([result.status, result.stage], goesOn ? ['ready-to-land', undefined] : ['failed', 'fix'])
    assert.equal(launchedAgents.includes('r1-review'), goesOn)
    if (goesOn) {
      assert.match(agentCalls['r1-review'].prompt, /the whole lane/)
      assert.doesNotMatch(agentCalls['r1-review'].prompt, /only this delta/)
    }
  })
}

// Before ready-to-land a pull request still titled as the checkpoint gets the item's title.
const titledRuns = [
  ['the checkpoint title', { pr_title: `Unfinished checkpoint of #${resumedLane.item}` }, true],
  ['a title of its own', { pr_title: 'Add the feature' }, false],
]

for (const [what, scenario, renamed] of titledRuns) {
  test(`a pull request with ${what} ${renamed ? 'is renamed to the item title' : 'keeps its title'} before ready-to-land`, async () => {
    const { result, patchedTitles } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, retitle: { ...scenario, item_title: 'The item title' } })
    assert.equal(result.status, 'ready-to-land')
    assert.deepEqual(patchedTitles, renamed ? ['title=The item title'] : [])
    assert.ok(!result.requiredHeadActions.some(action => /rename pull request/.test(action)))
  })
}

test('a failed title write names the rename among the head actions', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, retitle: { pr_title: `Unfinished checkpoint of #${resumedLane.item}`, patch_code: 1 } })
  assert.equal(result.status, 'ready-to-land')
  assert.ok(result.requiredHeadActions.some(action => /rename pull request #1 to the title of item #1/.test(action)))
})

// A checkpointed lane opens a draft pull request, and aco land refuses a draft, so the lane marks it ready before ready-to-land.
const draftRuns = [
  ['a draft is marked ready and no head action names it', { draft: true }, ['1'], false],
  ['a pull request that is not a draft gets no ready write', { draft: false }, [], false],
  ['a draft whose ready write fails names gh pr ready among the head actions', { draft: true, ready_code: 1 }, [], true],
  ['a draft flag that cannot be read names gh pr ready among the head actions', { draft: null }, [], true],
]

for (const [behaviour, scenario, readied, named] of draftRuns) {
  test(`before ready-to-land ${behaviour}`, async () => {
    const { result, readiedPulls } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, retitle: { ...scenario, item_title: 'The item title' } })
    assert.equal(result.status, 'ready-to-land')
    assert.deepEqual(readiedPulls, readied)
    assert.equal(result.requiredHeadActions.some(action => /gh pr ready 1/.test(action)), named)
  })
}

// One failed write of the retitle step names only its own head action.
const unreachableWrites = [
  ['an unreachable ready write names gh pr ready and no rename', { draft: true, ready_code: 1, ready_error: 'Could not resolve host: api.github.com' }, /gh pr ready 1/, /rename pull request/],
  ['an unreachable title write names the rename and no gh pr ready', { draft: true, pr_title: 'Unfinished checkpoint of #1', patch_code: 1, patch_error: 'Could not resolve host: api.github.com' }, /rename pull request #1/, /gh pr ready 1/],
]

for (const [behaviour, scenario, named, unnamed] of unreachableWrites) {
  test(`before ready-to-land ${behaviour}`, async () => {
    const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE, retitle: { ...scenario, item_title: 'The item title' } })
    assert.equal(result.status, 'ready-to-land')
    assert.ok(result.requiredHeadActions.some(action => named.test(action)))
    assert.ok(!result.requiredHeadActions.some(action => unnamed.test(action)))
  })
}
