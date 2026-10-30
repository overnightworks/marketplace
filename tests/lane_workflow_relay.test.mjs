// Drives the scope and sync steps' printer against real git and a temp bare remote, with a fake aco, through the lane's own checks, and holds the lane-relay child contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runLane, runCommandLine, installFake, FAKE_ACO, resumedLane, resumeArgs, resumeTip, resumeFix, defectWithoutDraft, reachesTheEnd, greenCi, tidy, unchangedFix, satisfied } from './lane_workflow_harness.mjs'

const BRANCH = 'lane'
const LONGEST_PATH_COMPONENT = 255

// Every test owns a temp tree. PATH, HOME and the git configuration are set in the child environment only, so the
// operator's configuration never reaches git and the test never changes the process environment.
function laneRepository(t, { onMain = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-relay-'))
  t.after(() => fs.rmSync(root, { recursive: true }))
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  installFake(bin, 'aco', FAKE_ACO)
  fs.mkdirSync(path.join(root, 'home'))
  fs.writeFileSync(path.join(root, 'gitconfig'), '')
  const env = {
    PATH: `${bin}:/usr/bin:/bin`, HOME: path.join(root, 'home'), GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Lane Test', GIT_AUTHOR_EMAIL: 'lane@example.invalid', GIT_COMMITTER_NAME: 'Lane Test', GIT_COMMITTER_EMAIL: 'lane@example.invalid',
  }
  const git = (cwd, ...gitArgs) => execFileSync('git', gitArgs, { cwd, env, encoding: 'utf8' }).trim()
  const remote = path.join(root, 'remote.git')
  git(root, 'init', '--bare', '-b', 'main', remote)
  const commitIn = (worktree, name) => {
    fs.writeFileSync(path.join(worktree, name), name)
    git(worktree, 'add', name)
    git(worktree, 'commit', '-m', name)
    return git(worktree, 'rev-parse', 'HEAD')
  }
  const worktree = path.join(root, 'work')
  git(root, 'init', '-b', onMain ? 'main' : BRANCH, worktree)
  git(worktree, 'remote', 'add', 'origin', remote)
  if (onMain) {
    commitIn(worktree, 'base-file')
    git(worktree, 'push', 'origin', 'main')
    git(worktree, 'checkout', '-b', BRANCH)
  }
  const tip = commitIn(worktree, 'lane-file')
  const advanceMain = (name, content = name) => {
    const other = path.join(root, `main-${name}`)
    git(root, 'clone', remote, other)
    fs.writeFileSync(path.join(other, name), content)
    git(other, 'add', name)
    git(other, 'commit', '-m', name)
    git(other, 'push', 'origin', 'main')
  }
  return { root, env, git, remote, commitIn, advanceMain, worktree, tip }
}

// The scope step's agent answers by running the command line it was handed, in the lane's real worktree.
const agentRunning = (lane, acoPrints, printedLines = [], briefExtras = {}) => (prompt) => {
  const env = { ...lane.env, FAKE_BRIEF_OUTPUT: JSON.stringify({ outside_claim: acoPrints, ...briefExtras }) }
  const printed = runCommandLine(prompt.split('\n').at(-1), { cwd: os.tmpdir(), env })
  printedLines.push(printed)
  return { printed }
}

// The sync step's agent does what its prompt says with real git, then runs the relay line it was handed.
const syncAgentRunning = (lane) => (prompt) => {
  const inWorktree = (...gitArgs) => lane.git(lane.worktree, ...gitArgs)
  inWorktree('fetch', 'origin')
  const containsMain = spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: lane.worktree, env: lane.env }).status === 0
  let note
  if (!containsMain) {
    try {
      inWorktree('merge', 'origin/main', '-m', 'merge main')
      inWorktree('push', 'origin', BRANCH)
    } catch {
      inWorktree('merge', '--abort')
      note = 'conflict in lane-file'
    }
  }
  return { printed: runCommandLine(prompt.split('\n').at(-1), { cwd: os.tmpdir(), env: lane.env }), ...(note && { note }) }
}

const laneArgs = (lane) => ({ ...resumedLane, item: 7, worktree: lane.worktree, branch: BRANCH, scratch: lane.root, pr: 1, tip: lane.tip })
const runScopeStep = (lane, acoPrints, printedLines, briefExtras) => runLane(laneArgs(lane), { 'scope-resume': agentRunning(lane, acoPrints, printedLines, briefExtras) })
const remoteTip = (lane) => lane.git(lane.remote, 'rev-parse', `refs/heads/${BRANCH}`)

test('#323 AC-scope-relay: the printer pushes the lane tip to a real remote and the lane goes on to review, fresh and repeated', async (t) => {
  const lane = laneRepository(t)
  for (const run of ['fresh', 'repeated']) {
    const { result, launchedAgents } = await runScopeStep(lane, [])
    assert.equal(remoteTip(lane), lane.tip, run)
    assert.ok(launchedAgents.includes('r0-review'), `${run}: ${launchedAgents.join()} ${result.reason}`)
  }
})

test('#323 AC-scope-relay: a rejected push stops the lane at push quoting git, and the remote branch stays as it was', async (t) => {
  const lane = laneRepository(t)
  const other = path.join(lane.root, 'other')
  lane.git(lane.root, 'clone', lane.remote, other)
  lane.git(other, 'checkout', '-b', BRANCH)
  const foreignTip = lane.commitIn(other, 'foreign-file')
  lane.git(other, 'push', 'origin', BRANCH)
  const { result, launchedAgents } = await runScopeStep(lane, [])
  assert.deepEqual([result.status, result.stage], ['failed', 'push'])
  assert.match(result.reason, /rejected/)
  assert.ok(!launchedAgents.some(label => label.includes('review')))
  assert.equal(remoteTip(lane), foreignTip)
})

test('#323 AC-scope-relay: paths outside the claim that aco prints reach the stop as the list', async (t) => {
  const lane = laneRepository(t)
  const { result } = await runScopeStep(lane, ['src/other.py'])
  assert.deepEqual([result.status, result.stage, result.outside], ['awaiting-head', 'scope', ['src/other.py']])
})

const baselineEntry = { path: 'quality/baseline.toml', names_a_file: true };
const laneSharedRows = [
  ['a touched lane-shared path is not outside', { claim: { lane_shared: [baselineEntry] } }, ['quality/baseline.toml'], 'r0-review'],
  ['a path in neither the scope nor lane_shared still stops the lane', { claim: { lane_shared: [baselineEntry] } }, ['quality/baseline.toml', 'src/other.py'], ['src/other.py']],
  ['a brief whose lane_shared_unavailable is set filters nothing', { claim: { lane_shared: [baselineEntry], lane_shared_unavailable: 'no board' } }, ['quality/baseline.toml'], ['quality/baseline.toml']],
  ['an entry with names_a_file false filters nothing', { claim: { lane_shared: [{ path: 'quality/baseline.toml', names_a_file: false }] } }, ['quality/baseline.toml'], ['quality/baseline.toml']],
  ['a brief with no lane_shared filters nothing', {}, ['quality/baseline.toml'], ['quality/baseline.toml']],
]
for (const [name, briefExtras, acoPrints, expected] of laneSharedRows) {
  test(`#363 AC-lane-shared: ${name}`, async (t) => {
    const lane = laneRepository(t)
    const { result, launchedAgents } = await runScopeStep(lane, acoPrints, [], briefExtras)
    if (typeof expected === 'string') return assert.ok(launchedAgents.includes(expected), `${launchedAgents.join()} ${result.reason}`)
    assert.deepEqual([result.status, result.stage, result.outside], ['awaiting-head', 'scope', expected])
  })
}

test('#323 AC-scope-relay: a null outside_claim stops the lane without a live claim', async (t) => {
  const lane = laneRepository(t)
  const { result } = await runScopeStep(lane, null)
  assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
  assert.match(result.reason, /no live claim/)
})

test('#323 AC-scope-relay: the JS checksum accepts the printer line for a non-ASCII path', async (t) => {
  const lane = laneRepository(t)
  const paths = ['docs/ünï-日本語.md', 'emoji/😀 file.md']
  const printedLines = []
  const { result } = await runScopeStep(lane, paths, printedLines)
  assert.match(printedLines[0], /\\u00fc/, 'the printer escapes non-ASCII text')
  assert.deepEqual([result.stage, result.outside], ['scope', paths])
})

test('#323 AC-scope-relay: the printer text holds no single quote, so the shell passes it as one argument', async (t) => {
  const lane = laneRepository(t)
  const { agentCalls } = await runLane(laneArgs(lane), { 'scope-resume': agentRunning(lane, []) })
  const commandLine = agentCalls['scope-resume'].prompt.split('\n').at(-1)
  assert.match(commandLine, new RegExp(`^cd '${lane.worktree}' && python3 -c '[^']+' scope 7 '${BRANCH}' 'scope-resume-${lane.tip}'$`))
})

test('#323 AC-scope-relay: fifty of the longest paths stay one line the lane accepts, and a longer list is capped at fifty', async (t) => {
  const lane = laneRepository(t)
  const longPath = (index) => `${String(index).padStart(3, '0')}${'x'.repeat(LONGEST_PATH_COMPONENT - 3)}/${'y'.repeat(LONGEST_PATH_COMPONENT)}`
  const printedLines = []
  const { result } = await runScopeStep(lane, Array.from({ length: 60 }, (_, index) => longPath(index)), printedLines)
  assert.equal(printedLines[0].includes('\n'), false)
  assert.equal(result.outside.length, 50)
  assert.match(result.reason, /and 10 more/)
  t.diagnostic(`worst-case printed line: ${printedLines[0].length} characters`)
  assert.ok(printedLines[0].length < 40000, String(printedLines[0].length))
})

// A fix batch merges origin/main on top of the lane tip, so HEAD at the scope check is a merge whose first parent is the tip.
const mergeIntoWorktree = (lane, ref) => lane.git(lane.worktree, 'merge', ref, '-m', 'merge', '--no-ff')

test('#313 AC-scope-adopts-main-merge: a clean merge of origin/main on top of the tip passes the scope check and the lane goes on from it, fresh and repeated', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.advanceMain('main-file')
  lane.git(lane.worktree, 'fetch', 'origin')
  mergeIntoWorktree(lane, 'origin/main')
  const head = headOf(lane)
  for (const run of ['fresh', 'repeated']) {
    const { result, launchedAgents } = await runScopeStep(lane, [])
    assert.equal(remoteTip(lane), head, run)
    assert.ok(launchedAgents.includes('r0-review'), `${run}: ${launchedAgents.join()} ${result.reason}`)
  }
})

test('#313 AC-scope-adopts-main-merge: a merge of a branch that is not in origin/main still stops the lane at push', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.git(lane.worktree, 'checkout', '-b', 'side', 'main')
  lane.commitIn(lane.worktree, 'side-file')
  lane.git(lane.worktree, 'checkout', BRANCH)
  mergeIntoWorktree(lane, 'side')
  const { result, launchedAgents } = await runScopeStep(lane, [])
  assert.deepEqual([result.status, result.stage], ['failed', 'push'])
  assert.ok(!launchedAgents.some(label => label.includes('review')))
})

test('#313 AC-scope-adopts-main-merge: a pushed commit that is not a merge on top of the tip still stops the lane at push', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.commitIn(lane.worktree, 'unreported-file')
  const { result } = await runScopeStep(lane, [])
  assert.deepEqual([result.status, result.stage], ['failed', 'push'])
})

test('#367 AC-scope-line-no-brief-text: a brief whose output starts with non-ASCII puts none of its text on the relay line, and the lane goes on', async (t) => {
  const lane = laneRepository(t)
  const printedLines = []
  const { result, launchedAgents } = await runScopeStep(lane, [], printedLines, { title: '\u201equoted title' })
  assert.doesNotMatch(printedLines[0], /quoted|u201e/)
  assert.ok(launchedAgents.includes('r0-review'), `${launchedAgents.join()} ${result.reason}`)
})

const runSyncStep = (lane) => runLane(laneArgs(lane), { sync: syncAgentRunning(lane), 'scope-resume': agentRunning(lane, []) })
const headOf = (lane) => lane.git(lane.worktree, 'rev-parse', 'HEAD')

test('#345 AC-sync-relay-real-git: incident 3, a lane that already contains origin/main with a commit on top, carries its own head to the push', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.advanceMain('main-file')
  lane.git(lane.worktree, 'fetch', 'origin')
  lane.git(lane.worktree, 'merge', 'origin/main', '-m', 'merge main')
  lane.commitIn(lane.worktree, 'lane-file-two')
  const head = headOf(lane)
  const mergeBase = lane.git(lane.worktree, 'merge-base', 'origin/main', 'HEAD')
  assert.notEqual(head, mergeBase)
  const { agentCalls, launchedAgents } = await runSyncStep(lane)
  assert.ok(launchedAgents.includes('r0-review'), launchedAgents.join())
  assert.ok(agentCalls['scope-resume'].prompt.endsWith(` 'scope-resume-${head}'`), agentCalls['scope-resume'].prompt)
  assert.equal(remoteTip(lane), head)
  assert.equal(headOf(lane), head)
})

test('#345 AC-sync-relay-real-git: a clean merge of origin/main makes the merge commit the lane tip, pushed to the remote, fresh and repeated', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.advanceMain('main-file')
  for (const run of ['fresh', 'repeated']) {
    const { agentCalls, launchedAgents } = await runSyncStep(lane)
    const head = headOf(lane)
    assert.equal(lane.git(lane.worktree, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, `${run}: HEAD is a merge commit`)
    assert.ok(launchedAgents.includes('r0-review'), `${run}: ${launchedAgents.join()}`)
    assert.ok(agentCalls['scope-resume'].prompt.endsWith(` 'scope-resume-${head}'`), run)
    assert.equal(remoteTip(lane), head, run)
  }
})

test('#345 AC-sync-relay-real-git: a real conflict the agent aborts escalates at sync with the lane head unchanged and no review', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  lane.advanceMain('lane-file', 'main wrote this file too')
  const { result, launchedAgents } = await runSyncStep(lane)
  assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'sync', 'conflict in lane-file'])
  assert.deepEqual(launchedAgents, ['sync'])
  assert.equal(headOf(lane), lane.tip)
  assert.equal(lane.git(lane.worktree, 'status', '--porcelain'), '')
})

test('#345 AC-sync-relay-real-git: a scope printer line that carries the sync nonce ends the lane as failed at sync quoting the line', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  const scopePrinterAnswer = (prompt) => {
    const syncCommandLine = prompt.split('\n').at(-1)
    const scopeCommandLine = syncCommandLine.replace(/ sync ('sync-[0-9a-f]+')$/, ` scope 7 '${BRANCH}' $1`)
    return { printed: runCommandLine(scopeCommandLine, { cwd: os.tmpdir(), env: { ...lane.env, FAKE_BRIEF_OUTPUT: JSON.stringify({ outside_claim: [] }) } }) }
  }
  const { result, launchedAgents } = await runLane(laneArgs(lane), { sync: scopePrinterAnswer })
  assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
  assert.match(result.reason, /the printed line: \{"crc":/)
  assert.deepEqual(launchedAgents, ['sync', 'sync-reread'])
})

// The fixer does what its prompt says with real git, then runs the relay line it was handed last.
const fixerAgentRunning = (lane, work) => (prompt) => {
  work()
  const printed = runCommandLine(prompt.split('\n').at(-1), { cwd: os.tmpdir(), env: lane.env })
  return { mergeResolvedLaneConflict: false, files: ['fix-file'], disputed: [], blocked: false, regression: [], printed }
}
const mergeMain = (lane) => {
  lane.git(lane.worktree, 'fetch', 'origin')
  lane.git(lane.worktree, 'merge', 'origin/main', '-m', 'merge main')
}
const runFixStep = (lane, work) => runLane({ ...laneArgs(lane), fixFirst: [defectWithoutDraft] }, { sync: syncAgentRunning(lane), 'fix-1': fixerAgentRunning(lane, work), 'scope-1': agentRunning(lane, []) })
// What the reviewers run to see the fixer's delta, taken from the prompt they were handed and run in the lane's worktree.
const reviewedDelta = (lane, prompt) => lane.git(lane.worktree, ...prompt.match(/git (log -p --first-parent --remerge-diff [0-9a-f]+\.\.[0-9a-f]+)/)[1].split(' '))

const fixThenMerge = (lane) => () => {
  lane.commitIn(lane.worktree, 'fix-file')
  lane.advanceMain('main-file')
  mergeMain(lane)
}
const mergeThenFix = (lane) => () => {
  lane.advanceMain('main-file')
  mergeMain(lane)
  lane.commitIn(lane.worktree, 'fix-file')
}
const mergeWithEvilEdit = (lane) => () => {
  lane.commitIn(lane.worktree, 'fix-file')
  lane.advanceMain('main-file')
  lane.git(lane.worktree, 'fetch', 'origin')
  lane.git(lane.worktree, 'merge', '--no-commit', '--no-ff', 'origin/main')
  fs.writeFileSync(path.join(lane.worktree, 'lane-file'), 'evil lane edit')
  lane.git(lane.worktree, 'add', 'lane-file')
  lane.git(lane.worktree, 'commit', '-m', 'merge main')
}

const fixShapes = [
  ['#331 edge#531 AC-fix-then-merge-real-git: a fix commit followed by a merge of main', fixThenMerge, /diff --git a\/fix-file/],
  ['#331 AC-merge-then-fix-real-git: a merge of main followed by a fix commit', mergeThenFix, /diff --git a\/fix-file/],
  ['#331 AC-evil-merge-real-git: a merge of main amended with an extra lane edit', mergeWithEvilEdit, /\+evil lane edit/],
]

for (const [what, workFor, shown] of fixShapes) {
  test(`${what} reaches the delta review, which shows the lane's own change and never main's clean changes`, async (t) => {
    const lane = laneRepository(t, { onMain: true })
    const { agentCalls, launchedAgents } = await runFixStep(lane, workFor(lane))
    assert.ok(launchedAgents.includes('r1-review'), launchedAgents.join())
    const delta = reviewedDelta(lane, agentCalls['r1-review'].prompt)
    assert.match(delta, shown)
    assert.doesNotMatch(delta, /main-file/)
  })
}

test('#331 AC-merge-only-real-git: a fixer that only merged main fixes nothing for a review finding, and no review starts', async (t) => {
  const lane = laneRepository(t, { onMain: true })
  const { result, launchedAgents } = await runFixStep(lane, () => { lane.advanceMain('main-file'); mergeMain(lane) })
  assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer only merged main and fixed nothing'])
  assert.ok(!launchedAgents.includes('r1-review'))
})

// The lane-relay child contract: the lane starts sync and scope through it, and any break of it stops the lane at the step that asked.
const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_RELAY_PROTOCOL = (\d+)$/m)?.[1])
const driveRelayChild = (args, options, answers = {}) => runLane(args, answers, { ...options, child: 'atelier:lane-relay' })
const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const builtAnswer = { pr: 2, tip: 'abcdef1', blocked: false }

test('#350 lane-relay-protocol: a child with another protocol number fails the lane at sync naming both numbers, and no sync agent starts', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await driveRelayChild(resumedLane, { transformChild: (source) => source.replace(/^const LANE_RELAY_PROTOCOL = \d+$/m, `const LANE_RELAY_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
  assert.match(result.reason, new RegExp(`protocol ${parentNumber + 1}.*protocol ${parentNumber}`))
  assert.doesNotMatch(result.reason, /the printed line/)
  assert.deepEqual(launchedAgents, [])
})

test('#350 lane-relay-protocol: a child that misses args fails the lane at sync naming them', async () => {
  const { result } = await driveRelayChild(resumedLane, { alterChildArgs: ({ worktree: _worktree, nonce: _nonce, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
  assert.match(result.reason, /missing args: .*worktree.*nonce/)
  assert.doesNotMatch(result.reason, /the printed line/)
})

test('#400 lane-relay-protocol: a child with another protocol number and a missing arg fails the lane with the skew sentence, not missing args', async () => {
  const skewed = (source) => source.replace(/^const LANE_RELAY_PROTOCOL = \d+$/m, `const LANE_RELAY_PROTOCOL = ${protocolOf(readWorkflow('lane')) + 1}`)
  const { result } = await driveRelayChild(resumedLane, { transformChild: skewed, alterChildArgs: ({ mechanical: _mechanical, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
  assert.match(result.reason, /the installed atelier differs from the running lane/)
  assert.doesNotMatch(result.reason, /missing args/)
})

test('#350 lane-relay-protocol: a child that throws fails a resumed lane at sync and a built lane at scope, naming the error', async () => {
  const throwing = { transformChild: () => "throw new Error('the child exploded')" }
  const resumed = await driveRelayChild(resumedLane, throwing)
  assert.deepEqual([resumed.result.status, resumed.result.stage], ['failed', 'sync'])
  assert.match(resumed.result.reason, /the child exploded/)
  assert.doesNotMatch(resumed.result.reason, /the printed line/)
  const built = await driveRelayChild(builtLane, throwing, { build: builtAnswer })
  assert.deepEqual([built.result.status, built.result.stage], ['failed', 'scope'])
  assert.match(built.result.reason, /the child exploded/)
  assert.doesNotMatch(built.result.reason, /the printed line/)
})

test('#350 lane-relay-protocol: lane.js and lane-relay.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-relay')), protocolOf(readWorkflow('lane')))
})

test('#350 lane-relay-protocol: the sync and scope agents are launched by the lane-relay child, not by lane.js', async () => {
  const built = await driveRelayChild(builtLane, {}, { build: builtAnswer, 'scope-0': { outside_claim: [] } })
  assert.deepEqual(built.launchedByChild['atelier:lane-relay'], ['scope-0'])
  const resumed = await driveRelayChild(resumedLane, {})
  assert.deepEqual(resumed.launchedByChild['atelier:lane-relay'], ['sync', 'scope-resume'])
  const fixed = await driveRelayChild({ ...resumedLane, fixFirst: [defectWithoutDraft] }, {}, { 'fix-1': { ...resumeFix, regression: [] } })
  assert.deepEqual(fixed.launchedByChild['atelier:lane-relay'], ['sync', 'fix-1', 'scope-1'])
})

// The re-read: an unreadable relay line is read once more by a printer-only agent before the lane fails.
const JUNK = { printed: '{"crc":"pending","v":"pending"}' }
const syncFails = (rereads) => runLane(resumedLane, { sync: JUNK, ...rereads })
const reread = (result) => result.launchedAgents.filter(label => label.endsWith('-reread'))

test('#398 AC-relay-reread: a good re-read replaces the unreadable line and the lane goes on, with the re-read agent holding only the printer command and the mechanical options', async () => {
  const run = await syncFails({ 'sync-reread': {} })
  assert.deepEqual(reread(run), ['sync-reread'])
  assert.ok(run.launchedAgents.includes('r0-review'), run.launchedAgents.join())
  const { prompt, options } = run.agentCalls['sync-reread']
  assert.equal(prompt.split('\n').length, 3, prompt)
  assert.match(prompt.split('\n')[1], /^run this one command line exactly as written/)
  assert.equal(options.agentType, run.agentCalls.sync.options.agentType)
  assert.equal(options.phase, run.agentCalls.sync.options.phase)
  assert.deepEqual(Object.keys(options.schema.properties), ['printed'])
})

test('#398 AC-relay-reread: the re-read line is the printed line the lane quotes, and the first answer keeps its other fields', async () => {
  const run = await runLane(resumedLane, { sync: JUNK, 'sync-reread': { head: 'abcdef0', main_code: 1 } })
  assert.deepEqual([run.result.status, run.result.stage], ['escalated', 'sync'])
  assert.deepEqual(reread(run), ['sync-reread'])
  const fixed = await runLane({ ...resumedLane, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [], printed: JUNK.printed }, 'fix-1-reread': {} })
  assert.deepEqual(reread(fixed), ['fix-1-reread'])
  assert.ok(fixed.launchedAgents.includes('scope-1'), fixed.launchedAgents.join())
})

test('#398 AC-relay-reread: a re-read that is unreadable too leaves the first problem and its line standing, and no third read starts', async () => {
  const run = await syncFails({ 'sync-reread': { printed: 'a second bad copy' } })
  assert.deepEqual([run.result.status, run.result.stage], ['failed', 'sync'])
  assert.match(run.result.reason, /is not a relay line/)
  assert.ok(run.result.reason.includes(JUNK.printed), run.result.reason)
  assert.ok(!run.result.reason.includes('a second bad copy'))
  assert.deepEqual(reread(run), ['sync-reread'])
})

test('#398 AC-relay-reread: a re-read agent that returns no result leaves the first problem standing', async () => {
  const run = await syncFails({ 'sync-reread': null })
  assert.deepEqual([run.result.status, run.result.stage], ['failed', 'sync'])
  assert.ok(run.result.reason.includes(JUNK.printed), run.result.reason)
  assert.deepEqual(reread(run), ['sync-reread'])
})

test('#398 AC-relay-reread: a readable line starts no re-read', async () => {
  const run = await runLane(resumedLane, {})
  assert.deepEqual(reread(run), [])
})

// The CI read: the relaying agent edits the checks.list of the printed line and keeps the printed CRC.
const withListing = (change) => (line) => {
  const [, crc, payload] = /^\{"crc":"(\w+)","v":(.*)\}$/.exec(line)
  const values = JSON.parse(payload)
  values.checks.list = change(values.checks.list)
  return `{"crc":"${crc}","v":${JSON.stringify(values)}}`
}
const listing = [{ name: 'quality / verdict', bucket: 'pass' }, { name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'pass' }]
const driveCiRead = (edit, checks = listing) => runLane({ ...resumeArgs, foldIn: [tidy] }, { ...reachesTheEnd, 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, 'ci-0': { ...greenCi(resumeTip), checks }, 'ci-read-0': { edit } })

test('#428 AC-relay-list-order: a relay line whose checks.list entries were swapped verifies, with no re-read', async () => {
  const { result, launchedAgents } = await driveCiRead(withListing(([first, second, ...rest]) => [second, first, ...rest]))
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(reread({ launchedAgents }), [])
})

for (const [what, edit] of [
  ['a dropped entry', withListing(([, ...rest]) => rest)],
  ['a changed bucket', withListing(([first, ...rest]) => [{ ...first, bucket: 'fail' }, ...rest])],
  ['a changed nonce', (line) => line.replace(/"nonce":"[^"]*"/, '"nonce":"other"')],
]) {
  test(`#428 AC-relay-list-order: ${what} still fails the relay check`, async () => {
    const { result } = await driveCiRead(edit)
    assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
    assert.match(result.reason, /relay line/)
  })
}

test('#428 AC-relay-list-order: swapped entries with non-ASCII names verify', async () => {
  const names = [{ name: 'ünï / 日本語 😀', bucket: 'pass' }, ...listing]
  const { result } = await driveCiRead(withListing(([first, second, ...rest]) => [second, first, ...rest]), names)
  assert.equal(result.status, 'ready-to-land', result.reason)
})
