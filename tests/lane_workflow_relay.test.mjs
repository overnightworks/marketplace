// Drives the scope step's printer against real git and a temp bare remote, with a fake aco, through the lane's own checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runLane, runCommandLine, installFake, FAKE_ACO, resumedLane } from './lane_workflow_harness.mjs'

const BRANCH = 'lane'
const LONGEST_PATH_COMPONENT = 255

// Every test owns a temp tree. PATH, HOME and the git configuration are set in the child environment only, so the
// operator's configuration never reaches git and the test never changes the process environment.
function laneRepository(t) {
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
  git(root, 'init', '-b', BRANCH, worktree)
  git(worktree, 'remote', 'add', 'origin', remote)
  const tip = commitIn(worktree, 'lane-file')
  return { root, env, git, remote, commitIn, worktree, tip }
}

// The scope step's agent answers by running the command line it was handed, in the lane's real worktree.
const agentRunning = (lane, acoPrints, printedLines = []) => (prompt) => {
  const env = { ...lane.env, FAKE_BRIEF_OUTPUT: JSON.stringify({ outside_claim: acoPrints }) }
  const printed = runCommandLine(prompt.split('\n').at(-1), { cwd: os.tmpdir(), env })
  printedLines.push(printed)
  return { printed }
}

const laneArgs = (lane) => ({ ...resumedLane, item: 7, worktree: lane.worktree, branch: BRANCH, scratch: lane.root, pr: 1, tip: lane.tip })
const runScopeStep = (lane, acoPrints, printedLines) => runLane(laneArgs(lane), { 'scope-resume': agentRunning(lane, acoPrints, printedLines) })
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
  assert.match(commandLine, new RegExp(`^cd '${lane.worktree}' && python3 -c '[^']+' 7 '${BRANCH}' 'scope-resume-${lane.tip}'$`))
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
