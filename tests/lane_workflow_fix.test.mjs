// Drives the atelier lane workflow script through the fixer, fold-in, proof and removal rules with a stub agent runner.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, APPROVE, PASS, greenCi, finding, followup, webauthTips, webauthReplay, agentProvidersReplay, replays, answersWith, outOfRange, mainMovedTip, mergedOnlyTip, resumeTip, olderTip, resumeFixedTip, tidy, defectWithoutDraft, resumeFix, mergeOnlyFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, testGap, built, secondFix, docsFinding, proofOf } from './lane_workflow_harness.mjs'

const proofsByKind = [
  ['a resumed run whose findings carry no kind stops at the fix as before', { kind: undefined, testDraft: true, mutation: true }, false],
  ['a defect with a test draft whose test did not fail before stops at the fix', { kind: 'defect', testDraft: true, mutation: true }, false],
  ['a test-gap whose only proof is numbered for a neighbouring finding stops at the fix', { kind: 'test-gap', mutation: true, proofNumber: 2 }, false],
  ['a test-gap whose test failed on the pre-fix code needs no named mutation and moves past the fix', { kind: 'test-gap', mutation: false, failedBefore: true }, true],
  ['a test-gap with no mutation field and no test text stops at the fix', { kind: 'test-gap', mutation: false, emptyTest: true }, false],
  ['a test-gap with no mutation field but test text moves past the fix to the raiser', { kind: 'test-gap', mutation: false }, true],
  ['a test-gap whose test does not pass after the fix stops at the fix', { kind: 'test-gap', mutation: true, passesAfter: false }, false],
  ['a test-gap without any proof stops at the fix', { kind: 'test-gap', proof: 'omitted' }, false],
  ['a test-gap whose proof is numbered one past the list stops at the fix', { kind: 'test-gap', mutation: true, proofNumber: outOfRange }, false],
  ['a test-gap proven by a named mutation moves past the fix', { kind: 'test-gap', mutation: true }, true],
  ['a failing proof numbered past the blocking list is ignored and the run moves past the fix', { kind: 'test-gap', mutation: true, strayProof: true }, true],
  ['a hygiene defect proven by the diff needs no mutation and moves past the fix', { kind: 'defect', mutation: false, proof: 'omitted' }, true],
  ['a docs finding needs no test and moves past the fix', { kind: 'docs', mutation: false }, true],
  ['a docs finding with a test draft needs no test either and moves past the fix', { kind: 'docs', testDraft: true, proof: 'omitted' }, true],
]

for (const [behaviour, labels, movesOn] of proofsByKind) {
  test(behaviour, async () => {
    const replay = webauthReplay
    const { result, launchedAgents } = await runLane(replay.args, answersWith(replay, labels))
    if (movesOn) {
      assert.equal(result.status, 'ready-to-land')
      assert.ok(launchedAgents.includes(replay.nextReview))
    } else {
      assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
      assert.deepEqual(result.lastBlocking.map(f => f.where), [replay.testGap.where])
    }
  })
}

const fixOutcomes = [
  ['accepted', { kind: 'test-gap', mutation: true }],
  ['stopped', { kind: undefined, testDraft: true, mutation: false }],
]

for (const replay of replays) {
  for (const [outcome, labels] of fixOutcomes) {
    test(`a fold-in counts as folded, with its tip, only once its fix is accepted (${outcome} fix, ${replay.nextReview} next)`, async () => {
      const { result } = await runLane(replay.args, answersWith(replay, labels))
      const expected = replay.foldIns[outcome]
      const openWheres = result.followups.map(f => f.where)
      assert.deepEqual(result.folded.map(f => [f.where, f.tip]), expected.folded)
      for (const [where] of expected.folded) assert.ok(!openWheres.includes(where), `${where} is still open`)
      for (const where of expected.open) assert.ok(openWheres.includes(where), `${where} is not open`)
    })
  }

  test(`a ready lane (${replay.nextReview} next) asks the head to route only the follow-ups still open`, async () => {
    const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
    assert.equal(result.followups.length, replay.followupsToRoute)
    assert.ok(result.requiredHeadActions.includes(`route ${replay.followupsToRoute} follow-up(s) to their owning items before landing`))
  })
}

test('a fix that only merged main with a fold-in ends awaiting-head, folds nothing in and leaves the fold-in open', async () => {
  const built = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
  const merged = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
  const foldIn = followup('x.py:1', 'tidy', 'distributor', true)
  const conflicting = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }
  const { result } = await runLane({ ...webauthReplay.args, build: 'b' }, {
    build: { pr: 2, tip: built, blocked: false },
    'r0-review': APPROVE,
    'r0-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': { ...PASS, followups: [foldIn] },
    'ci-0': { head: built, green: false, failing: [conflicting] },
    'fix-1': { head: merged, parents: [built, 'e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4'], mergeResolvedLaneConflict: false, files: [], disputed: [], blocked: false },
    'ci-1': greenCi(merged),
  })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.deepEqual(result.folded, [])
  assert.deepEqual(result.followups, [{ ...foldIn, stage: 'test', tip: built }])
})

test('a stopped fix reports the fold-ins its fixer found already done, and leaves them open', async () => {
  const replay = agentProvidersReplay
  const answers = answersWith(replay, { kind: undefined, testDraft: true, mutation: false })
  const resolved = [{ where: replay.foldIns.stopped.open[0], text: 'done by an earlier fixer' }]
  answers[replay.testGap.fixedBy].resolved = resolved
  const { result } = await runLane(replay.args, answers)
  assert.deepEqual(result.resolved, resolved)
  assert.ok(result.followups.some(f => f.where === resolved[0].where))
})

const fixBatchRouting = [
  ['only docs findings', { fixFirst: [docsFinding] }, 'haiku', 'low'],
  ['docs findings plus a defect', { fixFirst: [docsFinding, defectWithoutDraft] }, 'sonnet', 'medium'],
  ['docs findings plus a fold-in', { fixFirst: [docsFinding], foldIn: [tidy] }, 'sonnet', 'medium'],
]

for (const [batch, handedOver, model, effort] of fixBatchRouting) {
  test(`a fix batch with ${batch} runs on ${model} at ${effort} effort`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, ...handedOver }, { 'fix-1': resumeFix })
    assert.deepEqual([agentCalls['fix-1'].options.model, agentCalls['fix-1'].options.effort], [model, effort])
  })
}

const resumesByHandedOver = [
  ['foldIn alone', { foldIn: [tidy] }, ['sync', 'fix-1', 'scope-1', 'r1-review']],
  ['foldIn alone with deltaFrom', { foldIn: [tidy], deltaFrom: olderTip }, ['sync', 'fix-1', 'scope-1', 'r1-review']],
  ['neither foldIn nor fixFirst', {}, ['sync', 'scope-resume', 'r0-review']],
]

for (const [handedOver, args, expectedAgents] of resumesByHandedOver) {
  test(`a resume with ${handedOver} runs ${expectedAgents.slice(1).join(' then ')}`, async () => {
    const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, ...args }, { 'fix-1': resumeFix })
    assert.deepEqual(launchedAgents.slice(0, expectedAgents.length), expectedAgents)
    if (args.foldIn) assert.match(agentCalls['fix-1'].prompt, /tidy the import order/)
  })
}

test('a resume gives the fixer every foldIn the head names, whatever its owner or wording', async () => {
  const named = followup('x.py:1', 'tidy the import order', '#57')
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [named] }, { 'fix-1': resumeFix })
  assert.match(agentCalls['fix-1'].prompt, /tidy the import order/)
})

test('a fixer given only fold-ins is told there are no blocking findings', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': resumeFix })
  assert.match(agentCalls['fix-1'].prompt, /There are no blocking findings; your whole task is the follow-ups below/)
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /and nothing else/)
})

const alsoTidy = followup('y.py:2', 'rename the helper', 'distributor')

const satisfiedFoldIns = [
  ['one fold-in', [tidy], [satisfied(tidy)]],
  ['two fold-ins', [tidy, alsoTidy], [satisfied(tidy), satisfied(alsoTidy, 'probe cell 4 proves it')]],
]

for (const [what, foldIn, resolved] of satisfiedFoldIns) {
  test(`${what} the fixer proves already satisfied at an unchanged tip are folded with its evidence and the lane goes on`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn }, { 'fix-1': { ...unchangedFix, resolved }, ...reachesTheEnd })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.deepEqual(result.folded, foldIn.map((f, i) => ({ ...f, tip: resumeTip, evidence: resolved[i].evidence })))
    assert.deepEqual(result.followups, [])
    assert.ok(launchedAgents.includes('r1-review') && launchedAgents.includes('e2e-0'))
  })
}

// A round without blocking findings asks for no merge of main, so main moving neither fails a satisfied fold-in nor excuses a merge.
const satisfiedAcrossMovedMain = [
  ['a merge of main and no change of its own', { head: mainMovedTip, parents: [resumeTip, mergedOnlyTip] }, false],
  ['main moved and the tip left where it was', { head: resumeTip, main_code: 1 }, true],
]

for (const [what, shape, goesOn] of satisfiedAcrossMovedMain) {
  test(`every fold-in satisfied with ${what} ${goesOn ? 'goes on with the tip unchanged' : 'is rejected as unasked work'}`, async () => {
    const answers = { 'fix-1': { ...unchangedFix, ...shape, resolved: [satisfied(tidy)] }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(shape.head) }
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn: [tidy] }, answers)
    assert.deepEqual([result.status, result.stage], goesOn ? ['ready-to-land', undefined] : ['failed', 'fix'])
    assert.equal(launchedAgents.includes('r1-review'), goesOn)
    if (goesOn) assert.deepEqual(result.folded.map(f => f.tip), [resumeTip])
  })
}

test('a fixer that changes nothing and shows every carried finding resolved with evidence reaches the review of the earlier commits', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...unchangedFix, resolved: [satisfied(defectWithoutDraft, undefined, 1)] }, ...reachesTheEnd })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.includes('r1-review'))
})

test('an unchanged tip with every finding resolved and deltaFrom at the tip reviews the whole lane, never an empty range', async () => {
  const { result, agentCalls } = await runLane({ ...resumeArgs, deltaFrom: resumeTip, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...unchangedFix, resolved: [satisfied(defectWithoutDraft, undefined, 1)] }, ...reachesTheEnd })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.match(agentCalls['r1-review'].prompt, /git diff origin\/main\.\.\.HEAD/)
  assert.doesNotMatch(agentCalls['r1-review'].prompt, new RegExp(`git diff ${resumeTip}\\.\\.HEAD`))
})

for (const [what, evidence] of [['without evidence', ''], ['with blank evidence', '  ']]) {
  test(`a blocking finding claimed resolved ${what} at an unchanged tip still stops with the fixer changed nothing`, async () => {
    const { result } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...unchangedFix, resolved: [satisfied(defectWithoutDraft, evidence, 1)] } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, /the fixer changed nothing/)
  })
}

const alsoDefect = { ...finding('u.py:2', 'the code breaks another rule'), kind: 'defect' }
const dispute = (item, finding) => ({ finding, where: item.where, text: item.text, counterEvidence: 'the rule is not broken' })

const sharedWhere = { ...alsoDefect, where: defectWithoutDraft.where }
const twoCarriedFindings = [
  ['one finding resolved and the other left out of resolved', [satisfied(defectWithoutDraft, undefined, 1)], [], 'failed', /the fixer changed nothing/],
  ['one finding resolved and the other resolved without evidence', [satisfied(defectWithoutDraft, undefined, 1), satisfied(alsoDefect, '', 2)], [], 'failed', /the fixer changed nothing/],
  ['both resolved with evidence and one also disputed', [satisfied(defectWithoutDraft, undefined, 1), satisfied(alsoDefect, undefined, 2)], [dispute(alsoDefect, 2)], 'awaiting-head', /./],
  ['one entry answering only the first of two findings that share a where', [satisfied(defectWithoutDraft, undefined, 1)], [], 'failed', /the fixer changed nothing/, [defectWithoutDraft, sharedWhere]],
]

for (const [what, resolved, disputed, status, reason, findings = [defectWithoutDraft, alsoDefect]] of twoCarriedFindings) {
  test(`two carried findings with ${what} are not accepted as a fix at an unchanged tip`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: findings }, { 'fix-1': { ...unchangedFix, resolved, disputed } })
    assert.equal(result.status, status)
    assert.match(result.reason, reason)
    assert.ok(!launchedAgents.includes('r1-review'))
  })
}

test('a fixer that changes nothing and shows a review finding resolved with evidence stops with the fixer changed nothing', async () => {
  const answers = { 'r0-review': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }, 'fix-1': { ...unchangedFix, resolved: [satisfied(defectWithoutDraft, undefined, 1)] } }
  const { result } = await runLane(resumeArgs, answers)
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.match(result.reason, /the fixer changed nothing/)
  assert.deepEqual(result.resolved, [satisfied(defectWithoutDraft, undefined, 1)])
})

test('a fixer that changes nothing and shows a CI finding resolved with evidence stops with the fixer changed nothing', async () => {
  const ci = finding('ci: lint', 'ruff fails')
  const answers = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { ...greenCi(resumeTip), green: false, failing: [ci] }, 'fix-1': { ...unchangedFix, resolved: [satisfied(ci, undefined, 1)] } }
  const { result, launchedAgents } = await runLane(resumeArgs, answers)
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.match(result.reason, /the fixer changed nothing/)
  assert.ok(!launchedAgents.includes('r1-review'))
})

const stopsDespiteResolved = [
  ['a fold-in the fixer leaves out of resolved', { foldIn: [tidy, alsoTidy] }, [satisfied(tidy)]],
  ['nothing listed in resolved', { foldIn: [tidy] }, []],
  ['a fold-in listed without evidence', { foldIn: [tidy] }, [satisfied(tidy, '')]],
  ['a fold-in listed with blank evidence', { foldIn: [tidy] }, [satisfied(tidy, '  ')]],
  ['blocking findings, however much the fixer lists', { foldIn: [tidy], fixFirst: [defectWithoutDraft] }, [satisfied(tidy)]],
]

for (const [what, args, resolved] of stopsDespiteResolved) {
  test(`a fixer that changes nothing with ${what} still stops at fix`, async () => {
    const { result } = await runLane({ ...resumeArgs, ...args }, { 'fix-1': { ...unchangedFix, resolved } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, /the fixer changed nothing/)
    assert.deepEqual(result.folded, [])
    assert.ok(result.followups.some(f => f.where === tidy.where))
  })
}

test('a batch with one fold-in committed and one already satisfied folds both, the satisfied one with its evidence', async () => {
  const resolved = [satisfied(alsoTidy)]
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy, alsoTidy] }, { 'fix-1': { ...resumeFix, resolved }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(result.folded, [{ ...tidy, tip: resumeFixedTip }, { ...alsoTidy, tip: resumeFixedTip, evidence: resolved[0].evidence }])
})

test('the fixer is told to list every fold-in already done with its evidence, and the schema requires it', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': resumeFix })
  const { prompt, options } = agentCalls['fix-1']
  assert.match(prompt, /already satisfied[^]*resolved[^]*evidence/)
  assert.ok(options.schema.properties.resolved.items.required.includes('evidence'))
})

const reviewReviseAnswers = (followups) => ({
  'r0-review': { verdict: 'REVISE', blocking: [{ ...finding('y.py:2', 'a defect'), kind: 'docs' }], followups },
  'fix-1': { ...resumeFix, regression: [] },
  'r1-review': APPROVE,
})

const deltaRangesByFoldIns = [
  ['names the fold-in the fixer was given', [{ ...tidy, inPlace: true }], true],
  ['has no fold-in section when the fixer was given none', [], false],
]

for (const [behaviour, followups, namesFoldIn] of deltaRangesByFoldIns) {
  test(`the re-checking reviewer's delta range ${behaviour}`, async () => {
    const { agentCalls } = await runLane(resumeArgs, reviewReviseAnswers(followups))
    const recheckPrompt = agentCalls['r1-review'].prompt
    assert.match(recheckPrompt, /only this delta, the fixer's own commits: git log -p --first-parent --remerge-diff/)
    assert.equal(/tidy the import order/.test(recheckPrompt), namesFoldIn)
    assert.equal(/these follow-ups to fold in/.test(recheckPrompt), namesFoldIn)
  })
}

test('a follow-up carries the tip it was raised at, and the result lists those raised before the returned tip separately', async () => {
  const replay = webauthReplay
  const raisedAtReturnedTip = followup('late.py:1', 'raised by the review of the returned tip', '#57')
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['r2-review'] = { ...APPROVE, followups: [raisedAtReturnedTip] }
  const { result } = await runLane(replay.args, answers)
  assert.equal(result.tip, webauthTips.secondFix)
  const raisedAt = Object.fromEntries(result.followups.map(f => [f.where, f.tip]))
  assert.equal(raisedAt[raisedAtReturnedTip.where], webauthTips.secondFix)
  assert.equal(raisedAt['AGENTS.md:35-38 / .importlinter'], webauthTips.built)
  assert.equal(result.followups.length, replay.followupsToRoute + 1)
  const earlier = result.raisedBeforeTip.map(f => f.where)
  assert.ok(earlier.includes('AGENTS.md:35-38 / .importlinter'))
  assert.ok(!earlier.includes(raisedAtReturnedTip.where))
})

// A resumed run whose fixer answers findings handed over by the head: what each proof must show for its own finding.

const defectWithDraft = { ...finding('t.py:1', 'the code breaks the rule'), kind: 'defect', testDraft: '/s/draft_test.py' }

const rejectedForNoProof = /test-gap finding or a defect with a test draft got no regression test/

const proofsByNumber = [
  ['a defect and a test-gap at one where, each with its own number, are each accepted', [defectWithDraft, testGap], [proofOf(1, { failedBefore: true }), proofOf(2, { mutation: 'drop the guard' })], null],
  ['a proof numbered for the neighbouring finding does not prove this one', [defectWithDraft, testGap], [proofOf(1, { failedBefore: true })], rejectedForNoProof],
  ['a test-gap test that failed before the fix needs no mutation', [testGap], [proofOf(1, { failedBefore: true })], null],
  ['a test-gap test without any text and without a mutation is rejected naming its where and the mutation', [testGap], [proofOf(1, { test: ' ' })], /t\.py:1.*no mutation/],
  ['a test-gap test whose text carries the mutation and whose mutation field is empty is not rejected', [testGap], [proofOf(1, { test: 't.py [case]; mutation made and reverted: drop the guard' })], null],
  ['a test-gap test with a mutation that does not pass after is rejected as not passing', [testGap], [proofOf(1, { mutation: 'drop the guard', passesAfter: false })], /t\.py:1.*did not pass/],
  ['a defect without a test draft needs no failing-before test', [defectWithoutDraft], [proofOf(1)], null],
  ['a defect with a test draft still needs its test to fail before', [defectWithDraft], [proofOf(1)], /did not fail before/],
  ['a removal without a copied diff whose commits touch its path answers a test-gap', [testGap], [proofOf(1, { resolution: 'removed' })], null],
  ['a removal whose commits touch its path answers a defect with a test draft without a failing-first test', [defectWithDraft], [proofOf(1, { resolution: 'removed', passesAfter: false })], null],
  ['a removal in a range that carries no diff is rejected, with a copied diff too', [testGap], [proofOf(1, { resolution: 'removed', diff: '-copied' })], /t\.py:1.*no diff/, []],
  ['a removal in a range that carries no diff does not answer a defect with a test draft', [defectWithDraft], [proofOf(1, { resolution: 'removed' })], /t\.py:1.*no diff/, []],
  ['a removal whose path is untouched but whose range carries a diff answers a test-gap', [testGap], [proofOf(1, { resolution: 'removed' })], null, ['pyproject.toml']],
  ['a removal whose path is untouched but whose range carries a diff answers a defect with a test draft', [defectWithDraft], [proofOf(1, { resolution: 'removed', passesAfter: false })], null, ['pyproject.toml']],
  ['a behaviour-changing defect fix without its test is still rejected', [defectWithDraft], [], rejectedForNoProof],
  ['a number pointing at a docs finding adds no pass for the test-gap behind it', [docsFinding, testGap], [proofOf(1)], rejectedForNoProof],
  ['two proofs for one number, one of them bad, are still rejected', [testGap], [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { mutation: 'drop the guard', passesAfter: false })], /did not pass/],
  ['a defect with a test draft whose red entry is followed by a valid proof is accepted', [defectWithDraft], [proofOf(1, { failedBefore: true, passesAfter: false }), proofOf(1, { failedBefore: true })], null],
  ['a defect with a test draft whose valid proof is followed by a red entry is rejected', [defectWithDraft], [proofOf(1, { failedBefore: true }), proofOf(1, { failedBefore: true, passesAfter: false })], /did not pass after its fix$/],
  ['a test-gap whose red entry is followed by a valid proof is accepted', [testGap], [proofOf(1, { mutation: 'drop the guard', passesAfter: false }), proofOf(1, { mutation: 'drop the guard' })], null],
  ['a test-gap whose valid proof is followed by a red entry is rejected', [testGap], [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { mutation: 'drop the guard', passesAfter: false })], /t\.py:1.*did not pass/],
  ['a not-run proof is no gap for a defect without a test draft', [defectWithoutDraft], [proofOf(1, { passesAfter: false, notRun: 'the probe stack was held by another lane' })], null],
  ['a not-run proof for a defect with a test draft goes on to the delta re-check', [defectWithDraft], [proofOf(1, { passesAfter: false, notRun: 'the probe stack was held by another lane' })], null],
  ['a not-run proof for a test-gap goes on to the delta re-check', [testGap], [proofOf(1, { passesAfter: false, notRun: 'permission refused' })], null],
  ['a test run red after the fix is refused as not passing, not as not failing before', [defectWithoutDraft], [proofOf(1, { passesAfter: false })], /did not pass after its fix$/],
  ['a defect with a test draft that passed after but did not fail before is refused for the missing half only', [defectWithDraft], [proofOf(1)], /did not fail before its fix$/],
  ...[0, 1.5, '1', 2].map(number => [`a proof numbered ${JSON.stringify(number)} is ignored and the test-gap stays unproven`, [testGap], [proofOf(number, { mutation: 'drop the guard' })], rejectedForNoProof]),
]

for (const [behaviour, fixFirst, regression, rejectedFor, touched = ['t.py']] of proofsByNumber) {
  test(`proof guard: ${behaviour}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst }, { 'fix-1': { ...resumeFix, regression, touched_paths: touched } })
    if (rejectedFor) {
      assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
      assert.match(result.reason, rejectedFor)
    } else {
      assert.ok(launchedAgents.includes('r1-review'))
    }
  })
}

test('a proof numbered 1 is judged as blocking finding 1 whatever it covers, and the fixer sees the fold-ins unnumbered', async () => {
  const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap], foldIn: [tidy] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { test: 'the fold-in test', passesAfter: false })] } })
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.deepEqual(result.lastBlocking.map(f => f.where), [testGap.where])
  const { prompt } = agentCalls['fix-1']
  assert.match(prompt, /^1\. t\.py:1 — a behaviour has no test$/m)
  assert.match(prompt, /^- x\.py:1 — tidy the import order$/m)
  assert.doesNotMatch(prompt, /^\d+\. x\.py:1/m)
  assert.match(prompt, /a follow-up needs no regression entry/)
  assert.match(prompt, /a probe you saw fail and then acted on is reported before the entry that passes, and the last entry per finding is its proof/)
})

test('the numbers in the fixer prompt are the ones a proof is judged by, on a CI fix as on the first fix', async () => {
  const { agentCalls: first } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft, testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(2, { mutation: 'drop the guard' })] } })
  assert.match(first['fix-1'].prompt, /^2\. t\.py:1 — a behaviour has no test$/m)
  const ci = { head: resumeTip, green: false, failing: [defectWithoutDraft, testGap] }
  const { agentCalls: viaCi, result } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': ci, 'r1-review': APPROVE, 'fix-1': { ...resumeFix, regression: [proofOf(2, { mutation: 'drop the guard' })] }, 'ci-1': greenCi(resumeFixedTip) })
  assert.match(viaCi['fix-1'].prompt, /^2\. t\.py:1 — a behaviour has no test$/m)
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('the fixer schema takes the finding as an integer from 1 and carries no kind', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { mutation: 'm' })] } })
  const proofItem = agentCalls['fix-1'].options.schema.properties.regression.items
  assert.deepEqual([proofItem.properties.finding.type, proofItem.properties.finding.minimum], ['integer', 1])
  assert.equal(proofItem.properties.kind, undefined)
  assert.ok(!proofItem.required.includes('kind'))
})

test('the fixer schema requires regression, so a report that leaves it out is refused by the schema', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { mutation: 'm' })] } })
  assert.ok(agentCalls['fix-1'].options.schema.required.includes('regression'))
})

const supportingProofNotes = [
  ['a test-gap with one proof naming a mutation and a supporting proof naming none', testGap, [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { test: 'supporting_test.py [image]' })], /named no mutation/],
  ['a defect with a test draft, a red entry the fixer acted on and the proof that follows it', defectWithDraft, [proofOf(1, { test: 'supporting_test.py [image]', failedBefore: true, passesAfter: false }), proofOf(1, { failedBefore: true })], /did not pass after/],
  ['a defect with a test draft, one proof failed before and a supporting proof did not', defectWithDraft, [proofOf(1, { failedBefore: true }), proofOf(1, { test: 'supporting_test.py [image]' })], /did not fail before/],
]

for (const [behaviour, answered, regression, gap] of supportingProofNotes) {
  test(`${behaviour} reaches the re-check, whose prompt names the supporting proof and its gap`, async () => {
    const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [answered] }, { 'fix-1': { ...resumeFix, regression } })
    assert.notEqual(result.stage, 'fix', result.reason)
    const prompt = agentCalls['r1-review'].prompt
    assert.ok(prompt.includes(answered.where))
    assert.ok(prompt.includes('supporting_test.py [image]'))
    assert.match(prompt, gap)
  })
}

test('a test-gap proof with its mutation inside test reaches the delta re-check with a note quoting the test', async () => {
  const test = 't.py [case]; mutation made and reverted: drop the guard, the test fails'
  const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { test })] } })
  assert.notEqual(result.stage, 'fix', result.reason)
  assert.match(agentCalls['r1-review'].prompt, /mutation made and reverted: drop the guard.*named no mutation in the mutation field/s)
})

test('the fixer is told to name the mutation in its own field', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { mutation: 'm' })] } })
  const { prompt, options } = agentCalls['fix-1']
  assert.match(prompt, /in the mutation field \(not inside test\)/)
  assert.match(options.schema.properties.regression.items.properties.mutation.description, /not inside test/)
})

test('the delta re-check names each not-run test, its reason and the half that was not run', async () => {
  const notRun = (finding, overrides) => proofOf(finding, { passesAfter: false, notRun: `lock held for ${finding}`, test: `test_${finding}.py`, ...overrides })
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithDraft, testGap] }, { 'fix-1': { ...resumeFix, regression: [notRun(1), notRun(2, { mutation: 'drop the guard' })] } })
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, /test_1\.py.*lock held for 1.*fails on the pre-fix code/)
  assert.match(prompt, /test_2\.py.*lock held for 2.*fails under the mutation "drop the guard"/)
})

test('a carried batch whose fixer gave a supporting proof without evidence hands it to the delta re-check', async () => {
  const regression = [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { test: 'supporting_test.py [image]' })]
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap], deltaFrom: olderTip, answers: 'fixed' }, { 'fix-1': { ...resumeFix, regression } })
  assert.match(agentCalls['r1-review'].prompt, /supporting_test\.py \[image\].*named no mutation/s)
})

const diffLessRemovalBesideValidProof = [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { test: 'removed_test.py [image]', resolution: 'removed' })]

const diffLessRemovalRanges = [
  ['first fix', { fixFirst: [testGap] }],
  ['carried batch', { fixFirst: [testGap], deltaFrom: olderTip, answers: 'fixed' }],
]

for (const [range, rangeArgs] of diffLessRemovalRanges) {
  test(`${range}: a removal without a diff beside a valid proof reaches the re-check once as a gap note, not as an evidenced removal`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, ...rangeArgs }, { 'fix-1': { ...resumeFix, regression: diffLessRemovalBesideValidProof, touched_paths: [] } })
    const prompt = agentCalls['r1-review'].prompt
    assert.equal(prompt.split('removed_test.py [image]').length - 1, 1)
    assert.match(prompt, /removed_test\.py \[image\].*t\.py:1.*no diff/s)
    assert.doesNotMatch(prompt, /by removing code or a test/)
  })
}

const removalsByFindingKind = [
  ['the review after a removal answering a test-gap asks the reviewer to judge what was removed', testGap, true],
  ['the review after a removal answering a defect with a test draft gets the removal diff to judge', defectWithDraft, true],
  ['the review after a removal answering a defect without a draft gets the removal diff to judge', defectWithoutDraft, true],
]

for (const [behaviour, answered, shownAsRemoval] of removalsByFindingKind) {
  test(behaviour, async () => {
    const regression = [proofOf(1, { resolution: 'removed', failedBefore: true })]
    const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [answered] }, { 'fix-1': { ...resumeFix, regression, touched_paths: ['t.py'] } })
    const prompt = agentCalls['r1-review'].prompt
    assert.equal(/removing code or a test.*judge whether what was removed was dead or pinned no behaviour/.test(prompt), shownAsRemoval)
    assert.equal(prompt.includes(` -- t.py (`), shownAsRemoval)
    assert.equal(prompt.includes(`answered ${answered.where} by removing`), shownAsRemoval)
  })
}

test('a removal whose path is untouched is handed to the raiser over the whole range, saying the finding path carries no diff', async () => {
  const regression = [proofOf(1, { resolution: 'removed' })]
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression, touched_paths: ['pyproject.toml'] } })
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, /git log -p --first-parent --remerge-diff [0-9a-f]+\.\.[0-9a-f]+ \(\d+ characters/)
  assert.doesNotMatch(prompt, / -- t\.py/)
  assert.match(prompt, /t\.py carries no diff/)
})

test('a docs finding answered as removed reaches the re-check with the command that reads the diff of its path', async () => {
  const regression = [proofOf(1, { resolution: 'removed' })]
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [docsFinding] }, { 'fix-1': { ...resumeFix, regression, touched_paths: ['README.md'] } })
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, /git log -p --first-parent --remerge-diff [0-9a-f]+\.\.[0-9a-f]+ -- README\.md \(\d+ characters\)/)
  assert.ok(!prompt.includes('-removed in'))
  assert.ok(prompt.includes(`answered ${docsFinding.where} by removing`))
})

test('with two findings on different paths, the removal names the path of its own finding and not the first finding', async () => {
  const first = { ...testGap, where: 'a.py:1' }
  const second = { ...testGap, where: 'b.py:1' }
  const regression = [proofOf(1, { mutation: 'drop the guard' }), proofOf(2, { resolution: 'removed' })]
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [first, second] }, { 'fix-1': { ...resumeFix, regression, touched_paths: ['a.py', 'b.py'] } })
  const prompt = agentCalls['r1-review'].prompt
  assert.match(prompt, / -- b\.py \(/)
  assert.ok(!prompt.includes(' -- a.py'))
})

// The contract stops the fix loop at the final gate's third consecutive REVISE; the ordinary reviewer is bound by the budgets only.
const tipAfter = (n) => String(n).repeat(40)
const reviseWith = (where, extra = {}) => ({ verdict: 'REVISE', blocking: [finding(where, `defect at ${where}`)], followups: [], codexExit: 0, ...extra })
const fixFrom = (from, to) => ({ ...resumeFix, head: to, parents: [from], regression: [], files: ['src/x.py'] })
const materialResume = { ...resumeArgs, risk: 'material' }

test('three consecutive gate REVISEs stop at review before the third fixer, handing the head the three findings', async () => {
  const { result, launchedAgents } = await runLane(materialResume, {
    'r0-review': APPROVE,
    'r0-gate': reviseWith('a.py:1'),
    'fix-1': fixFrom(resumeTip, tipAfter(1)),
    'r1-gate': reviseWith('b.py:2'),
    'fix-2': fixFrom(tipAfter(1), tipAfter(2)),
    'r2-gate': reviseWith('c.py:3'),
  })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'review'])
  assert.ok(!launchedAgents.includes('fix-3'))
  assert.equal(result.spent.review, 2)
  assert.equal(result.tip, tipAfter(2))
  assert.deepEqual(result.gateRevisions.map(round => round.blocking.map(f => f.where)), [['a.py:1'], ['b.py:2'], ['c.py:3']])
  assert.match(result.reason, /gate returned REVISE three times in a row/)
})

test('a gate APPROVE between REVISEs breaks the streak, so a later gate REVISE is fixed as before', async () => {
  const { result, launchedAgents } = await runLane(materialResume, {
    'r0-review': APPROVE,
    'r0-gate': reviseWith('a.py:1'),
    'fix-1': fixFrom(resumeTip, tipAfter(1)),
    'r1-gate': reviseWith('b.py:2'),
    'fix-2': fixFrom(tipAfter(1), tipAfter(2)),
    'r2-gate': { ...APPROVE, codexExit: 0 },
  })
  assert.equal(result.gateRevisions, undefined)
  assert.ok(launchedAgents.includes('fix-2'))
  const gateApproved = { ...APPROVE, codexExit: 0 }
  const afterApprove = await runLane(materialResume, {
    'r0-review': reviseWith('r.py:1', { codexExit: undefined }),
    'r0-gate': reviseWith('a.py:1'),
    'fix-1': fixFrom(resumeTip, tipAfter(1)),
    'r1-review': reviseWith('r.py:2', { codexExit: undefined }),
    'r1-gate': reviseWith('b.py:2'),
    'fix-2': fixFrom(tipAfter(1), tipAfter(2)),
    'r2-review': reviseWith('r.py:3', { codexExit: undefined }),
    'r2-gate': gateApproved,
    'fix-3': fixFrom(tipAfter(2), tipAfter(3)),
    'r3-review': APPROVE,
    'r3-gate': reviseWith('c.py:3'),
    'fix-4': fixFrom(tipAfter(3), tipAfter(4)),
    'r4-gate': gateApproved,
  })
  assert.equal(afterApprove.result.gateRevisions, undefined)
  assert.ok(afterApprove.launchedAgents.includes('fix-4'))
})

test('three consecutive reviewer REVISEs with different findings do not stop at three', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, {
    'r0-review': reviseWith('a.py:1', { codexExit: undefined }),
    'fix-1': fixFrom(resumeTip, tipAfter(1)),
    'r1-review': reviseWith('b.py:2', { codexExit: undefined }),
    'fix-2': fixFrom(tipAfter(1), tipAfter(2)),
    'r2-review': reviseWith('c.py:3', { codexExit: undefined }),
    'fix-3': fixFrom(tipAfter(2), tipAfter(3)),
    'r3-review': APPROVE,
  })
  assert.ok(launchedAgents.includes('fix-3'))
  assert.equal(result.gateRevisions, undefined)
})

// The fixer runs on `rework` from the third fix round of a run on, whichever phase the round belongs to.
const docsReviewFinding = { ...finding('README.md:1', 'a wrong word'), kind: 'docs' }
const twoFixRounds = {
  'r0-review': reviseWith('a.py:1', { codexExit: undefined }),
  'fix-1': fixFrom(resumeTip, tipAfter(1)),
  'r1-review': reviseWith('b.py:2', { codexExit: undefined }),
  'fix-2': fixFrom(tipAfter(1), tipAfter(2)),
}
const thirdRound = [
  ['a review finding', { 'r2-review': reviseWith('c.py:3', { codexExit: undefined }), 'fix-3': fixFrom(tipAfter(2), tipAfter(3)), 'r3-review': APPROVE }, {}, 'sonnet', 'high'],
  ['a docs-only review finding', { 'r2-review': { ...reviseWith('c.py:3', { codexExit: undefined }), blocking: [docsReviewFinding] }, 'fix-3': fixFrom(tipAfter(2), tipAfter(3)), 'r3-review': APPROVE }, {}, 'haiku', 'low'],
  ['a red CI after two review rounds', { 'r2-review': APPROVE, 'e2e-0': PASS, 'ci-0': { ...greenCi(tipAfter(2)), green: false, failing: [finding('ci: lint', 'ruff fails')] }, 'fix-3': fixFrom(tipAfter(2), tipAfter(3)) }, {}, 'sonnet', 'high'],
  ['a review finding with a rework override', { 'r2-review': reviseWith('c.py:3', { codexExit: undefined }), 'fix-3': fixFrom(tipAfter(2), tipAfter(3)), 'r3-review': APPROVE }, { routing: { rework: { model: 'opus', effort: 'medium' } } }, 'opus', 'medium'],
]

for (const [what, answers, extraArgs, model, effort] of thirdRound) {
  test(`the third fix round for ${what} runs on ${model} at ${effort} after two rounds on the fix role`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, ...extraArgs }, { ...twoFixRounds, ...answers })
    for (const label of ['fix-1', 'fix-2']) {
      assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], ['sonnet', 'medium'], label)
    }
    assert.deepEqual([agentCalls['fix-3'].options.model, agentCalls['fix-3'].options.effort], [model, effort])
  })
}

// The fix step's tip and merge shape come only from the printer line the fixer runs last: HEAD and its parents.
const fixerShapes = [
  ['a fix commit followed by a merge of main', { head: mergedOnlyTip, parents: [resumeFixedTip, mainMovedTip] }],
  ['a merge of main followed by a fix commit', { head: resumeFixedTip, parents: [mergedOnlyTip] }],
  ['a fix commit with no merge of main', { head: resumeFixedTip }],
]

for (const [what, shape] of fixerShapes) {
  test(`${what} reaches the delta review over the fixer's own commits from the held tip`, async () => {
    const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, ...shape, regression: [] }, ...reachesTheEnd, 'ci-0': greenCi(shape.head) })
    assert.equal(result.status, 'ready-to-land')
    assert.ok(agentCalls['r1-review'].prompt.includes(`git log -p --first-parent --remerge-diff ${resumeTip}..${shape.head}`), agentCalls['r1-review'].prompt)
  })
}

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
    if (!changed) assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer only merged main and fixed nothing'])
  })
}

test('a fixer that only merged main fixes nothing when a review finding, not the merge, was the finding', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': mergeOnlyFix })
  assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer only merged main and fixed nothing'])
  assert.ok(!launchedAgents.includes('r1-review'))
})

test('a CI finding answered by a clean merge of main runs CI again and ends awaiting-head, since no verdict judged the merged tip', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, green: false, failing: [defectWithoutDraft] }, 'fix-1': mergeOnlyFix, 'ci-1': greenCi(mergedOnlyTip) })
  assert.deepEqual([result.status, result.stage, result.tip], ['awaiting-head', 'record', mergedOnlyTip])
  assert.ok(result.reason.includes(`the last verdict judged ${resumeTip}`), result.reason)
  assert.ok(!launchedAgents.includes('r1-review'))
  assert.ok(!result.requiredHeadActions.some(action => action.includes('aco land')))
})

test('a CI finding that stays red after a clean merge of main stops the lane', async () => {
  const red = { green: false, failing: [defectWithoutDraft] }
  const { result } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { head: resumeTip, ...red }, 'fix-1': mergeOnlyFix, 'ci-1': { head: mergedOnlyTip, ...red } })
  assert.notEqual(result.status, 'ready-to-land')
  assert.equal(result.stage, 'ci')
})

test('the fixer is handed the relay line to run last and returns its report with it', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  const { prompt, options } = agentCalls['fix-1']
  assert.match(prompt, /Last, whatever happened, run this one command line exactly as written[^]*' fix 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0' '[^']*' 'fix-1-c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'$/)
  assert.deepEqual(options.schema.required.slice(0, 1), ['printed'])
  assert.equal(options.agentType, 'atelier:code-fixer')
  for (const gone of ['oldTip', 'mergedBase', 'tip']) assert.ok(!(gone in options.schema.properties), gone)
})

const fixRelayFailures = [
  ['a CRC edit', { edit: (line) => line.replace(resumeFixedTip, resumeTip) }, /fails its CRC check/],
  ['a foreign nonce', { nonce: 'fix-1-e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5' }, /carries the nonce fix-1-e5e5/],
  ['no line', { printed: 'fatal: not a git repository' }, /is not a relay line/],
  ['a failed rev-parse', { head_code: 128 }, /reports a failed git command/],
  ['a failed merge-base', { main_code: 128 }, /reports a failed git command/],
]

for (const [what, shape, problem] of fixRelayFailures) {
  test(`a fix relay line with ${what} stops at fix quoting the printed line, and no review starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, ...shape, regression: [] } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, problem)
    assert.match(result.reason, /the printed line: /)
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

test('a blocked fixer that ran out of turns before the relay line stays escalated with its reason', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, printed: '', blocked: true, blockedReason: 'out of turns' } })
  assert.deepEqual([result.status, result.stage], ['escalated', 'fix'])
  assert.ok(result.reason.startsWith('out of turns'))
})

test('the builder and the fixer are told to run the targeted tests and fast static checks and to use their turn budget, the reviewer is not', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  const { agentCalls: buildCalls } = await runLane({ item: 358, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded' }, { build: built })
  const localChecks = /After your last merge of the default branch, run the targeted tests of your change and the fast static checks the repository names, and fix what they report; the quality gate and the end-to-end tests run in CI/
  const turnsOf = (agent) => Number(fs.readFileSync(new URL(`../plugins/atelier/agents/${agent}.md`, import.meta.url), 'utf8').match(/^maxTurns: (\d+)$/m)[1])
  assert.match(buildCalls.build.prompt, localChecks)
  assert.match(buildCalls.build.prompt, new RegExp(`You have ${turnsOf('code-worker')} turns`))
  assert.match(agentCalls['fix-1'].prompt, localChecks)
  assert.match(agentCalls['fix-1'].prompt, new RegExp(`You have ${turnsOf('code-fixer')} turns`))
  assert.match(agentCalls['fix-1'].prompt, /resolve conflicts so both sides' behaviour holds, and set mergeResolvedLaneConflict true/)
  assert.doesNotMatch(agentCalls['r1-review'].prompt, localChecks)
})

test('the fixer prompt says a finding whose message covers the whole file is fixed at every occurrence in that file', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  assert.match(agentCalls['fix-1'].prompt, /message covers the whole file[^.]*every occurrence in that file, not only at the reported line/)
})

// A passing review that leaves in-place follow-ups open starts one follow-up batch, re-checked before the tester and CI.
const polish = { ...followup('x.py:1', 'tidy the import order', 'distributor'), inPlace: true }
const alsoPolish = { ...followup('y.py:2', 'rename the helper', 'distributor'), inPlace: true }
const elsewhere = { ...followup('z.py:3', 'a rule declared twice', '#57'), inPlace: false }
const approvedWith = (...followups) => ({ 'r0-review': { ...APPROVE, followups } })
const batchReachesTheEnd = { 'fix-1': resumeFix, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) }

test('a review that passes with an in-place follow-up runs the fixer and a re-check before the tester, and folds it in', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(polish), ...batchReachesTheEnd })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(launchedAgents.filter(label => /^(r\d-review|fix-\d|e2e-\d)$/.test(label)), ['r0-review', 'fix-1', 'r1-review', 'e2e-0'])
  assert.deepEqual(result.folded.map(f => [f.where, f.tip]), [[polish.where, resumeFixedTip]])
  assert.deepEqual(result.followups, [])
})

test('a follow-up whose in-place flag is false starts no batch and goes to the head', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(elsewhere), 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(!launchedAgents.includes('fix-1'))
  assert.deepEqual(result.followups.map(f => f.where), [elsewhere.where])
})

test('the batch re-check reads the range as follow-ups, not findings, and the fixer is asked for no merge of main', async () => {
  const { agentCalls } = await runLane(resumeArgs, { ...approvedWith(polish), ...batchReachesTheEnd })
  assert.match(agentCalls['r1-review'].prompt, /It answers these follow-ups:\n- x\.py:1 — tidy the import order/)
  assert.doesNotMatch(agentCalls['r1-review'].prompt, /It answers these findings/)
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /Merge origin\/main if it moved/)
})

test('the batch fixer that only merged main is rejected as unasked work, with every fold-in satisfied or not', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(polish), 'fix-1': { ...mergeOnlyFix, resolved: [satisfied(polish)] } })
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.ok(!launchedAgents.includes('r1-review'))
})

test('a gate follow-up on a material lane is re-checked by the gate as well', async () => {
  const gateRaises = { ...APPROVE, followups: [polish], codexExit: 0 }
  const { result, launchedAgents } = await runLane({ ...resumeArgs, risk: 'material' }, { 'r0-review': APPROVE, 'r0-gate': gateRaises, 'fix-1': resumeFix, 'r1-review': APPROVE, 'r1-gate': { ...APPROVE, codexExit: 0 }, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.includes('r1-review') && launchedAgents.includes('r1-gate'))
})

test('a follow-up the batch re-check raises starts no second batch and stays for the head', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(polish), ...batchReachesTheEnd, 'r1-review': { ...APPROVE, followups: [alsoPolish] } })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(!launchedAgents.includes('fix-2'))
  assert.deepEqual(result.followups.map(f => f.where), [alsoPolish.where])
})

const spentBudgets = [['review', { review: 0 }], ['total', { total: 0 }]]

for (const [which, budgets] of spentBudgets) {
  test(`with the ${which} budget spent no batch runs and the lane is ready with the follow-up open`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, budgets }, { ...approvedWith(polish), 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.ok(!launchedAgents.includes('fix-1'))
    assert.deepEqual(result.followups.map(f => f.where), [polish.where])
  })
}

const reason = 'the fix would change behaviour outside the diff'
const decline = (item) => ({ where: item.where, reason })

test('a batch fixer that declines every fold-in at an unchanged tip lets the lane go on and the follow-ups stay with their reason', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(polish, alsoPolish), 'fix-1': { ...unchangedFix, declined: [decline(polish), decline(alsoPolish)] }, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(!launchedAgents.includes('r1-review'))
  assert.deepEqual(result.folded, [])
  assert.deepEqual(result.followups.map(f => [f.where, f.declined]), [[polish.where, reason], [alsoPolish.where, reason]])
})

test('a batch that fixes one fold-in and declines the other folds only the fixed one', async () => {
  const { result } = await runLane(resumeArgs, { ...approvedWith(polish, alsoPolish), ...batchReachesTheEnd, 'fix-1': { ...resumeFix, declined: [decline(alsoPolish)] } })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.folded.map(f => f.where), [polish.where])
  assert.deepEqual(result.followups.map(f => [f.where, f.declined]), [[alsoPolish.where, reason]])
})

test('a declined follow-up is not offered to a later fix round', async () => {
  const red = { head: resumeTip, green: false, failing: [defectWithoutDraft] }
  const { agentCalls } = await runLane(resumeArgs, { ...approvedWith(polish), 'fix-1': { ...unchangedFix, declined: [decline(polish)] }, 'e2e-0': PASS, 'ci-0': red, 'fix-2': secondFix, 'r2-review': APPROVE, 'ci-1': greenCi(secondFix.head) })
  assert.doesNotMatch(agentCalls['fix-2'].prompt, /tidy the import order/)
})

test('a batch re-check that revises enters the normal fix loop', async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { ...approvedWith(polish), ...batchReachesTheEnd, 'r1-review': { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }, 'fix-2': secondFix, 'r2-review': APPROVE, 'ci-0': greenCi(secondFix.head) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.includes('fix-2') && launchedAgents.includes('r2-review'))
})

test('a batch fixer that returns no result ends awaiting-head with the fold-ins and the tip before it in resume', async () => {
  const { result } = await runLane(resumeArgs, { ...approvedWith(polish), 'fix-1': null, 'checkpoint-fix': { work: false } })
  assert.equal(result.status, 'failed')
  const { result: saved } = await runLane(resumeArgs, { ...approvedWith(polish), 'fix-1': null, 'checkpoint-fix': { work: true, head: resumeFixedTip } })
  assert.equal(saved.status, 'awaiting-head')
  assert.deepEqual([saved.resume.foldIn.map(f => f.where), saved.resume.deltaFrom], [[polish.where], resumeTip])
})
