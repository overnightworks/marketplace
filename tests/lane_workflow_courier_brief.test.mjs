// The Codex courier's brief reaches its file by a command that cuts it out of the courier's own workflow agent transcript.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, courierBriefOf, resumedLane, APPROVE } from './lane_workflow_harness.mjs'

const roots = []
after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

const AGENT_TRANSCRIPT = 'projects/-work-repo/session-1/subagents/workflows/wf_run-1/agent-courier.jsonl'
const HOST_FRAME = '[Workflow harness — computed task] The task text below was computed at runtime by a workflow script.'
const indented = (text) => `${HOST_FRAME}\n${text.split('\n').map(line => (line ? `  ${line}` : line)).join('\n')}`
const record = (content) => `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`

// A material lane whose contract has indented lines, so the brief holds indentation the host's must not be mistaken for.
async function courierRound(contract = 'a contract\n    an indented line\n\t- a tabbed list item\n\n"quotes", $dollar, `backticks`, \\backslash, Umlaute äöü') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-brief-'))
  roots.push(root)
  const [home, scratch] = ['home', 'scratch'].map(name => fs.mkdirSync(path.join(root, name)) ?? path.join(root, name))
  const { agentCalls } = await runLane({ ...resumedLane, contract, scratch, risk: 'material' }, { 'r0-review': APPROVE })
  const prompt = agentCalls['r0-gate'].prompt
  const command = prompt.match(/^ *(python3 -c '[\s\S]*?' \S+ \S+)$/m)[1]
  const { start, brief } = courierBriefOf(prompt)
  const token = start.replace('BRIEF-START ', '')
  const briefFile = command.split(' ').at(-1)
  const place = (relative, content, { ageSeconds = 0 } = {}) => {
    const file = path.join(home, '.claude', relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    const moment = new Date(Date.now() - ageSeconds * 1000)
    fs.utimesSync(file, moment, moment)
  }
  const cut = () => {
    const ran = spawnSync('sh', ['-c', command], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
    return { ...ran, written: fs.existsSync(briefFile) ? fs.readFileSync(briefFile, 'utf8') : null }
  }
  return { prompt, command, token, brief, place, cut }
}

const noRecordLine = /^no transcript record of this courier holds the brief between its two marker lines\n$/

test('courier-cuts-brief: one transcript record gives the brief exactly as the script built it, the host indent removed', async () => {
  const { prompt, brief, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, record(indented(prompt)))
  const ran = cut()
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.written, `${brief}\n`)
  assert.equal(ran.stdout, '')
})

test('courier-cuts-brief: a prompt the host left unindented gives the same brief', async () => {
  const { prompt, brief, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, record(prompt))
  assert.equal(cut().written, `${brief}\n`)
})

test('courier-cuts-brief: two records of one text, the courier and its retry, give that text', async () => {
  const { prompt, brief, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, record(indented(prompt)))
  place('projects/-work-repo/session-1/subagents/workflows/wf_run-1/agent-retry.jsonl', record(indented(prompt)))
  const ran = cut()
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.written, `${brief}\n`)
})

test('courier-cuts-brief: the later records of the transcript, even a tool call holding the command, do not disturb the cut', async () => {
  const { prompt, brief, command, place, cut } = await courierRound()
  const toolCall = record([{ type: 'tool_use', name: 'Bash', input: { command } }])
  place(AGENT_TRANSCRIPT, record(indented(prompt)) + toolCall + record(command))
  assert.equal(cut().written, `${brief}\n`)
})

test('courier-cuts-brief: a transcript without the round on disk fails with one line and writes no file', async () => {
  const { place, cut } = await courierRound()
  const none = cut()
  place(AGENT_TRANSCRIPT, record('another round entirely'))
  const other = cut()
  for (const ran of [none, other]) {
    assert.notEqual(ran.status, 0)
    assert.match(ran.stderr, noRecordLine)
    assert.equal(ran.written, null)
  }
})

test('courier-cuts-brief: a line that holds the token but is not JSON is skipped, and the brief is still cut', async () => {
  const { prompt, brief, token, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, `{"truncated": "${token}\n` + record(indented(prompt)))
  const ran = cut()
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.written, `${brief}\n`)
})

test('courier-cuts-brief: the command itself, which spells no marker line, matches nothing', async () => {
  const { command, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, record(command))
  assert.notEqual(cut().status, 0)
})

for (const [name, mangle] of [
  ['the start marker inside a sentence', (start, text) => text.replace(start, `see ${start} here`)],
  ['the end marker followed by more text', (start, text, end) => text.replace(end, `${end} and more`)],
  ['a marker with a character appended to the token', (start, text, end) => text.replace(end, `${end}x`)],
]) {
  test(`courier-cuts-brief: ${name} is no marker line`, async () => {
    const { prompt, token, place, cut } = await courierRound()
    place(AGENT_TRANSCRIPT, record(mangle(`BRIEF-START ${token}`, prompt, `BRIEF-END ${token}`)))
    const ran = cut()
    assert.notEqual(ran.status, 0)
    assert.match(ran.stderr, noRecordLine)
  })
}

test('courier-cuts-brief: a transcript not changed in the last hour is not read', async () => {
  const { prompt, place, cut } = await courierRound()
  place(AGENT_TRANSCRIPT, record(indented(prompt)), { ageSeconds: 2 * 3600 })
  assert.match(cut().stderr, noRecordLine)
})

for (const [name, relative] of [
  ['a head session transcript', 'projects/-work-repo/session-1.jsonl'],
  ['a subagent transcript outside the workflow runs', 'projects/-work-repo/session-1/subagents/agent-courier.jsonl'],
]) {
  test(`courier-cuts-brief: ${name} holding the brief is not read`, async () => {
    const { prompt, place, cut } = await courierRound()
    place(relative, record(indented(prompt)))
    const ran = cut()
    assert.match(ran.stderr, noRecordLine)
    assert.equal(ran.written, null)
  })
}

test('courier-cuts-brief: the token names one text, so a changed brief is cut only from its own record', async () => {
  const first = await courierRound('the first contract')
  const second = await courierRound('the second contract')
  assert.notEqual(first.token, second.token)
  second.place(AGENT_TRANSCRIPT, record(indented(first.prompt)))
  assert.match(second.cut().stderr, noRecordLine)
})
