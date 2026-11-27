// Drives the atelier lane workflow script through a sync that hits a merge conflict, with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, storedLane, APPROVE, PASS, greenCi, resumeArgs, resumeFix, resumeTip, olderTip, mergedOnlyTip, mainMovedTip, defectWithoutDraft, conflictsWithMain, tidy, unchangedFix, reachesTheEnd } from './lane_workflow_harness.mjs'

const conflictTree = 'ab'.repeat(20)
const conflicted = 'docs/ARCHITECTURE.md'
const alsoChanged = 'CHANGELOG.md'
const mergeTreeOf = (...paths) => [conflictTree, ...paths].join('\n')
const conflictingSync = (...paths) => ({ main_code: 1, merge_tree: mergeTreeOf(...(paths.length ? paths : [conflicted])), merge_tree_code: 1, note: `conflict in ${paths.join(', ') || conflicted}` })
const resolvedMerge = { ...resumeFix, head: mergedOnlyTip, parents: [resumeTip, mainMovedTip], mergeResolvedLaneConflict: true, files: [conflicted], regression: [], merge_tree: mergeTreeOf(conflicted), merge_tree_code: 1, merge_paths: [conflicted, alsoChanged] }
const readyAfterMerge = { 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(mergedOnlyTip) }
const mergeableLines = (prompt) => prompt.split('\n').filter(line => /^\d+\. mergeable — /.test(line))

test('a sync conflict is resolved by a fresh fixer, reviewed as the merge, and counted as one CI-budget round with no blocking finding', async () => {
  const run = await runLane(resumeArgs, { sync: conflictingSync(), 'fix-1': resolvedMerge, ...readyAfterMerge })
  const { result, agentCalls } = run
  assert.equal(result.status, 'ready-to-land')
  const fixer = agentCalls['fix-1'].prompt
  assert.deepEqual(mergeableLines(fixer).length, 1)
  assert.ok(fixer.includes(`the lane conflicts with origin/main in ${conflicted}`), fixer)
  assert.match(fixer, /from the sync/)
  assert.doesNotMatch(fixer, /from the head/)
  const range = agentCalls['r1-review'].prompt
  assert.ok(range.includes(`git log -p --first-parent --remerge-diff ${resumeTip}..${mergedOnlyTip}`), range)
  assert.ok(range.includes('git diff M^1 M -- <path>') && range.includes('git diff M^2 M -- <path>') && range.includes(conflicted), range)
  assert.ok(range.includes(`The merge commit also changes ${alsoChanged}`), range)
  assert.ok(!range.includes(`The merge commit also changes ${conflicted}`), range)
  const stored = storedLane(run)
  assert.equal(stored.fix_rounds.ci, 1)
  assert.equal(stored.blocking.ci, 0)
  assert.deepEqual(Object.values(stored.misses), [0, 0, 0, 0])
  assert.deepEqual(result.history.find(entry => entry.by === 'sync' && entry.conflict), { after: 0, by: 'sync', conflict: [conflicted], tip: resumeTip })
})

test('a sync conflict gets the plain merging brief with the shared resolve-conflicts rules and no CI re-run on a dispute', async () => {
  const dispute = { ...unchangedFix, disputed: [{ finding: 1, where: 'mergeable', text: 'the lane conflicts', counterEvidence: 'main merges cleanly' }] }
  const { result, agentCalls, launchedAgents } = await runLane(resumeArgs, { sync: conflictingSync(), 'fix-1': dispute })
  assert.match(agentCalls['fix-1'].prompt, /Merge origin\/main if it moved/)
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /Merge origin\/main only for a finding/)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'fix'])
  assert.ok(!launchedAgents.some(label => label.startsWith('ci-') || label.startsWith('r1-')), launchedAgents.join(','))
})

test('a fixer that finds the two sides contradicting escalates at fix with a resume carrying the finding and the run own deltaFrom', async () => {
  const hunk = `${conflicted} hunk 2: main drops the paragraph the lane extends`
  for (const [what, args, deltaFrom] of [['without deltaFrom', resumeArgs, undefined], ['with deltaFrom', { ...resumeArgs, deltaFrom: olderTip }, olderTip]]) {
    const { result, launchedAgents } = await runLane(args, { sync: conflictingSync(), 'fix-1': { ...resumeFix, blocked: true, blockedReason: hunk, head: resumeTip } })
    assert.deepEqual([result.status, result.stage], ['escalated', 'fix'], what)
    assert.ok(result.reason.includes(hunk), result.reason)
    assert.ok(!launchedAgents.some(label => label.startsWith('r1-')), what)
    assert.equal(result.resume.deltaFrom, deltaFrom, what)
    assert.deepEqual(result.resume.fixFirst.map(f => f.where), ['mergeable'], what)
    assert.ok(!('tip' in result.resume), what)
  }
})

test('a sync conflict resolved with a deltaFrom older than the tip reads the remerge-diff from deltaFrom with the conflicted and the merge-commit paths', async () => {
  const { result, agentCalls } = await runLane({ ...resumeArgs, deltaFrom: olderTip }, { sync: conflictingSync(), 'fix-1': resolvedMerge, ...readyAfterMerge })
  assert.equal(result.status, 'ready-to-land')
  const range = agentCalls['r1-review'].prompt
  assert.ok(range.includes(`git log -p --first-parent --remerge-diff ${olderTip}..HEAD`), range)
  assert.ok(range.includes('git diff M^1 M -- <path>') && range.includes(conflicted), range)
  assert.ok(range.includes(`The merge commit also changes ${alsoChanged}`), range)
})

test('a sync conflict joins the fixFirst batch as one fixer round under the test budget without a duplicate mergeable finding', async () => {
  const run = await runLane({ ...resumeArgs, fixFirst: [conflictsWithMain, defectWithoutDraft] }, { sync: conflictingSync(), 'fix-1': resolvedMerge, ...readyAfterMerge })
  assert.equal(run.result.status, 'ready-to-land')
  assert.ok(!run.launchedAgents.includes('fix-2'))
  const fixer = run.agentCalls['fix-1'].prompt
  assert.equal(mergeableLines(fixer).length, 1)
  assert.ok(fixer.includes(defectWithoutDraft.where), fixer)
  assert.ok(fixer.indexOf('mergeable —') < fixer.indexOf(defectWithoutDraft.where), 'the sync finding comes first')
  const stored = storedLane(run)
  assert.deepEqual([stored.fix_rounds.test, stored.fix_rounds.ci], [1, 0])
})

test('a sync conflict joins the foldIn batch as one fixer round under the test budget', async () => {
  const run = await runLane({ ...resumeArgs, foldIn: [tidy] }, { sync: conflictingSync(), 'fix-1': resolvedMerge, ...readyAfterMerge })
  assert.equal(run.result.status, 'ready-to-land')
  const stored = storedLane(run)
  assert.deepEqual([stored.fix_rounds.test, stored.fix_rounds.ci], [1, 0])
})

const generatedLane = { ...resumeArgs, generated: { 'uv.lock': 'uv lock' }, ledgers: ['LEDGER.md'] }
for (const [what, args, sync] of [
  ['a conflict only in a generated file', generatedLane, conflictingSync('uv.lock')],
  ['a conflict only in a ledger', generatedLane, conflictingSync('LEDGER.md')],
  ['a conflict only in generated files and ledgers', generatedLane, conflictingSync('LEDGER.md', 'uv.lock')],
  ['a merge-tree error that printed nothing', resumeArgs, { main_code: 1, merge_tree: '', merge_tree_code: 2, note: 'merge-tree failed' }],
  ['a merge-tree error whose first line is no tree', resumeArgs, { main_code: 1, merge_tree: 'fatal: not something we can merge', merge_tree_code: 1, note: 'merge-tree failed' }],
  ['a clean merge-tree while the sync reports code 1', resumeArgs, { main_code: 1, note: 'the merge was refused' }],
]) {
  test(`${what} keeps the escalation at sync with the sync agent's note`, async () => {
    const { result, launchedAgents } = await runLane(args, { sync })
    assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'sync', sync.note])
    assert.deepEqual(launchedAgents, ['sync'])
  })
}

test('a conflict list cut at fifty paths goes to the fixer', async () => {
  const manyPaths = Array.from({ length: 51 }, (_, index) => `docs/part-${String(index).padStart(2, '0')}.md`)
  const { launchedAgents, agentCalls } = await runLane({ ...generatedLane, generated: { [manyPaths[0]]: 'regen' } }, { sync: conflictingSync(...manyPaths), 'fix-1': resolvedMerge, ...readyAfterMerge })
  assert.ok(launchedAgents.includes('fix-1'))
  assert.ok(agentCalls['fix-1'].prompt.includes('docs/part-49.md'))
})

test('a conflicted path containing a comma is named whole to the fixer and the reviewer', async () => {
  const commaPath = 'docs/a, b.md'
  const mergeOfCommaPath = { ...resolvedMerge, files: [commaPath], merge_tree: mergeTreeOf(commaPath), merge_paths: [commaPath, alsoChanged] }
  const { agentCalls } = await runLane(resumeArgs, { sync: conflictingSync(commaPath), 'fix-1': mergeOfCommaPath, ...readyAfterMerge })
  assert.ok(agentCalls['fix-1'].prompt.includes(`the lane conflicts with origin/main in ${commaPath}`))
  const range = agentCalls['r1-review'].prompt
  assert.ok(range.includes(`conflicted in ${commaPath}:`), range)
  assert.ok(range.includes(`The merge commit also changes ${alsoChanged}`), range)
  assert.ok(!range.includes(`The merge commit also changes ${commaPath}`), range)
})

test('a resumed sync conflict finding retyped without paths names no conflicted path to the reviewer', async () => {
  const retyped = { where: 'mergeable', kind: 'defect', text: 'the lane conflicts with origin/main', rule: 'the lane contains origin/main before its review', evidence: 'CONFLICTING' }
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [retyped] }, { sync: {}, 'fix-1': resolvedMerge, ...readyAfterMerge })
  const range = agentCalls['r1-review'].prompt
  assert.ok(!range.includes('The fix merges origin/main'), range)
  assert.ok(!range.includes('undefined'), range)
})

test('a sync that merges main cleanly or already contains it raises no conflict finding', async () => {
  const { launchedAgents } = await runLane(resumeArgs, { sync: {}, ...reachesTheEnd, 'r0-review': APPROVE })
  assert.ok(!launchedAgents.includes('fix-1'))
})

const syncOnlyArgs = { ...resumeArgs, syncOnly: true }
const cleanMerge = { head: mergedOnlyTip, parents: [resumeTip, mainMovedTip] }
const judgingAgent = (label) => /^(r\d|e2e|standin|gate)/.test(label)

test('a syncOnly run merges main cleanly, watches CI and starts no review, gate or tester agent', async () => {
  const { result, launchedAgents } = await runLane({ ...syncOnlyArgs, risk: 'material' }, { sync: cleanMerge, 'ci-0': greenCi(mergedOnlyTip) })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'record'])
  assert.equal(result.tip, mergedOnlyTip)
  assert.ok(launchedAgents.includes('sync') && launchedAgents.includes('ci-0'), launchedAgents.join(','))
  assert.deepEqual(launchedAgents.filter(judgingAgent), [])
})

test('a syncOnly run whose tip already contains main changes nothing and says so', async () => {
  const { result, launchedAgents } = await runLane(syncOnlyArgs, { sync: {} })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'sync'])
  assert.equal(result.tip, resumeTip)
  assert.match(result.reason, /already contains origin\/main/)
  assert.ok(!launchedAgents.some(label => label.startsWith('ci-') || judgingAgent(label)), launchedAgents.join(','))
})

test('a syncOnly run whose merge conflicts in the lane files goes through the fixer, the review and CI', async () => {
  const { result, launchedAgents } = await runLane(syncOnlyArgs, { sync: conflictingSync(), 'fix-1': resolvedMerge, ...readyAfterMerge })
  assert.equal(result.status, 'ready-to-land')
  assert.ok(['fix-1', 'r1-review', 'e2e-0'].every(label => launchedAgents.includes(label)), launchedAgents.join(','))
})

for (const [what, extra] of [
  ['build', { build: 'b', pr: undefined, tip: undefined }],
  ['fixFirst', { fixFirst: [defectWithoutDraft] }],
  ['foldIn', { foldIn: [tidy] }],
  ['deltaFrom', { deltaFrom: olderTip }],
  ['a value that is not true', { syncOnly: 'yes' }],
]) {
  test(`syncOnly beside ${what} fails at input before any agent runs`, async () => {
    const { result, launchedAgents } = await runLane({ ...syncOnlyArgs, ...extra })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /syncOnly/)
    assert.deepEqual(launchedAgents, [])
  })
}
