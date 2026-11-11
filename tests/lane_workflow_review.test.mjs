// One review round runs as the lane-review child under a protocol number; a refusal or a crash fails the lane naming it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, installFake, APPROVE, PASS, greenCi, finding, resumeArgs, resumeTip, resumeFixedTip, resumeFix, secondFix, tidy } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_REVIEW_PROTOCOL = (\d+)$/m)?.[1])
const driveGate = (options) => runLane({ ...resumedLane, risk: 'material' }, { 'r0-review': APPROVE }, { ...options, child: 'atelier:lane-review' })

test('lane-review-protocol: a child with another protocol number fails the lane at review naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await driveGate({ transformChild: (source) => source.replace(/^const LANE_REVIEW_PROTOCOL = \d+$/m, `const LANE_REVIEW_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.ok(!launchedAgents.includes('r0-gate'))
})

test('lane-review-protocol: a call without the worktree fails the lane at review naming the missing args', async () => {
  const { result } = await driveGate({ alterChildArgs: ({ worktree: _worktree, scratch: _scratch, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /missing args: .*worktree.*scratch/)
})

test('lane-review-protocol: a child with another protocol number and a missing arg fails the lane with the skew sentence, not missing args', async () => {
  const skewed = (source) => source.replace(/^const LANE_REVIEW_PROTOCOL = \d+$/m, `const LANE_REVIEW_PROTOCOL = ${protocolOf(readWorkflow('lane')) + 1}`)
  const { result } = await driveGate({ transformChild: skewed, alterChildArgs: ({ worktree: _worktree, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /the installed atelier differs from the running lane/)
  assert.doesNotMatch(result.reason, /missing args/)
})

test('lane-review-protocol: a child that throws fails the lane at review naming the error', async () => {
  const { result } = await driveGate({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /the child exploded/)
})

test('lane-review-protocol: an answer without results fails the lane at review naming what came back', async () => {
  const { result } = await driveGate({ transformChild: () => "return { surprise: 'no verdict' }" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-review answered without a valid result.*surprise/)
})

test('lane-review-protocol: a child that answers nothing fails the lane at review naming the problem', async () => {
  const { result } = await driveGate({ transformChild: () => 'return undefined' })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-review answered without a valid result/)
})

test('lane-review-protocol: an answer with results but no verdict fails the lane at review naming the problem', async () => {
  const { result } = await driveGate({ transformChild: () => 'return { results: [null, null] }' })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-review answered with an unknown round state/)
})

test('lane-review-protocol: an answer whose verdict state is no round state fails the lane at review naming it', async () => {
  const { result, launchedAgents } = await driveGate({ transformChild: () => "return { results: [null, null], verdict: { state: 'aprove' } }" })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /lane-review[\s\S]*aprove/)
  assert.ok(!launchedAgents.includes('r0-gate'))
})

test('lane-review-protocol: lane.js and lane-review.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-review')), protocolOf(readWorkflow('lane')))
})

test('lane-review-protocol: the review and the gate courier are launched by the lane-review child, not by lane.js', async () => {
  const { launchedByChild, launchedAgents } = await driveGate({})
  assert.deepEqual(launchedByChild['atelier:lane-review'], ['r0-review', 'r0-gate'])
  assert.ok(launchedAgents.includes('r0-gate'))
})

const bodyCommands = (repoFlag) => [`gh issue view 7${repoFlag} --json body --jq .body`, `gh pr view 9${repoFlag} --json body --jq .body`]
const bodyLane = { ...resumedLane, item: 7, pr: 9, repo: 'o/r' }

test('review-reads-body: the Claude reviewer brief names both gh commands with the repo flag', async () => {
  const { agentCalls } = await runLane(bodyLane, { 'r0-review': APPROVE })
  for (const command of bodyCommands(' -R o/r')) assert.ok(agentCalls['r0-review'].prompt.includes(command), command)
})

test('test-volume: the Claude reviewer brief carries the ratio rule naming D1 and D3', async () => {
  const { agentCalls } = await runLane(bodyLane, { 'r0-review': APPROVE })
  const prompt = agentCalls['r0-review'].prompt
  assert.match(prompt, /more than three test lines for each source line/)
  assert.match(prompt, /D1 \(one behaviour, one test, at the lowest layer that can prove it; a flow test proves a path once, its variants are parametrized unit or integration tests; a branch a flow test reaches gets no mirror unit test\)/)
  assert.match(prompt, /D3 \(cases that differ only in data are one parametrized test; shared arrangement lives in fixtures and builders\)/)
})

test('review-reads-body: the Codex courier appends both gh outputs to the brief file through the shell, right before codex exec', async () => {
  const { agentCalls } = await runLane({ ...bodyLane, risk: 'material' }, { 'r0-review': APPROVE })
  const prompt = agentCalls['r0-gate'].prompt
  const [issueCommand, prCommand] = bodyCommands(' -R o/r')
  assert.ok(prompt.indexOf(issueCommand) > 0 && prompt.indexOf(prCommand) > prompt.indexOf(issueCommand))
  assert.ok(prompt.indexOf(prCommand) < prompt.indexOf('codex exec'))
  assert.match(prompt, /\{ cat \/s\/\S*-brief\.md[^\n]*gh issue view[^\n]*gh pr view[^\n]*\} > \S*-brief\.md\.tmp && mv \S*-brief\.md\.tmp \/s\/\S*-brief\.md/)
})

test('review-reads-body: the Codex brief does not ask the networkless sandbox to run gh', async () => {
  const { agentCalls } = await runLane({ ...bodyLane, risk: 'material' }, { 'r0-review': APPROVE })
  const brief = agentCalls['r0-gate'].prompt.match(/-----\n([\s\S]*?)\n-----/)[1]
  assert.doesNotMatch(brief, /gh issue view/)
})

test('review-reads-body: a lane-review call without the pull request number fails the lane naming it', async () => {
  const { result } = await driveGate({ alterChildArgs: ({ pr: _pr, ...rest }) => rest })
  assert.match(result.reason, /missing args: .*pr/)
})

// Runs the courier's start command as written in a scratch directory with stub gh and codex; the stub codex copies its stdin aside.
async function runStartCommand({ failingProgram, contract = 'c', fileFromBrief = brief => brief }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-review-start-'))
  try {
    const [scratch, worktree, bin] = ['scratch', 'worktree', 'bin'].map(name => fs.mkdirSync(path.join(root, name)) ?? path.join(root, name))
    const failure = (program) => (program === failingProgram ? 'exit 1' : '')
    installFake(bin, 'gh', `#!/bin/sh\n${failure('gh')}\ncase "$1" in issue) printf 'ITEM BODY' ;; pr) printf 'PR BODY' ;; esac\n`)
    installFake(bin, 'codex', `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = --output-schema ] && cp "$2" ${root}/codex-schema-at-start; shift; done\ncat > ${root}/codex-stdin\n`)
    const { agentCalls } = await runLane({ ...bodyLane, contract, risk: 'material', scratch, worktree }, { 'r0-review': APPROVE })
    const prompt = agentCalls['r0-gate'].prompt
    const startLine = prompt.split('\n').find(line => line.includes('codex exec')).trim()
    const brief = path.join(scratch, startLine.match(/< (\S+-brief\.md)/)[1].split('/').at(-1))
    const writtenBrief = prompt.match(/verbatim to \S+:\n-----\n([\s\S]*)\n-----\n3\. /)[1]
    fs.writeFileSync(brief, fileFromBrief(writtenBrief))
    const ran = spawnSync('sh', ['-c', startLine], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
    const marker = fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
    const schemaInLine = startLine.match(/printf %s '(.*?)' > /)[1]
    return { ran, schemaInLine, schemaSeenByCodex: () => fs.existsSync(`${root}/codex-schema-at-start`) && fs.readFileSync(`${root}/codex-schema-at-start`, 'utf8'), stdinOfCodex: () => fs.existsSync(`${root}/codex-stdin`) && fs.readFileSync(`${root}/codex-stdin`, 'utf8'), scratch, marker }
  } finally {
    // the detached codex stub ends on its own; the directory goes after the test reads it
    process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))
  }
}

test('courier-start-command: the start command gives Codex a brief holding both bodies', async () => {
  const { ran, stdinOfCodex, scratch } = await runStartCommand({})
  assert.equal(ran.status, 0)
  const exitMarker = () => fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
  for (let waited = 0; !exitMarker() && waited < 100; waited++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(exitMarker(), 'codex ran and left its exit marker')
  assert.match(stdinOfCodex(), /Read-only sandbox[\s\S]*ITEM BODY[\s\S]*PR BODY/)
})

test('courier-writes-schema: Codex finds the schema already written, byte for byte as the workflow holds it, when it starts', async () => {
  const { ran, scratch, schemaInLine, schemaSeenByCodex } = await runStartCommand({})
  assert.equal(ran.status, 0)
  const exitMarker = () => fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
  for (let waited = 0; !exitMarker() && waited < 100; waited++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(exitMarker(), 'codex ran and left its exit marker')
  assert.equal(schemaSeenByCodex(), schemaInLine)
})

test('courier-writes-schema: the courier is not asked to write the schema by hand', async () => {
  const { agentCalls } = await runLane({ ...bodyLane, risk: 'material' }, { 'r0-review': APPROVE })
  assert.doesNotMatch(agentCalls['r0-gate'].prompt, /Write this JSON schema/)
})

test('courier-start-command: a failed append exits non-zero and starts no Codex', async () => {
  const { ran, stdinOfCodex, marker } = await runStartCommand({ failingProgram: 'gh' })
  assert.notEqual(ran.status, 0)
  assert.equal(stdinOfCodex(), false)
  assert.equal(marker, undefined)
})

for (const [name, options] of [
  ['a brief with one word changed', { fileFromBrief: brief => brief.replace('independent', 'dependent') }],
  ['the courier\'s own prompt instead of the brief', { fileFromBrief: () => 'You are a courier for one independent Codex review.' }],
  ['a non-ASCII brief retyped with a different character', { contract: 'Prüfe 5 € genau', fileFromBrief: brief => brief.replace('€', 'EUR') }],
]) {
  test(`courier-brief-check: ${name} exits non-zero, names the mismatch and starts no Codex`, async () => {
    const { ran, stdinOfCodex, marker } = await runStartCommand(options)
    assert.notEqual(ran.status, 0)
    assert.match(ran.stderr, /brief file differs from the brief the script wrote/)
    assert.equal(stdinOfCodex(), false)
    assert.equal(marker, undefined)
  })
}

for (const [name, options] of [
  ['trailing blank lines', { fileFromBrief: brief => `${brief}\n\n  \n` }],
  ['every line indented and blank lines between lines', { fileFromBrief: brief => brief.split('\n').map(line => `  ${line}`).join('\n\n') }],
  ['non-ASCII text', { contract: 'Prüfe 5 € und 日本語 😀 genau' }],
]) {
  test(`courier-brief-check: a brief with ${name} starts Codex`, async () => {
    const { ran, scratch } = await runStartCommand(options)
    assert.equal(ran.status, 0)
    const exitMarker = () => fs.readdirSync(scratch).find(name => name.endsWith('.exit'))
    for (let waited = 0; !exitMarker() && waited < 100; waited++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(exitMarker(), 'codex ran and left its exit marker')
  })
}

// ---- a courier whose Codex run could not read its output schema is retried once
const schemaMissing = { verdict: 'failed', blocking: [], followups: [], codexExit: 1, note: 'Failed to read output schema file /x/lane-1/gate-schema.json: No such file or directory (os error 2)' }
const gateAnswers = (...answers) => {
  const queue = [...answers]
  return { 'r0-review': APPROVE, 'r0-gate': () => queue.shift(), 'r0-gate-retry': () => queue.shift() }
}
const gateRuns = (launchedAgents) => launchedAgents.filter(label => label.startsWith('r0-gate'))

test('courier-schema-retry: an answer that failed reading the output schema is retried once and the round is judged on the retry', async () => {
  const { result, launchedAgents, agentCalls } = await runLane(materialLane, gateAnswers(schemaMissing, { ...APPROVE, codexExit: 0 }))
  assert.deepEqual(gateRuns(launchedAgents), ['r0-gate', 'r0-gate-retry'])
  assert.equal(agentCalls['r0-gate-retry'].prompt, agentCalls['r0-gate'].prompt)
  assert.deepEqual(result.history.map(round => [round.by, round.verdict]), [['review', 'APPROVE'], ['gate', 'APPROVE']])
})

test('courier-schema-retry: a second answer that failed reading the output schema fails the round with no further retry', async () => {
  const { result, launchedAgents } = await runLane(materialLane, gateAnswers(schemaMissing, schemaMissing))
  assert.deepEqual(gateRuns(launchedAgents), ['r0-gate', 'r0-gate-retry'])
  failedAtReview(result)
})

const briefMismatch = { verdict: 'failed', blocking: [], followups: [], codexExit: -1, note: 'brief file differs from the brief the script wrote' }

test('courier-brief-retry: an answer that started no Codex for a mismatching brief is retried once and the round is judged on the retry', async () => {
  const { result, launchedAgents } = await runLane(materialLane, gateAnswers(briefMismatch, { ...APPROVE, codexExit: 0 }))
  assert.deepEqual(gateRuns(launchedAgents), ['r0-gate', 'r0-gate-retry'])
  assert.deepEqual(result.history.map(round => [round.by, round.verdict]), [['review', 'APPROVE'], ['gate', 'APPROVE']])
})

test('courier-brief-retry: a second mismatching brief fails the round with no further retry', async () => {
  const { result, launchedAgents } = await runLane(materialLane, gateAnswers(briefMismatch, briefMismatch))
  assert.deepEqual(gateRuns(launchedAgents), ['r0-gate', 'r0-gate-retry'])
  failedAtReview(result)
})

for (const [name, answer] of [
  ['another failure note', { ...schemaMissing, note: 'Error: stream disconnected' }],
  ['a clean Codex exit', { ...schemaMissing, codexExit: 0 }],
  ['no Codex start', { ...schemaMissing, codexExit: -1 }],
]) {
  test(`courier-schema-retry: a failed answer with ${name} is not retried`, async () => {
    const { launchedAgents } = await runLane(materialLane, gateAnswers(answer, answer))
    assert.ok(!launchedAgents.includes('r0-gate-retry'))
  })
}

// ---- a Codex reviewer or gate that hits its usage limit makes the lane wait
const limitLine = 'You’ve hit your usage limit. Upgrade to Pro or try again at Nov 4th, 2026 7:57 AM.'
const limited = (line = limitLine, resetsAt = 'Nov 4th, 2026 7:57 AM', codexExit = 1) => ({ verdict: 'failed', blocking: [], followups: [], codexExit, note: 'tail', limit: { line, resetsAt } })
const materialLane = { ...resumedLane, risk: 'material', productionPaths: ['src/'] }
const limitedGate = { 'r0-review': APPROVE, 'r0-gate': limited() }
const failedAtReview = (result) => assert.deepEqual([result.status, result.stage], ['failed', 'review'])
const reviewFinding = finding('a.py:1', 'review finding')
const gateFinding = finding('b.py:2', 'gate finding')
const fixedOnce = { 'fix-1': { ...resumeFix, files: ['src/x.py'] } }

test('usage-limit: a limited gate beside an approving review makes the lane await the head with the limit and starts nothing else', async () => {
  const { result, launchedAgents } = await runLane(materialLane, limitedGate)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'review'])
  assert.deepEqual(result.limits, [{ role: 'gate', model: result.routing.gate.model, line: limitLine, resetsAt: 'Nov 4th, 2026 7:57 AM' }])
  assert.ok(!launchedAgents.some(label => /^(fix|e2e|ci)/.test(label)), launchedAgents.join())
})

test('usage-limit: a limited Codex review (reviewer codex) makes the lane await the head with role review', async () => {
  const { result } = await runLane({ ...materialLane, reviewer: 'codex' }, { 'r0-review': limited(), 'r0-gate': { ...APPROVE, codexExit: 0 } })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'review'])
  assert.deepEqual([result.limits[0].role, result.limits[0].model], ['review', result.routing.review.model])
})

test('usage-limit: a limit line without a reset time gives resetsAt null and a reason that says no reset time was named', async () => {
  const { result } = await runLane(materialLane, { ...limitedGate, 'r0-gate': limited('You have hit your usage limit.', null) })
  assert.equal(result.limits[0].resetsAt, null)
  assert.match(result.reason, /named no reset time/)
})

test('usage-limit: a limit beside a clean Codex exit is dropped and the lane fails at review', async () => {
  const { result } = await runLane(materialLane, { ...limitedGate, 'r0-gate': limited(limitLine, null, 0), 'r0-gate-reread': limited(limitLine, null, 0) })
  failedAtReview(result)
})

for (const [name, answer] of [
  ['an exit of -1', limited(limitLine, null, -1)],
  ['a line without the phrase', limited('Error: stream disconnected', null)],
]) {
  test(`usage-limit: a limit with ${name} fails the lane at review`, async () => {
    const { result } = await runLane(materialLane, { ...limitedGate, 'r0-gate': answer })
    failedAtReview(result)
  })
}

test('usage-limit: a failed Claude review carrying a limit fails the lane at review', async () => {
  const { result } = await runLane(resumedLane, { 'r0-review': limited() })
  failedAtReview(result)
})

test('usage-limit: a real failure beside a limit fails the lane at review', async () => {
  const { result } = await runLane({ ...resumedLane, risk: 'material', reviewer: 'codex' }, { 'r0-review': limited(), 'r0-gate': { verdict: 'failed', blocking: [], followups: [], codexExit: 2, note: 'boom' } })
  failedAtReview(result)
})

test('usage-limit: an architectural verdict beside a limit escalates the lane', async () => {
  const { result } = await runLane(materialLane, { 'r0-review': { ...APPROVE, verdict: 'architectural' }, 'r0-gate': limited() })
  assert.equal(result.status, 'escalated')
})

test('usage-limit: an empty REVISE beside a limit fails the lane at review', async () => {
  const { result } = await runLane(materialLane, { 'r0-review': { verdict: 'REVISE', blocking: [], followups: [] }, 'r0-gate': limited() })
  failedAtReview(result)
})

test('usage-limit: a limited review beside a gate REVISE after a fix hands back the fixer held tip, the gate findings and the review findings it answers', async () => {
  const { result } = await runLane({ ...resumeArgs, risk: 'material', reviewer: 'codex' }, {
    'r0-review': { verdict: 'REVISE', blocking: [reviewFinding], followups: [], codexExit: 0 }, 'r0-gate': { ...APPROVE, codexExit: 0 }, ...fixedOnce,
    'r1-review': limited(), 'r1-gate': { verdict: 'REVISE', blocking: [gateFinding], followups: [], codexExit: 0 },
  })
  assert.equal(result.status, 'awaiting-head')
  assert.equal(result.deltaFrom, resumeTip)
  assert.deepEqual(result.lastBlocking, [gateFinding])
  assert.match(result.answers, /review finding/)
})

test('usage-limit: a limited gate re-check after a fix hands back the tip before the fix and the gate findings it answers', async () => {
  const { result } = await runLane({ ...resumeArgs, risk: 'material', productionPaths: ['src/'] }, {
    'r0-review': APPROVE, 'r0-gate': { verdict: 'REVISE', blocking: [gateFinding], followups: [], codexExit: 0 }, ...fixedOnce, 'r1-gate': limited(),
  })
  assert.equal(result.deltaFrom, resumeTip)
  assert.match(result.answers, /gate finding/)
})

const olderTip = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'

test('usage-limit: a resumed run whose first round is limited returns the deltaFrom it was given', async () => {
  const { result } = await runLane({ ...materialLane, deltaFrom: olderTip, answers: 'earlier findings' }, limitedGate)
  assert.equal(result.deltaFrom, olderTip)
  assert.match(result.answers, /earlier findings/)
})

test('usage-limit: a limited whole-lane first round returns no deltaFrom and no answers', async () => {
  const { result } = await runLane(materialLane, limitedGate)
  assert.ok(!('deltaFrom' in result) && !('answers' in result))
})

for (const [name, extra, expected] of [['with deltaFrom', { deltaFrom: olderTip }, olderTip], ['without deltaFrom', {}, undefined]]) {
  test(`usage-limit: a limited carried-batch round ${name} returns that deltaFrom, never the carried fix tip`, async () => {
    const { result } = await runLane({ ...resumeArgs, risk: 'material', productionPaths: ['src/'], fixFirst: [reviewFinding], ...extra }, { 'fix-1': { ...resumeFix, files: ['tests/x.py'] }, 'r1-review': APPROVE, 'r1-gate': limited() })
    assert.equal(result.status, 'awaiting-head')
    assert.equal(result.deltaFrom, expected)
  })
}

test('usage-limit: the reason names fixFirst only when there are findings to carry', async () => {
  const empty = await runLane(materialLane, limitedGate)
  assert.deepEqual(empty.result.lastBlocking, [])
  assert.doesNotMatch(empty.result.reason, /fixFirst/)
  const carrying = await runLane({ ...materialLane, reviewer: 'codex' }, { 'r0-review': limited(), 'r0-gate': { verdict: 'REVISE', blocking: [gateFinding], followups: [], codexExit: 0 } })
  assert.match(carrying.result.reason, /fixFirst/)
})

const lastLineCommand = (prompt) => prompt.match(/run: (grep -v \S+ \S+ \| tail -n 1)/)[1]

test('usage-limit: the courier clears run.log first, reads the last non-empty line, names the phrase and never retries a limit', async () => {
  const { agentCalls } = await runLane(materialLane, limitedGate)
  const prompt = agentCalls['r0-gate'].prompt
  assert.match(prompt, /1\. rm -f [^\n]*-run\.log/)
  assert.match(prompt, /hit your usage limit/)
  assert.match(prompt, /never retry a limit/i)
  assert.ok(lastLineCommand(prompt))
})

for (const [name, content, printed] of [
  ['quotes the phrase earlier', `the brief says: you’ve hit your usage limit\nmore output\nError: stream closed\n\n  \n`, 'Error: stream closed\n'],
  ['ends on the phrase before blank lines', `more output\nYou’ve hit your usage limit.\n\n  \n`, 'You’ve hit your usage limit.\n'],
]) {
  test(`usage-limit: the courier last-line command prints only the last non-empty line of a run.log that ${name}`, async () => {
    const { agentCalls } = await runLane(materialLane, limitedGate)
    const command = lastLineCommand(agentCalls['r0-gate'].prompt)
    const log = command.match(/(\/\S+-run\.log)/)[1]
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-review-log-'))
    try {
      fs.writeFileSync(path.join(root, 'run.log'), content)
      const ran = spawnSync('sh', ['-c', command.replace(log, path.join(root, 'run.log'))], { encoding: 'utf8' })
      assert.equal(ran.stdout, printed)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

// ---- a limited gate re-check of a test-only delta is stood in for by a fresh reviewer at the review routing
const gateRevise = { verdict: 'REVISE', blocking: [gateFinding], followups: [], codexExit: 0 }
const standInLane = { ...resumeArgs, risk: 'material', productionPaths: ['src/'] }
const testOnlyFix = { 'fix-1': { ...resumeFix, files: ['tests/x.py'] } }
const standInAnswers = { 'r0-review': APPROVE, 'r0-gate': gateRevise, ...testOnlyFix, 'r1-gate': limited(), 'r1-standin': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) }
const standInRun = (args = {}, answers = {}) => runLane({ ...standInLane, ...args }, { ...standInAnswers, ...answers })
const waitsAtReview = (result) => assert.deepEqual([result.status, result.stage], ['awaiting-head', 'review'])

test('gate-stand-in: a limited gate re-check of a test-only fix is re-checked by a fresh reviewer at the review routing, then the lane reaches ready-to-land naming the unseen range', async () => {
  const { result, agentCalls, launchedAgents } = await standInRun()
  assert.equal(result.status, 'ready-to-land')
  const { model, effort } = agentCalls['r1-standin'].options
  assert.deepEqual({ model, effort }, result.routing.review)
  assert.match(agentCalls['r1-standin'].prompt, /gate finding/)
  assert.ok(agentCalls['r1-standin'].prompt.includes(`git diff ${resumeTip}..HEAD`))
  assert.ok(launchedAgents.includes('e2e-0') || launchedAgents.includes('ci-0'))
  assert.deepEqual(result.gateUnseen, { seenTip: resumeTip, tip: resumeFixedTip, findings: [gateFinding], limit: { role: 'gate', model: result.routing.gate.model, line: limitLine, resetsAt: 'Nov 4th, 2026 7:57 AM' } })
  assert.equal(result.requiredHeadActions.filter(line => line.includes(`${resumeTip}..${resumeFixedTip}`)).length, 1)
})

const standInRefused = [
  ['the fix resolved a lane conflict', { 'fix-1': { ...resumeFix, files: ['tests/x.py'], mergeResolvedLaneConflict: true } }, {}],
  ['the lane routes its review to Codex', { 'r0-review': { ...APPROVE, codexExit: 0 } }, { reviewer: 'codex' }],
  ['productionPaths was not passed', {}, { productionPaths: undefined }],
]
for (const [name, answers, args] of standInRefused) {
  test(`gate-stand-in: the lane waits when ${name}`, async () => {
    const { result, launchedAgents } = await standInRun(args, answers)
    waitsAtReview(result)
    assert.ok(!launchedAgents.includes('r1-standin'))
  })
}

test('gate-stand-in: the lane waits when the review raises a finding in the round beside the limited gate', async () => {
  const { result, launchedAgents } = await standInRun({}, { 'r0-review': { verdict: 'REVISE', blocking: [reviewFinding], followups: [], codexExit: 0 }, 'r1-review': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] } })
  waitsAtReview(result)
  assert.ok(!launchedAgents.includes('r1-standin'))
})

test('gate-stand-in: a stand-in REVISE answered by a test-only fix and approved leaves the first seen tip and the final tip in gateUnseen', async () => {
  const secondTestFix = { ...secondFix, files: ['tests/y.py'] }
  const { result } = await standInRun({}, {
    'r1-standin': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] }, 'fix-2': secondTestFix, 'r2-standin': APPROVE, 'ci-0': greenCi(secondFix.head),
  })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual([result.gateUnseen.seenTip, result.gateUnseen.tip], [resumeTip, secondFix.head])
})

test('gate-stand-in: a production fix after the stand-in with the gate limited again waits and carries gateUnseen', async () => {
  const { result } = await standInRun({}, {
    'r1-standin': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] }, 'fix-2': { ...secondFix, files: ['src/y.py'] }, 'r2-gate': limited(), 'r2-standin': APPROVE,
  })
  waitsAtReview(result)
  assert.deepEqual([result.gateUnseen.seenTip, result.gateUnseen.tip], [resumeTip, secondFix.head])
  assert.ok(!('requiredHeadActions' in result))
})

test('gate-stand-in: a production fix after the stand-in runs the gate, and ready-to-land keeps the first seen tip', async () => {
  const { result, launchedAgents } = await standInRun({}, {
    'r1-standin': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] }, 'fix-2': { ...secondFix, files: ['src/y.py'] }, 'r2-gate': { ...APPROVE, codexExit: 0 }, 'r2-standin': APPROVE,
    'ci-0': greenCi(secondFix.head),
  })
  assert.ok(launchedAgents.includes('r2-gate'))
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.gateUnseen.seenTip, resumeTip)
})

const thirdFix = { ...secondFix, head: 'f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4', parents: [secondFix.head] }
const testGapFinding = { ...gateFinding, kind: 'test-gap' }
const removalProof = { finding: 1, test: 'removed_test.py [case]', failedBefore: false, passesAfter: true, resolution: 'removed-vacuous', diff: '-    def test_asserts_nothing(): pass' }

test('gate-stand-in: the stand-in is given the removal diff and the fold-ins the limited gate re-check would have judged', async () => {
  const { result, agentCalls } = await standInRun({}, {
    'r0-review': { ...APPROVE, followups: [tidy] }, 'r0-gate': { ...gateRevise, blocking: [testGapFinding] }, 'fix-1': { ...resumeFix, files: ['tests/x.py'], regression: [removalProof] },
  })
  assert.equal(result.status, 'ready-to-land', result.reason)
  const prompt = agentCalls['r1-standin'].prompt
  assert.ok(prompt.includes(removalProof.diff))
  assert.match(prompt, /judge whether the removed test pinned no behaviour/)
  assert.ok(prompt.includes(tidy.text))
})

test('gate-stand-in: a second stand-in re-checks from the tip of the latest gate round, not from the first unseen tip', async () => {
  const { result, agentCalls } = await standInRun({}, {
    'r1-standin': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] }, 'fix-2': { ...secondFix, files: ['src/y.py'] },
    'r2-gate': { ...gateRevise, blocking: [finding('c.py:3', 'second gate finding')] }, 'r2-standin': APPROVE, 'fix-3': { ...thirdFix, files: ['tests/z.py'] }, 'r3-gate': limited(), 'r3-standin': APPROVE, 'ci-0': greenCi(thirdFix.head),
  })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(agentCalls['r3-standin'].prompt.includes(`git diff ${secondFix.head}..HEAD`))
  assert.equal(result.gateUnseen.seenTip, resumeTip)
})

test('gate-stand-in: an architectural verdict from the stand-in escalates the lane', async () => {
  const { result } = await standInRun({}, { 'r1-standin': { ...APPROVE, verdict: 'architectural' } })
  assert.equal(result.status, 'escalated')
})

test('gate-stand-in: a lane whose gate was never limited carries no gateUnseen', async () => {
  const { result } = await standInRun({}, { 'r1-gate': { ...APPROVE, codexExit: 0 } })
  assert.equal(result.status, 'ready-to-land')
  assert.ok(!('gateUnseen' in result))
  assert.ok(!result.requiredHeadActions.some(line => /usage limit/.test(line)))
})

test('review-reads-body: without repo the Codex courier line enters the worktree before its first gh call', async () => {
  const { repo: _repo, ...laneWithoutRepo } = bodyLane
  const { agentCalls } = await runLane({ ...laneWithoutRepo, risk: 'material', worktree: '/w/tree' }, { 'r0-review': APPROVE })
  const line = agentCalls['r0-gate'].prompt.split('\n').find(text => text.includes('codex exec'))
  assert.ok(line.indexOf('cd /w/tree') > 0 && line.indexOf('cd /w/tree') < line.indexOf('gh issue view'))
})

test('workflow-runtime: a workflow script naming a Node or web global fails under the harness with a ReferenceError', async () => {
  const { result } = await driveGate({ transformChild: (source) => `new TextEncoder()\n${source}` })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.match(result.reason, /TextEncoder is not defined/)
})

test('review-brief-checksum: the checksum in the Codex courier command equals what its printer prints for a brief with two-, three- and four-byte characters', async () => {
  const contract = 'Größe é, 日本語 の契約, 🙂 and 𝔘𝔫𝔦𝔠𝔬𝔡𝔢'
  const { agentCalls } = await runLane({ ...resumedLane, contract, risk: 'material' }, { 'r0-review': APPROVE })
  const prompt = agentCalls['r0-gate'].prompt
  const brief = prompt.match(/-----\n([\s\S]*?)\n-----\n3\. /)[1]
  const printer = prompt.match(/python3 -c '([^']*)'/)[1]
  const checksum = prompt.match(/= ([0-9a-f]{8}) \] \|\|/)[1]
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-checksum-'))
  try {
    const briefFile = path.join(directory, 'brief.md')
    fs.writeFileSync(briefFile, `${brief}\n`)
    const stdin = fs.openSync(briefFile, 'r')
    const printed = spawnSync('python3', ['-c', printer], { stdio: [stdin, 'pipe', 'pipe'], encoding: 'utf8' })
    fs.closeSync(stdin)
    assert.ok(brief.includes('🙂') && brief.includes('日本語') && brief.includes('é'))
    assert.equal(printed.status, 0, printed.stderr)
    assert.equal(printed.stdout.trim(), checksum)
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

// ---- a Claude reviewer that fails is started once more, fresh
const reviewerRuns = (launchedAgents) => launchedAgents.filter(label => label.startsWith('r0-review'))
const reviewerAnswerWith = (first, second = APPROVE) => {
  const queue = [first, second]
  const next = () => { const answer = queue.shift(); return typeof answer === 'function' ? answer() : answer }
  return { 'r0-review': next, 'r0-review-retry': next }
}
const throwing = (message) => () => { throw new Error(message) }

for (const [name, failure] of [
  ['no answer', () => null],
  ['a thrown error', throwing('API Error: the request was refused')],
  ['the verdict failed', () => ({ verdict: 'failed', blocking: [], followups: [], note: 'no diff was supplied' })],
]) {
  test(`reviewer-retry: a Claude reviewer with ${name} is started once more with the same brief and the round is judged on the retry`, async () => {
    const { result, launchedAgents, agentCalls } = await runLane(resumedLane, { ...reviewerAnswerWith(failure), 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
    assert.deepEqual(reviewerRuns(launchedAgents), ['r0-review', 'r0-review-retry'])
    assert.equal(agentCalls['r0-review-retry'].prompt, agentCalls['r0-review'].prompt)
    assert.deepEqual(result.history.map(round => [round.by, round.verdict]), [['review', 'APPROVE']])
  })
}

test('reviewer-retry: two failures end the round at review and the reason carries both texts', async () => {
  const { result, launchedAgents } = await runLane(resumedLane, reviewerAnswerWith(throwing('API Error: safeguards flagged this message'), () => ({ verdict: 'failed', blocking: [], followups: [], note: 'no diff was supplied' })))
  assert.deepEqual(reviewerRuns(launchedAgents), ['r0-review', 'r0-review-retry'])
  failedAtReview(result)
  assert.match(result.reason, /safeguards flagged this message/)
  assert.match(result.reason, /no diff was supplied/)
})

test('reviewer-retry: a failure text longer than a sane length is shortened in the reason', async () => {
  const { result } = await runLane(resumedLane, reviewerAnswerWith(throwing('e'.repeat(5000)), () => null))
  failedAtReview(result)
  assert.ok(result.reason.length < 1200, result.reason.length)
})


// ---- an Opus gate stand-in runs as a fresh Claude reviewer, retried and repeated like any Claude reviewer
const opusGateLane = { ...resumeArgs, risk: 'material', productionPaths: ['src/'], routing: { gate: { model: 'opus', effort: 'high' } } }
const everyGateRun = (launchedAgents) => launchedAgents.filter(label => label.includes('-gate'))
const productionFix = { 'fix-1': { ...resumeFix, files: ['src/x.py'] } }
const claudeGateRevise = { verdict: 'REVISE', blocking: [gateFinding], followups: [] }
const afterProductionFix = { 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip), ...productionFix, 'r1-gate': APPROVE }

for (const [what, firstRound, gateFirst] of [
  ['raised the findings itself', { 'r0-review': APPROVE, 'r0-gate': claudeGateRevise }, 'REVISE'],
  ['was added after a fix the review asked for touched production', { 'r0-review': { verdict: 'REVISE', blocking: [reviewFinding], followups: [] }, 'r0-gate': APPROVE, 'r1-review': APPROVE }, 'APPROVE'],
]) {
  test(`gate-opus-standin: the stand-in re-checks a production fix on the same routing when it ${what}`, async () => {
    const { result, agentCalls, launchedAgents } = await runLane(opusGateLane, { ...afterProductionFix, ...firstRound })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.deepEqual(everyGateRun(launchedAgents), ['r0-gate', 'r1-gate'])
    const { model, effort, agentType } = agentCalls['r1-gate'].options
    assert.deepEqual({ model, effort, agentType }, { model: 'opus', effort: 'high', agentType: agentCalls['r0-review'].options.agentType })
    assert.doesNotMatch(agentCalls['r1-gate'].prompt, /codex exec/)
    assert.deepEqual(result.history.filter(entry => entry.by === 'gate').map(entry => entry.verdict), [gateFirst, 'APPROVE'])
  })
}

test('gate-opus-standin: a stand-in gate that fails is started once more with the same brief and the round is judged on the retry', async () => {
  const queue = [() => null, () => APPROVE]
  const next = () => queue.shift()()
  const { result, agentCalls, launchedAgents } = await runLane(opusGateLane, { 'r0-review': APPROVE, 'r0-gate': next, 'r0-gate-retry': next, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) })
  assert.deepEqual(everyGateRun(launchedAgents), ['r0-gate', 'r0-gate-retry'])
  assert.equal(agentCalls['r0-gate-retry'].prompt, agentCalls['r0-gate'].prompt)
  assert.equal(result.status, 'ready-to-land', result.reason)
})
