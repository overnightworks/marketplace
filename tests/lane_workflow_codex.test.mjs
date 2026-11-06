// The Codex courier runs as the lane-codex child under a protocol number; a refusal or a crash fails the lane naming it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, installFake, APPROVE } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_CODEX_PROTOCOL = (\d+)$/m)?.[1])
const driveGate = (options) => runLane({ ...resumedLane, risk: 'material' }, { 'r0-review': APPROVE }, { ...options, child: 'atelier:lane-codex' })

test('#340 lane-codex-protocol: a child with another protocol number fails the lane at review naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await driveGate({ transformChild: (source) => source.replace(/^const LANE_CODEX_PROTOCOL = \d+$/m, `const LANE_CODEX_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.ok(!launchedAgents.includes('r0-gate'))
})

test('#340 lane-codex-protocol: a call without the worktree fails the lane at review naming the missing args', async () => {
  const { result } = await driveGate({ alterChildArgs: ({ worktree: _worktree, scratch: _scratch, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /missing args: .*worktree.*scratch/)
})

test('#400 lane-codex-protocol: a child with another protocol number and a missing arg fails the lane with the skew sentence, not missing args', async () => {
  const skewed = (source) => source.replace(/^const LANE_CODEX_PROTOCOL = \d+$/m, `const LANE_CODEX_PROTOCOL = ${protocolOf(readWorkflow('lane')) + 1}`)
  const { result } = await driveGate({ transformChild: skewed, alterChildArgs: ({ worktree: _worktree, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /the installed atelier differs from the running lane/)
  assert.doesNotMatch(result.reason, /missing args/)
})

test('#340 lane-codex-protocol: a child that throws fails the lane at review naming the error', async () => {
  const { result } = await driveGate({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /the child exploded/)
})

test('#340 lane-codex-protocol: an answer without a verdict fails the lane at review naming what came back', async () => {
  const { result } = await driveGate({ transformChild: () => "return { surprise: 'no verdict' }" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-codex answered without a verdict.*surprise/)
})

test('#340 lane-codex-protocol: lane.js and lane-codex.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-codex')), protocolOf(readWorkflow('lane')))
})

test('#340 lane-codex-protocol: the gate courier is launched by the lane-codex child, not by lane.js', async () => {
  const { launchedByChild, launchedAgents } = await driveGate({})
  assert.deepEqual(launchedByChild['atelier:lane-codex'], ['r0-gate'])
  assert.ok(launchedAgents.includes('r0-gate'))
})

const bodyCommands = (repoFlag) => [`gh issue view 7${repoFlag} --json body --jq .body`, `gh pr view 9${repoFlag} --json body --jq .body`]
const bodyLane = { ...resumedLane, item: 7, pr: 9, repo: 'o/r' }

test('#419 review-reads-body: the Claude reviewer brief names both gh commands with the repo flag', async () => {
  const { agentCalls } = await runLane(bodyLane, { 'r0-review': APPROVE })
  for (const command of bodyCommands(' -R o/r')) assert.ok(agentCalls['r0-review'].prompt.includes(command), command)
})

test('#419 review-reads-body: the Codex courier appends both gh outputs to the brief file through the shell, right before codex exec', async () => {
  const { agentCalls } = await runLane({ ...bodyLane, risk: 'material' }, { 'r0-review': APPROVE })
  const prompt = agentCalls['r0-gate'].prompt
  const [issueCommand, prCommand] = bodyCommands(' -R o/r')
  assert.ok(prompt.indexOf(issueCommand) > 0 && prompt.indexOf(prCommand) > prompt.indexOf(issueCommand))
  assert.ok(prompt.indexOf(prCommand) < prompt.indexOf('codex exec'))
  assert.match(prompt, /\{ cat \/s\/\S*-brief\.md[^\n]*gh issue view[^\n]*gh pr view[^\n]*\} > \S*-brief\.md\.tmp && mv \S*-brief\.md\.tmp \/s\/\S*-brief\.md/)
})

test('#419 review-reads-body: the Codex brief does not ask the networkless sandbox to run gh', async () => {
  const { agentCalls } = await runLane({ ...bodyLane, risk: 'material' }, { 'r0-review': APPROVE })
  const brief = agentCalls['r0-gate'].prompt.match(/-----\n([\s\S]*?)\n-----/)[1]
  assert.doesNotMatch(brief, /gh issue view/)
})

test('#419 review-reads-body: a lane-codex call without the pull request number fails the lane naming it', async () => {
  const { result } = await driveGate({ alterChildArgs: ({ pr: _pr, ...rest }) => rest })
  assert.match(result.reason, /missing args: .*pr/)
})

// Runs the courier's start command as written in a scratch directory with stub gh and codex; the stub codex copies its stdin aside.
async function runStartCommand({ failingProgram }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-codex-start-'))
  try {
    const [scratch, worktree, bin] = ['scratch', 'worktree', 'bin'].map(name => fs.mkdirSync(path.join(root, name)) ?? path.join(root, name))
    const failure = (program) => (program === failingProgram ? 'exit 1' : '')
    installFake(bin, 'gh', `#!/bin/sh\n${failure('gh')}\ncase "$1" in issue) printf 'ITEM BODY' ;; pr) printf 'PR BODY' ;; esac\n`)
    installFake(bin, 'codex', `#!/bin/sh\ncat > ${root}/codex-stdin\n`)
    const { agentCalls } = await runLane({ ...bodyLane, risk: 'material', scratch, worktree }, { 'r0-review': APPROVE })
    const prompt = agentCalls['r0-gate'].prompt
    const startLine = prompt.split('\n').find(line => line.includes('codex exec')).trim()
    const brief = path.join(scratch, startLine.match(/< (\S+-brief\.md)/)[1].split('/').at(-1))
    fs.writeFileSync(brief, 'BRIEF')
    const ran = spawnSync('sh', ['-c', startLine], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
    const marker = fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
    return { ran, stdinOfCodex: () => fs.existsSync(`${root}/codex-stdin`) && fs.readFileSync(`${root}/codex-stdin`, 'utf8'), scratch, marker }
  } finally {
    // the detached codex stub ends on its own; the directory goes after the test reads it
    process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))
  }
}

test('#459 courier-start-command: the start command gives Codex a brief holding both bodies', async () => {
  const { ran, stdinOfCodex, scratch } = await runStartCommand({})
  assert.equal(ran.status, 0)
  const exitMarker = () => fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
  for (let waited = 0; !exitMarker() && waited < 100; waited++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(exitMarker(), 'codex ran and left its exit marker')
  assert.match(stdinOfCodex(), /BRIEF[\s\S]*ITEM BODY[\s\S]*PR BODY/)
})

test('#459 courier-start-command: a failed append exits non-zero and starts no Codex', async () => {
  const { ran, stdinOfCodex, marker } = await runStartCommand({ failingProgram: 'gh' })
  assert.notEqual(ran.status, 0)
  assert.equal(stdinOfCodex(), false)
  assert.equal(marker, undefined)
})
