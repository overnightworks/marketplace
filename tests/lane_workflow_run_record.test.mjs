// Each run stores its record on the claim as segments through aco lane-record begin and add: the first begins right after the run's input checks, each segment is added at a proven point or at the run's end, and the next begins right before its first stage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, partReplaced, resumedLane, built, resumeArgs, resumeTip, tidy, reachesTheEnd, APPROVE, satisfied, unchangedFix, PASS, greenCi, noWait, resumeFix, roundTip, roundRed, reviewedRoundFix, roundReviews, heldTester, defectWithoutDraft, storedLane } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const worktreeHead = 'ab'.repeat(20)
const FULL_SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[0-9a-f]{32}$/
const readyAnswers = { ...reachesTheEnd, 'r0-review': APPROVE }
const withFixer = { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, ...reachesTheEnd }

// The value of an option in the arguments of one aco lane-record call, or the values up to the next option.
const optionValues = (call, option) => {
  const from = call.indexOf(option)
  if (from < 0) return undefined
  const rest = call.slice(from + 1)
  const end = rest.findIndex(word => word.startsWith('--'))
  return end < 0 ? rest : rest.slice(0, end)
}
const callOf = (calls, verb) => calls.find(call => call[1] === verb)
const callsOf = (calls, verb) => calls.filter(call => call[1] === verb)
// The record as one unsplit run states it, read through the lane's own record function over the run's whole history.
const unsplitProbe = 'return JSON.stringify(laneRecord({ routing: ROUTING, history: A.history, fixRole: A.fixRole, fixRounds: fixRoundsByStage, risk: \'normal\', earlier: { follows: true, approved: [] } }))'
const unsplitOf = (run) => JSON.parse(run.result.routingLine)
const probed = { transform: partReplaced('laneRouting', unsplitProbe) }

// The stages every stored run of a lane run names, in the order the runs were added.
const ranOfRuns = (calls) => callsOf(calls, 'add').flatMap(add => optionValues(add, '--ran'))

test('run-record: a build run begins right after the branch check, with no start tip, and its add repeats the run id', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(builtLane, { build: built, 'r0-review': APPROVE })
  const begin = callOf(laneRecordCalls, 'begin')
  assert.deepEqual(begin.slice(0, 3), ['lane-record', 'begin', '1'])
  assert.match(optionValues(begin, '--run')[0], RUN_ID)
  assert.equal(optionValues(begin, '--start-tip'), undefined)
  assert.deepEqual(Object.keys(agentCalls).slice(0, 3), ['branch', 'begin', 'build'])
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'add'), '--run'), optionValues(begin, '--run'))
})

test('run-record: a build run stopped at its builder adds --ran build alone, with the worktree head as its end tip', async () => {
  const { result, laneRecordCalls } = await runLane(builtLane, { build: { blocked: true, blockedReason: 'the brief is contradictory' }, add: { head: worktreeHead } })
  assert.deepEqual([result.status, result.stage], ['escalated', 'build'])
  const add = callOf(laneRecordCalls, 'add')
  assert.deepEqual(optionValues(add, '--ran'), ['build'])
  assert.deepEqual(optionValues(add, '--end-tip'), [worktreeHead])
  assert.equal(add[3], '/s/lane-record.json')
})

test('run-record: a run started with pr and tip begins after its sync and its scope check with the synced head as start tip', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(resumeArgs, readyAnswers)
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'begin'), '--start-tip'), [resumeTip])
  assert.deepEqual(Object.keys(agentCalls).slice(0, 4), ['branch', 'sync', 'scope-resume', 'begin'])
})

test('run-record: a run that starts at a fixer begins right after its sync, before the fixer', async () => {
  const { laneRecordCalls, agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, withFixer)
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'begin'), '--start-tip'), [resumeTip])
  assert.deepEqual(Object.keys(agentCalls).slice(0, 4), ['branch', 'sync', 'begin', 'fix-1'])
})

test('run-record: a run that starts at a fixer and stops at the scope check after its fix is begun and adds --ran fix alone', async () => {
  const { result, laneRecordCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { ...withFixer, 'scope-1': { brief_error: 'aco: no such item' } })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin', 'add'])
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'add'), '--ran'), ['fix'])
})

test('run-record: a short tip reaches aco as the 40 digits git resolves', async () => {
  const shortTip = 'abcdef0'
  const { laneRecordCalls } = await runLane({ ...resumeArgs, tip: shortTip }, { ...readyAnswers, 'r0-review': { ...APPROVE } })
  const [startTip] = optionValues(callOf(laneRecordCalls, 'begin'), '--start-tip')
  const [endTip] = optionValues(callOf(laneRecordCalls, 'add'), '--end-tip')
  assert.match(startTip, FULL_SHA)
  assert.match(endTip, FULL_SHA)
  assert.ok(startTip.startsWith(shortTip))
})

for (const [name, answers] of [
  ['the sync relay line is unreadable', { sync: { printed: 'not a relay line' } }],
  ['the sync finds the tip without origin/main', { sync: { main_code: 1 } }],
  ['the sync git command fails', { sync: { head_code: 128 } }],
]) {
  test(`run-record: a run that ends at sync because ${name} is never begun and keeps the record in the abandon release`, async () => {
    const { result, laneRecordCalls } = await runLane(resumeArgs, answers)
    assert.equal(result.stage, 'sync')
    assert.deepEqual(laneRecordCalls, [])
    assert.ok(result.requiredHeadActions.some(action => action.includes('aco release 1 --abandoned REASON --record /s/lane-record.json')))
  })
}

for (const [name, args, answers, expected] of [
  ['a review and the e2e test', resumeArgs, readyAnswers, ['review', 'test']],
  ['a fixer', { ...resumeArgs, foldIn: [tidy] }, withFixer, ['review', 'fix', 'test']],
  ['a gate review', { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }, { ...readyAnswers, 'r0-gate': APPROVE }, ['review', 'test', 'gate']],
  ['a builder', builtLane, { build: built, 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }, ['build', 'review', 'test']],
]) {
  test(`run-record: a begun run with ${name} names the stages it started and no stage whose slot in the record is none`, async () => {
    const run = await runLane(args, answers)
    assert.equal(run.result.status, 'ready-to-land')
    const ran = ranOfRuns(run.laneRecordCalls)
    assert.deepEqual([...ran].sort(), [...expected].sort())
    const records = run.writtenRecords.slice(0, callsOf(run.laneRecordCalls, 'add').length).map(record => JSON.parse(record))
    records.forEach((record, index) => assert.deepEqual(optionValues(callsOf(run.laneRecordCalls, 'add')[index], '--ran').filter(stage => record.stages[stage] === 'none'), []))
    assert.deepEqual(['fix', 'test', 'gate'].filter(stage => records.some(record => record.stages[stage] !== 'none')), expected.filter(stage => ['fix', 'test', 'gate'].includes(stage)))
  })
}

test('run-record: a pr and tip run that ends at the scope check is never begun and keeps the record in the abandon release', async () => {
  const { result, laneRecordCalls } = await runLane(resumeArgs, { 'scope-resume': { brief_error: 'aco: no such item' } })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(laneRecordCalls, [])
  assert.ok(result.requiredHeadActions.some(action => action.includes('aco release 1 --abandoned REASON --record /s/lane-record.json')))
})

test('run-record: a build run that ends at the scope check adds --ran build', async () => {
  const { result, laneRecordCalls } = await runLane(builtLane, { build: built, 'scope-0': { brief_error: 'aco: no such item' }, add: { head: worktreeHead } })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin', 'add'])
  assert.deepEqual(optionValues(callOf(laneRecordCalls, 'add'), '--ran'), ['build'])
})

test('run-record: a refused begin ends the run awaiting-head at record with aco\'s refusal and starts no agent after its input checks', async () => {
  const refusal = 'run r was added already; it cannot be begun again'
  const { result, launchedAgents, laneRecordCalls } = await runLane(resumeArgs, { begin: { begin_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.deepEqual(launchedAgents, ['sync', 'scope-resume'])
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin'])
})

test('run-record: an add refused at a proven point ends the run awaiting-head at record before the next stage and offers no landing', async () => {
  const refusal = 'only the holder may add a run to #1'
  const { result, launchedAgents } = await runLane(resumeArgs, { ...readyAnswers, add: { add_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.ok(!launchedAgents.includes('e2e-0'))
  assert.deepEqual((result.requiredHeadActions ?? []).filter(action => action.includes('aco land')), [])
})

test('run-record: a refused add keeps the status and reason the run would have ended with in the reason, and the run adds once', async () => {
  const refusal = 'the stored runs of #1 were written since this command read them'
  const { result, laneRecordCalls } = await runLane(resumeArgs, { 'r0-review': { verdict: 'architectural', blocking: [], followups: [] }, add: { add_error: refusal } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.ok(result.reason.includes(refusal))
  assert.match(result.reason, /escalated.*review.*architectural verdict/)
  assert.equal(laneRecordCalls.filter(call => call[1] === 'add').length, 1)
})

test('run-record: a run whose end tip git cannot resolve ends awaiting-head at record without calling aco add', async () => {
  const { result, laneRecordCalls } = await runLane(resumeArgs, { ...readyAnswers, add: { resolve_code: 128 } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.match(result.reason, /Needed a single revision/)
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin'])
})

for (const [name, answer, expected] of [
  ['unreadable line', { printed: 'not a relay line' }, /is not a relay line/],
  ['missing answer', null, /ended without a result/],
]) {
  test(`run-record: a begin whose relay has a ${name} ends the run awaiting-head at record`, async () => {
    const { result } = await runLane(resumeArgs, { begin: answer })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
    assert.match(result.reason, expected)
  })

  test(`run-record: an add whose relay has a ${name} ends the run awaiting-head at record`, async () => {
    const { result } = await runLane(resumeArgs, { ...readyAnswers, add: answer })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
    assert.match(result.reason, expected)
  })
}

test('run-record: the landing action of a stored run goes without --record', async () => {
  const { result } = await runLane(resumeArgs, readyAnswers)
  assert.equal(result.status, 'ready-to-land')
  assert.ok(result.requiredHeadActions.includes(`land with \`aco land 1 --head ${resumeTip}\` only while the pull request head is still ${resumeTip}`))
  assert.ok(result.requiredHeadActions.every(action => !action.includes('--record')))
})

test('run-record: the abandon action of a begun run goes without --record', async () => {
  const { result } = await runLane(builtLane, { build: built, 'scope-0': { brief_error: 'aco: no such item' } })
  assert.ok(result.requiredHeadActions.includes('to abandon the lane instead, run `aco release 1 --abandoned REASON`'))
})

test('run-record: the check-run action of a CI that cannot be read goes without --record', async () => {
  const unreachable = { network_error: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)', network_fails: 'always' }
  const { result } = await runLane(resumeArgs, { ...readyAnswers, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip), 'ci-read-0': unreachable }, noWait)
  const action = result.requiredHeadActions.find(entry => entry.includes('check-runs'))
  assert.ok(action, JSON.stringify(result.requiredHeadActions))
  assert.ok(action.includes(`aco land 1 --head ${resumeTip}`) && !action.includes('--record'))
})

test('run-record: the minted run id is the one of the branch relay line in the first segment\'s begin and add, and the second segment\'s begin adds its number', async () => {
  const { laneRecordCalls, agentCalls } = await runLane(resumeArgs, { 'r0-review': APPROVE }, { killAt: 'e2e-0' })
  const [runId] = optionValues(callOf(laneRecordCalls, 'begin'), '--run')
  assert.ok(agentCalls.add.prompt.includes(`'${runId}'`))
  assert.ok(agentCalls.begin.prompt.includes(`'${runId}-2'`))
})

// A run killed at the launch of an agent leaves the segments stored before it: each proven point added its segment with the verdict it proved at that tip.
const materialArgs = { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }
const recordAdded = (run, index) => JSON.parse(run.writtenRecords[index])
const approvalAt = (stage, sha) => ({ stage, verdict: 'approve', sha })

for (const [name, args, answers, killAt, stored] of [
  ['a review approval', resumeArgs, { 'r0-review': APPROVE }, 'e2e-0', [{ ran: ['review'], verdicts: [approvalAt('review', resumeTip)] }]],
  ['a gate approval on a material lane', materialArgs, { 'r0-review': APPROVE, 'r0-gate': APPROVE }, 'e2e-0', [{ ran: ['review', 'gate'], verdicts: [approvalAt('review', resumeTip), approvalAt('gate', resumeTip)] }]],
  ['the tester\'s pass', resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }, 'record-3', [{ ran: ['review'], verdicts: [approvalAt('review', resumeTip)] }, { ran: ['test'], verdicts: [] }]],
]) {
  test(`run-record: a run killed after ${name} leaves stored runs that carry it at its tip`, async () => {
    const run = await runLane(args, answers, { killAt })
    assert.equal(run.killed, true)
    const adds = callsOf(run.laneRecordCalls, 'add')
    assert.deepEqual(adds.map(add => optionValues(add, '--ran')), stored.map(segment => segment.ran))
    adds.forEach(add => assert.deepEqual(optionValues(add, '--end-tip'), [resumeTip]))
    stored.forEach((segment, index) => assert.deepEqual(recordAdded(run, index).verdicts, segment.verdicts))
  })
}

test('run-record: a run killed after a proven point leaves a begun run without a record only once its next stage began', async () => {
  const atReview = await runLane(resumeArgs, { 'r0-review': APPROVE }, { killAt: 'r0-review' })
  assert.deepEqual(atReview.laneRecordCalls.map(call => call[1]), ['begin'])
  const atTester = await runLane(resumeArgs, { 'r0-review': APPROVE }, { killAt: 'e2e-0' })
  assert.deepEqual(atTester.laneRecordCalls.map(call => call[1]), ['begin', 'add', 'begin'])
})

// Review approves, the tester fails, a fix goes through a second review, and a second tester passes: three proven points on one run.
const testerFinding = { where: 'flow.py:9', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
const fixedTip = roundTip(3)
const segmentedAnswers = {
  'r0-review': APPROVE, 'e2e-0': { verdict: 'FAIL', blocking: [testerFinding], followups: [] }, 'ci-0': greenCi(resumeTip),
  'fix-1': { ...resumeFix, head: fixedTip, parents: [resumeTip], files: ['flow.py'], regression: [{ finding: 1, test: 't.py::t', failedBefore: true, passesAfter: true }] },
  'r1-review': APPROVE, 'e2e-1': PASS, 'ci-1': greenCi(fixedTip),
}

test('run-record: the stored runs of a segmented lane sum to the totals and the verdicts of one unsplit run', async () => {
  const run = await runLane(resumeArgs, segmentedAnswers, probed)
  assert.equal(run.result.status, 'ready-to-land', run.result.reason)
  assert.equal(callsOf(run.laneRecordCalls, 'add').length, 3)
  const stored = storedLane(run)
  for (const kind of ['fix_rounds', 'blocking', 'misses', 'verdicts']) assert.deepEqual(stored[kind], unsplitOf(run)[kind])
  assert.deepEqual(stored.verdicts.map(verdict => verdict.sha), [resumeTip, fixedTip])
  assert.deepEqual(stored.misses, { review: 0, gate: 0, ci: 0, test: 1 })
})

test('run-record: each segment of a lane begins at the end tip of the one before and its id derives from the run\'s minted id', async () => {
  const { laneRecordCalls } = await runLane(resumeArgs, segmentedAnswers)
  const begins = callsOf(laneRecordCalls, 'begin')
  const adds = callsOf(laneRecordCalls, 'add')
  assert.deepEqual([begins.length, adds.length], [3, 3])
  const [first] = optionValues(begins[0], '--run')
  assert.match(first, RUN_ID)
  assert.deepEqual(begins.map(begin => optionValues(begin, '--run')[0]), [first, `${first}-2`, `${first}-3`])
  assert.deepEqual(adds.map(add => optionValues(add, '--run')[0]), [first, `${first}-2`, `${first}-3`])
  assert.deepEqual(begins.map(begin => optionValues(begin, '--start-tip')?.[0]), [resumeTip, resumeTip, fixedTip])
  assert.deepEqual(adds.map(add => optionValues(add, '--end-tip')[0]), [resumeTip, fixedTip, fixedTip])
  assert.deepEqual(adds.map(add => optionValues(add, '--ran')), [['review'], ['review', 'fix', 'test'], ['test']])
})

test('run-record: a segment that started no stage since the last proven point stores nothing and begins no next segment at the run\'s end', async () => {
  const { laneRecordCalls, result } = await runLane(resumeArgs, { ...readyAnswers, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(laneRecordCalls.map(call => call[1]), ['begin', 'add', 'begin', 'add'])
  assert.equal(result.record, '/s/lane-record.json')
})

test('run-record: a run killed after a proven point while the tester runs leaves a begun run that counts the tester\'s stage once it answers', async () => {
  const tester = heldTester()
  const answers = { 'r0-review': APPROVE, 'e2e-0': tester.answer, 'ci-0': roundRed(0), 'fix-1': reviewedRoundFix(1), 'r1-review': APPROVE }
  const run = await runLane(resumeArgs, answers, { killAt: 'ci-1' })
  assert.equal(run.killed, true)
  assert.deepEqual(run.laneRecordCalls.map(call => call[1]), ['begin', 'add', 'begin', 'add', 'begin'])
  assert.deepEqual(callsOf(run.laneRecordCalls, 'add').map(add => optionValues(add, '--ran')), [['review'], ['review', 'fix']])
})

test('run-record: the tester\'s findings and the CI findings that come after a proven point reach the stored runs when the run ends without another stage', async () => {
  const tester = heldTester()
  const late = { where: 'flow.py:9', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
  const answers = { ...roundReviews, 'r0-review': APPROVE, 'e2e-0': tester.answer, 'ci-0': roundRed(0), 'ci-1': roundRed(1, () => tester.resolve({ verdict: 'FAIL', blocking: [late], followups: [] })), 'fix-1': reviewedRoundFix(1) }
  const run = await runLane({ ...resumeArgs, budgets: { ci: 1 } }, answers, probed)
  assert.equal(run.result.status, 'ci-red', run.result.reason)
  const stored = storedLane(run)
  assert.deepEqual(stored.blocking, { review: 0, gate: 0, ci: 2, test: 1 })
  for (const kind of ['fix_rounds', 'blocking', 'misses', 'verdicts']) assert.deepEqual(stored[kind], unsplitOf(run)[kind])
})

test('run-record: a CI finding read after a proven point reaches the stored runs when the run then ends without a fixer', async () => {
  const answers = { ...roundReviews, 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': roundRed(0), 'ci-1': roundRed(1), 'fix-1': reviewedRoundFix(1) }
  const run = await runLane({ ...resumeArgs, budgets: { ci: 1 } }, answers, probed)
  assert.equal(run.result.status, 'ci-red', run.result.reason)
  assert.equal(storedLane(run).blocking.ci, 2)
  for (const kind of ['fix_rounds', 'blocking', 'misses', 'verdicts']) assert.deepEqual(storedLane(run)[kind], unsplitOf(run)[kind])
})

test('run-record: a finding that comes back after a proven point counts once in the stored runs, as in one unsplit run', async () => {
  const secondTip = roundTip(4)
  const answers = {
    ...segmentedAnswers, 'e2e-1': { verdict: 'FAIL', blocking: [{ ...testerFinding, text: 'the flow still loses data' }], followups: [] },
    'fix-2': { ...resumeFix, head: secondTip, parents: [fixedTip], files: ['flow.py'], regression: [{ finding: 1, test: 't.py::t', failedBefore: true, passesAfter: true }] },
    'r2-review': APPROVE, 'e2e-2': PASS, 'ci-1': greenCi(fixedTip), 'ci-2': greenCi(secondTip),
  }
  const run = await runLane(resumeArgs, answers, probed)
  assert.equal(run.result.status, 'ready-to-land', run.result.reason)
  assert.equal(storedLane(run).blocking.test, 1)
  for (const kind of ['fix_rounds', 'blocking', 'misses', 'verdicts']) assert.deepEqual(storedLane(run)[kind], unsplitOf(run)[kind])
})

test('run-record: a review approval beside a gate revision on a material lane is stored before the fixer starts', async () => {
  const answers = { 'r0-review': APPROVE, 'r0-gate': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] } }
  const run = await runLane(materialArgs, answers, { killAt: 'fix-1' })
  assert.equal(run.killed, true)
  assert.deepEqual(run.laneRecordCalls.map(call => call[1]), ['begin', 'add', 'begin'])
  assert.deepEqual(recordAdded(run, 0).verdicts, [approvalAt('review', resumeTip), { stage: 'gate', verdict: 'revise', sha: resumeTip }])
})

test('run-record: a review revision beside a gate approval on a material lane is not stored before the fixer starts, so a killed run lands on no approval of the revised tip', async () => {
  const answers = { 'r0-review': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }, 'r0-gate': APPROVE }
  const run = await runLane(materialArgs, answers, { killAt: 'fix-1' })
  assert.equal(run.killed, true)
  assert.deepEqual(run.laneRecordCalls.map(call => call[1]), ['begin'])
  assert.deepEqual(run.writtenRecords, [])
})

test('run-record: the CI findings read with the tester\'s pass reach the stored runs when the run then ends without a fixer', async () => {
  const run = await runLane({ ...resumeArgs, budgets: { ci: 0 } }, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': roundRed(0) }, probed)
  assert.equal(run.result.status, 'ci-red', run.result.reason)
  assert.equal(storedLane(run).blocking.ci, 1)
  assert.deepEqual(storedLane(run).blocking, unsplitOf(run).blocking)
})
