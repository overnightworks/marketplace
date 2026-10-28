// Drives the atelier lane workflow script through the fixer, fold-in, proof and removal rules with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, APPROVE, PASS, greenCi, finding, followup, webauthTips, webauthReplay, agentProvidersReplay, replays, answersWith, outOfRange, mainMovedTip, mergedOnlyTip, resumeTip, resumeFixedTip, tidy, defectWithoutDraft, resumeFix, mergeOnlyFix, resumeArgs, unchangedFix, satisfied, reachesTheEnd, testGap, built } from './lane_workflow_harness.mjs'

const proofsByKind = [
  ['a resumed run whose findings carry no kind stops at the fix as before', { kind: undefined, testDraft: true, mutation: true }, false],
  ['#103 AC-proof-matches-its-finding: a defect with a test draft whose test did not fail before stops at the fix', { kind: 'defect', testDraft: true, mutation: true }, false],
  ['#284 a test-gap whose only proof is numbered for a neighbouring finding stops at the fix', { kind: 'test-gap', mutation: true, proofNumber: 2 }, false],
  ['#103 AC-pre-fix-mutation: a test-gap whose test failed on the pre-fix code needs no named mutation and moves past the fix', { kind: 'test-gap', mutation: false, failedBefore: true }, true],
  ['a test-gap without a named mutation stops at the fix', { kind: 'test-gap', mutation: false }, false],
  ['a test-gap whose test does not pass after the fix stops at the fix', { kind: 'test-gap', mutation: true, passesAfter: false }, false],
  ['a test-gap without any proof stops at the fix', { kind: 'test-gap', proof: 'omitted' }, false],
  ['#284 a test-gap whose proof is numbered one past the list stops at the fix', { kind: 'test-gap', mutation: true, proofNumber: outOfRange }, false],
  ['a test-gap proven by a named mutation moves past the fix', { kind: 'test-gap', mutation: true }, true],
  ['a failing proof numbered past the blocking list is ignored and the run moves past the fix', { kind: 'test-gap', mutation: true, strayProof: true }, true],
  ['#90 AC-hygiene-defect: a hygiene defect proven by the diff needs no mutation and moves past the fix', { kind: 'defect', mutation: false, proof: 'omitted' }, true],
  ['a docs finding needs no test and moves past the fix', { kind: 'docs', mutation: false }, true],
  ['a docs finding with a test draft needs no test either and moves past the fix', { kind: 'docs', testDraft: true, proof: 'omitted' }, true],
]

for (const replay of replays) {
  for (const [behaviour, labels, movesOn] of proofsByKind) {
    test(`${replay.name} replay: ${behaviour}`, async () => {
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
}

const fixOutcomes = [
  ['accepted', { kind: 'test-gap', mutation: true }],
  ['stopped', { kind: undefined, testDraft: true, mutation: false }],
]

for (const replay of replays) {
  for (const [outcome, labels] of fixOutcomes) {
    test(`${replay.name} replay: a fold-in counts as folded, with its tip, only once its fix is accepted (${outcome} fix)`, async () => {
      const { result } = await runLane(replay.args, answersWith(replay, labels))
      const expected = replay.foldIns[outcome]
      const openWheres = result.followups.map(f => f.where)
      assert.deepEqual(result.folded.map(f => [f.where, f.tip]), expected.folded)
      for (const [where] of expected.folded) assert.ok(!openWheres.includes(where), `${where} is still open`)
      for (const where of expected.open) assert.ok(openWheres.includes(where), `${where} is not open`)
    })
  }

  test(`${replay.name} replay: a ready lane asks the head to route only the follow-ups still open`, async () => {
    const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
    assert.equal(result.followups.length, replay.followupsToRoute)
    assert.ok(result.requiredHeadActions.includes(`route ${replay.followupsToRoute} follow-up(s) to their owning items before landing`))
  })
}

test('a fix that only merged main folds nothing in, so the head still routes the fold-in it was handed', async () => {
  const built = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
  const merged = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
  const foldIn = followup('x.py:1', 'tidy', 'follow-up (fix in place)')
  const conflicting = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }
  const { result } = await runLane({ ...webauthReplay.args, build: 'b' }, {
    build: { pr: 2, tip: built, blocked: false },
    'r0-review': { ...APPROVE, followups: [foldIn] },
    'r0-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': { head: built, green: false, failing: [conflicting] },
    'fix-1': { head: merged, parents: [built, 'e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4'], mergeResolvedLaneConflict: false, files: [], disputed: [], blocked: false },
    'ci-1': greenCi(merged),
  })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(result.folded, [])
  assert.deepEqual(result.followups, [{ ...foldIn, tip: built }])
  assert.ok(result.requiredHeadActions.includes('route 1 follow-up(s) to their owning items before landing'))
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

const docsFinding = { ...finding('README.md:1', 'a wrong word'), kind: 'docs' }

const fixBatchRouting = [
  ['only docs findings', { fixFirst: [docsFinding] }, 'haiku', 'low'],
  ['docs findings plus a defect', { fixFirst: [docsFinding, defectWithoutDraft] }, 'sonnet', 'medium'],
  ['docs findings plus a fold-in', { fixFirst: [docsFinding], foldIn: [tidy] }, 'sonnet', 'medium'],
]

for (const [batch, handedOver, model, effort] of fixBatchRouting) {
  test(`#191 AC-docs-batch-mechanical: a fix batch with ${batch} runs on ${model} at ${effort} effort`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, ...handedOver }, { 'fix-1': resumeFix })
    assert.deepEqual([agentCalls['fix-1'].options.model, agentCalls['fix-1'].options.effort], [model, effort])
  })
}

const resumesByHandedOver = [
  ['foldIn alone', { foldIn: [tidy] }, ['sync', 'fix-1', 'scope-1', 'r1-review']],
  ['foldIn alone with deltaFrom', { foldIn: [tidy], deltaFrom: resumeTip }, ['sync', 'fix-1', 'scope-1', 'r1-review']],
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

const alsoTidy = followup('y.py:2', 'rename the helper', 'follow-up (fix in place)')

const satisfiedFoldIns = [
  ['one fold-in', [tidy], [satisfied(tidy)]],
  ['two fold-ins', [tidy, alsoTidy], [satisfied(tidy), satisfied(alsoTidy, 'probe cell 4 proves it')]],
]

for (const [what, foldIn, resolved] of satisfiedFoldIns) {
  test(`#119 AC-satisfied-counts-as-folded: ${what} the fixer proves already satisfied at an unchanged tip are folded with its evidence and the lane goes on`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn }, { 'fix-1': { ...unchangedFix, resolved }, ...reachesTheEnd })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.deepEqual(result.folded, foldIn.map((f, i) => ({ ...f, tip: resumeTip, evidence: resolved[i].evidence })))
    assert.deepEqual(result.followups, [])
    assert.ok(launchedAgents.includes('r1-review') && launchedAgents.includes('e2e-0'))
  })
}

const satisfiedAcrossMovedMain = [
  ['main moved and the lane has no change of its own past the merge', { head: mainMovedTip, parents: [resumeTip, mergedOnlyTip] }, true],
  ['main moved but the returned tip is not the merge', { head: resumeTip, main_code: 1 }, false],
]

for (const [what, shape, goesOn] of satisfiedAcrossMovedMain) {
  test(`#119 AC-satisfied-counts-as-folded: every fold-in satisfied with ${what} ${goesOn ? 'goes on with the merge as the tip' : 'stops at fix'}`, async () => {
    const answers = { 'fix-1': { ...unchangedFix, ...shape, resolved: [satisfied(tidy)] }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(mainMovedTip) }
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn: [tidy] }, answers)
    assert.deepEqual([result.status, result.stage], goesOn ? ['ready-to-land', undefined] : ['failed', 'fix'])
    assert.equal(launchedAgents.includes('r1-review'), goesOn)
    if (goesOn) assert.deepEqual(result.folded.map(f => f.tip), [mainMovedTip])
  })
}

const stopsDespiteResolved = [
  ['a fold-in the fixer leaves out of resolved', { foldIn: [tidy, alsoTidy] }, [satisfied(tidy)]],
  ['nothing listed in resolved', { foldIn: [tidy] }, []],
  ['a fold-in listed without evidence', { foldIn: [tidy] }, [satisfied(tidy, '')]],
  ['a fold-in listed with blank evidence', { foldIn: [tidy] }, [satisfied(tidy, '  ')]],
  ['blocking findings, however much the fixer lists', { foldIn: [tidy], fixFirst: [defectWithoutDraft] }, [satisfied(tidy)]],
]

for (const [what, args, resolved] of stopsDespiteResolved) {
  test(`#119 AC-evidence-or-stop: a fixer that changes nothing with ${what} still stops at fix`, async () => {
    const { result } = await runLane({ ...resumeArgs, ...args }, { 'fix-1': { ...unchangedFix, resolved } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, /the fixer changed nothing/)
    assert.deepEqual(result.folded, [])
    assert.ok(result.followups.some(f => f.where === tidy.where))
  })
}

test('#119 AC-mixed-batch-folds-all: a batch with one fold-in committed and one already satisfied folds both, the satisfied one with its evidence', async () => {
  const resolved = [satisfied(alsoTidy)]
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy, alsoTidy] }, { 'fix-1': { ...resumeFix, resolved }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(result.folded, [{ ...tidy, tip: resumeFixedTip }, { ...alsoTidy, tip: resumeFixedTip, evidence: resolved[0].evidence }])
})

test('#119 AC-resolved-carries-evidence: the fixer is told to list every fold-in already done with its evidence, and the schema requires it', async () => {
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
  ['names the fold-in the fixer was given', [tidy], true],
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

const proofOf = (finding, overrides) => ({ finding, test: 't.py [case]', failedBefore: false, passesAfter: true, ...overrides })

const removalDiff = '-    def test_case_that_asserts_nothing(): pass'

const rejectedForNoProof = /test-gap finding or a defect with a test draft got no regression test/

const proofsByNumber = [
  ['a defect and a test-gap at one where, each with its own number, are each accepted', [defectWithDraft, testGap], [proofOf(1, { failedBefore: true }), proofOf(2, { mutation: 'drop the guard' })], null],
  ['a proof numbered for the neighbouring finding does not prove this one', [defectWithDraft, testGap], [proofOf(1, { failedBefore: true })], rejectedForNoProof],
  ['a test-gap test that failed before the fix needs no mutation', [testGap], [proofOf(1, { failedBefore: true })], null],
  ['a test-gap test without a mutation that did not fail before is rejected naming its where and the mutation', [testGap], [proofOf(1)], /t\.py:1.*no mutation/],
  ['a test-gap test with a mutation that does not pass after is rejected as not passing', [testGap], [proofOf(1, { mutation: 'drop the guard', passesAfter: false })], /t\.py:1.*did not pass/],
  ['a defect without a test draft needs no failing-before test', [defectWithoutDraft], [proofOf(1)], null],
  ['a defect with a test draft still needs its test to fail before', [defectWithDraft], [proofOf(1)], /did not fail before/],
  ['a removed vacuous test with its diff answers a test-gap', [testGap], [proofOf(1, { resolution: 'removed-vacuous', diff: removalDiff })], null],
  ['a removed vacuous test without a diff is rejected', [testGap], [proofOf(1, { resolution: 'removed-vacuous' })], /t\.py:1.*no diff/],
  ['a number pointing at a docs finding adds no pass for the test-gap behind it', [docsFinding, testGap], [proofOf(1)], rejectedForNoProof],
  ['two proofs for one number, one of them bad, are still rejected', [testGap], [proofOf(1, { mutation: 'drop the guard' }), proofOf(1, { mutation: 'drop the guard', passesAfter: false })], /did not pass/],
  ...[0, 1.5, '1', 2].map(number => [`a proof numbered ${JSON.stringify(number)} is ignored and the test-gap stays unproven`, [testGap], [proofOf(number, { mutation: 'drop the guard' })], rejectedForNoProof]),
]

for (const [behaviour, fixFirst, regression, rejectedFor] of proofsByNumber) {
  test(`#103 #284 defect:#284 proof guard: ${behaviour}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst }, { 'fix-1': { ...resumeFix, regression } })
    if (rejectedFor) {
      assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
      assert.match(result.reason, rejectedFor)
    } else {
      assert.ok(launchedAgents.includes('r1-review'))
    }
  })
}

test('#284 defect:#284 a proof numbered 1 is judged as blocking finding 1 whatever it covers, and the fixer sees the fold-ins unnumbered', async () => {
  const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap], foldIn: [tidy] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { test: 'the fold-in test', passesAfter: false })] } })
  assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
  assert.deepEqual(result.lastBlocking.map(f => f.where), [testGap.where])
  const { prompt } = agentCalls['fix-1']
  assert.match(prompt, /^1\. t\.py:1 — a behaviour has no test$/m)
  assert.match(prompt, /^- x\.py:1 — tidy the import order$/m)
  assert.doesNotMatch(prompt, /^\d+\. x\.py:1/m)
  assert.match(prompt, /a follow-up needs no regression entry/)
})

test('#284 defect:#284 the numbers in the fixer prompt are the ones a proof is judged by, on a CI fix as on the first fix', async () => {
  const { agentCalls: first } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft, testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(2, { mutation: 'drop the guard' })] } })
  assert.match(first['fix-1'].prompt, /^2\. t\.py:1 — a behaviour has no test$/m)
  const ci = { head: resumeTip, green: false, failing: [defectWithoutDraft, testGap] }
  const { agentCalls: viaCi, result } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': ci, 'r1-review': APPROVE, 'fix-1': { ...resumeFix, regression: [proofOf(2, { mutation: 'drop the guard' })] }, 'ci-1': greenCi(resumeFixedTip) })
  assert.match(viaCi['fix-1'].prompt, /^2\. t\.py:1 — a behaviour has no test$/m)
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('#284 defect:#284 the fixer schema takes the finding as an integer from 1 and carries no kind', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [testGap] }, { 'fix-1': { ...resumeFix, regression: [proofOf(1, { mutation: 'm' })] } })
  const proofItem = agentCalls['fix-1'].options.schema.properties.regression.items
  assert.deepEqual([proofItem.properties.finding.type, proofItem.properties.finding.minimum], ['integer', 1])
  assert.equal(proofItem.properties.kind, undefined)
  assert.ok(!proofItem.required.includes('kind'))
})

const removalsByFindingKind = [
  ['#103 AC-removed-vacuous: the review after a removal answering a test-gap asks the reviewer to judge the removed test', testGap, true],
  ['#71 AC-removal-answers-test-gap: a defect proof marked removed-vacuous is judged by the defect bar and shows no removal', defectWithoutDraft, false],
]

for (const [behaviour, answered, shownAsRemoval] of removalsByFindingKind) {
  test(behaviour, async () => {
    const regression = [proofOf(1, { resolution: 'removed-vacuous', diff: removalDiff, failedBefore: true })]
    const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [answered] }, { 'fix-1': { ...resumeFix, regression } })
    const prompt = agentCalls['r1-review'].prompt
    assert.equal(/removing a vacuous test.*judge whether the removed test pinned no behaviour/.test(prompt), shownAsRemoval)
    assert.equal(prompt.includes(removalDiff), shownAsRemoval)
    assert.equal(prompt.includes(`answered ${answered.where} by removing`), shownAsRemoval)
  })
}

// The contract stops the fix loop at the final gate's third consecutive REVISE; the ordinary reviewer is bound by the budgets only.
const tipAfter = (n) => String(n).repeat(40)
const reviseWith = (where, extra = {}) => ({ verdict: 'REVISE', blocking: [finding(where, `defect at ${where}`)], followups: [], codexExit: 0, ...extra })
const fixFrom = (from, to) => ({ ...resumeFix, head: to, parents: [from], regression: [], files: ['src/x.py'] })
const materialResume = { ...resumeArgs, risk: 'material' }

test('#330 three consecutive gate REVISEs stop at review before the third fixer, handing the head the three findings', async () => {
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

test('#330 a gate APPROVE between REVISEs breaks the streak, so a later gate REVISE is fixed as before', async () => {
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

test('#330 three consecutive reviewer REVISEs with different findings do not stop at three', async () => {
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

// The fix step's tip and merge shape come only from the printer line the fixer runs last: HEAD and its parents.
const fixerShapes = [
  ['#331 edge#531: a fix commit followed by a merge of main', { head: mergedOnlyTip, parents: [resumeFixedTip, mainMovedTip] }],
  ['#331 a merge of main followed by a fix commit', { head: resumeFixedTip, parents: [mergedOnlyTip] }],
  ['#331 a fix commit with no merge of main', { head: resumeFixedTip }],
]

for (const [what, shape] of fixerShapes) {
  test(`${what} reaches the delta review over the fixer's own commits from the held tip`, async () => {
    const { result, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, ...shape, regression: [] }, ...reachesTheEnd, 'ci-0': greenCi(shape.head) })
    assert.equal(result.status, 'ready-to-land')
    assert.ok(agentCalls['r1-review'].prompt.includes(`git log -p --first-parent --remerge-diff ${resumeTip}..${shape.head}`), agentCalls['r1-review'].prompt)
  })
}

test('#331 a fixer that only merged main fixes nothing when a review finding, not the merge, was the finding', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': mergeOnlyFix })
  assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer only merged main and fixed nothing'])
  assert.ok(!launchedAgents.includes('r1-review'))
})

test('#331 the fixer is handed the sync relay line to run last and returns its report with it', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  const { prompt, options } = agentCalls['fix-1']
  assert.match(prompt, /Last, whatever happened, run this one command line exactly as written[^]*' sync 'fix-1-c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'$/)
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
  test(`#331 a fix relay line with ${what} stops at fix quoting the printed line, and no review starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, ...shape, regression: [] } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, problem)
    assert.match(result.reason, /the printed line: /)
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

test('#331 a blocked fixer that ran out of turns before the relay line stays escalated with its reason', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, printed: '', blocked: true, blockedReason: 'out of turns' } })
  assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'fix', 'out of turns'])
})

test('#358 the builder and the fixer are told to run the static checks before pushing, the reviewer is not', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  const { agentCalls: buildCalls } = await runLane({ item: 358, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded' }, { build: built })
  const localChecks = /After your last merge of origin\/main and before you push, run the static checks your `aco brief` step names[^]*`quality hygiene \.`/
  assert.match(buildCalls.build.prompt, localChecks)
  assert.match(agentCalls['fix-1'].prompt, localChecks)
  assert.doesNotMatch(agentCalls['r1-review'].prompt, localChecks)
})
