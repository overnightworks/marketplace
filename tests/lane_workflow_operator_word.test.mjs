// The operator's word lifts the routing caps; the lane reads it only where the item quotes it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumeArgs, resumedLane, APPROVE, reachesTheEnd, noWait } from './lane_workflow_harness.mjs'

const operatorWord = 'Opus xhigh for the builder, Fable for the review'
const itemQuoting = (word) => ({ branch: { item_body: `The operator said:\n\n> "${word}"\n\nSource: the chat.` } })
const wordLane = { ...resumeArgs, operatorWord }
const withWordAnswers = { ...reachesTheEnd, 'r0-review': APPROVE, ...itemQuoting(operatorWord) }

test('operatorWord: a build at opus xhigh starts with that model and effort once the item quotes the word', async () => {
  const build = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'b', operatorWord, routing: { build: { model: 'opus', effort: 'xhigh' } } }
  const { agentCalls } = await runLane(build, itemQuoting(operatorWord))
  assert.deepEqual([agentCalls.build.options.model, agentCalls.build.options.effort], ['opus', 'xhigh'])
})

test('operatorWord: the result of a lane above the cap tells the head to quote the word in the pull request body and carries it', async () => {
  const { result } = await runLane({ ...wordLane, routing: { review: { model: 'opus', effort: 'xhigh' } } }, withWordAnswers)
  assert.equal(result.status, 'ready-to-land')
  assert.equal(result.operatorWord, operatorWord)
  assert.equal(result.requiredHeadActions.filter(action => action.includes('operatorWord') && /quote/.test(action) && action.includes(`#${resumeArgs.pr}`)).length, 1)
})

test('operatorWord: a lane without the argument carries no operatorWord and no quote action', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEnd, 'r0-review': APPROVE })
  assert.equal(result.operatorWord, undefined)
  assert.ok(!result.requiredHeadActions.some(action => action.includes('operatorWord')))
})

test('operatorWord: fable is accepted for a Claude role with the word', async () => {
  const { agentCalls } = await runLane({ ...wordLane, routing: { review: { model: 'fable', effort: 'max' } } }, withWordAnswers)
  assert.deepEqual([agentCalls['r0-review'].options.model, agentCalls['r0-review'].options.effort], ['fable', 'max'])
})

const stillRefusedWithTheWord = [
  ['a Codex role at xhigh', { review: { effort: 'xhigh' } }, 'codex', /codex.*low, medium, high/i],
  ['a Codex gate at max', { gate: { effort: 'max' } }, undefined, /codex.*low, medium, high/i],
  ['a gate on the builder\'s provider', { gate: { model: 'sonnet', effort: 'high' } }, undefined, /gate provider separation/],
  ['a Claude gate other than the opus stand-in at high', { gate: { model: 'opus', effort: 'xhigh' } }, undefined, /stand-in/],
  ['a Claude review model for a Codex reviewer', { review: { model: 'fable', effort: 'high' } }, 'codex', /provider/],
  ['a Codex builder', { build: { model: 'gpt-6-astra' } }, undefined, /provider/],
]

for (const [what, routing, reviewer, reason] of stillRefusedWithTheWord) {
  test(`operatorWord: with the word, ${what} stays refused at input before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...wordLane, risk: 'material', reviewer, routing }, withWordAnswers)
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, reason)
    assert.deepEqual(launchedAgents, [])
  })
}

const refusedWithoutTheWord = [
  ['opus above medium', { review: { model: 'opus', effort: 'high' } }],
  ['opus at xhigh', { review: { model: 'opus', effort: 'xhigh' } }],
  ['a Claude role at max', { fix: { effort: 'max' } }],
  ['the dropped model fable', { review: { model: 'fable', effort: 'medium' } }],
]

for (const [what, routing] of refusedWithoutTheWord) {
  test(`operatorWord: without the argument ${what} stays refused and the refusal names operatorWord`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk: 'material', routing })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /operatorWord/)
    assert.deepEqual(launchedAgents, [])
  })
}

for (const value of ['', '   ', 5, null, ['x'], { word: 'x' }]) {
  test(`operatorWord: ${JSON.stringify(value)} is refused at input before any agent starts`, async () => {
    const { result, launchedAgents, agentCalls } = await runLane({ ...resumeArgs, operatorWord: value })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /operatorWord/)
    assert.deepEqual(launchedAgents, [])
    assert.equal(agentCalls.branch, undefined)
  })
}

const notQuoted = [
  ['an empty body', ''],
  ['the word without quotation marks', `The operator said ${operatorWord} in the chat.`],
  ['only part of the word quoted', 'He said "Opus xhigh for the builder" and nothing else.'],
]

for (const [what, item_body] of notQuoted) {
  test(`operatorWord: an item body with ${what} ends the lane failed at input naming the missing quote and the item, with no builder`, async () => {
    const { result, launchedAgents, agentCalls } = await runLane({ ...wordLane, build: 'b', pr: undefined, tip: undefined }, { branch: { item_body } })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.match(result.reason, /item #1.*quote|quote.*item #1/)
    assert.doesNotMatch(result.reason, /worktree/)
    assert.deepEqual(launchedAgents, [])
    assert.equal(agentCalls.build, undefined)
  })
}

const quotedForms = [
  ['straight quotation marks', `He wrote "${operatorWord}".`],
  ['German quotation marks', `Er schrieb „${operatorWord}“.`],
  ['curly quotation marks', `He wrote “${operatorWord}”.`],
  ['whitespace runs that differ from the word', `He wrote "Opus   xhigh for the builder,\n  Fable for the review".`],
]

for (const [what, item_body] of quotedForms) {
  test(`operatorWord: an item body that quotes the word in ${what} lets the lane run`, async () => {
    const { result } = await runLane(wordLane, { ...withWordAnswers, branch: { item_body } })
    assert.equal(result.status, 'ready-to-land')
  })
}

const hostileWords = [
  ['an umlaut', 'Opus für den Builder, Fable für das Review'],
  ['an emoji', 'Opus xhigh 🚀 for the builder'],
  ['a single quote', "Opus xhigh for the builder, it's the operator's call"],
  ['a double quote', 'Opus xhigh for the "builder", Fable for the review'],
  ['a percent sign', 'Opus xhigh at 100% for the builder'],
  ['a line break', 'Opus xhigh for the builder,\nFable for the review'],
]

for (const [what, word] of hostileWords) {
  test(`operatorWord: a word with ${what} that the item quotes reaches ready-to-land`, async () => {
    const { result } = await runLane({ ...resumeArgs, operatorWord: word }, { ...reachesTheEnd, 'r0-review': APPROVE, ...itemQuoting(word) })
    assert.equal(result.status, 'ready-to-land')
    assert.equal(result.operatorWord, word)
  })
}

const wordChanged = { typedCommand: (line) => line.replace(encodeURIComponent(operatorWord), encodeURIComponent('another word')) }

test('operatorWord: a printer that received another word than the lane sent fails the step before any builder starts', async () => {
  const { result, launchedAgents } = await runLane(wordLane, { ...withWordAnswers, branch: { ...itemQuoting(operatorWord).branch, ...wordChanged, typedAlways: true } })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.match(result.reason, /another operator word/)
  assert.deepEqual(launchedAgents, ['branch-reread'])
})

test('operatorWord: a printer run that received another word is read again, and the reread proves the word', async () => {
  const { result, launchedAgents } = await runLane(wordLane, { ...withWordAnswers, branch: { ...itemQuoting(operatorWord).branch, ...wordChanged } })
  assert.equal(result.status, 'ready-to-land')
  assert.ok(launchedAgents.includes('branch-reread'))
})

test('operatorWord: a failed read of the item body fails at input naming the item and the exit code', async () => {
  const { result, launchedAgents } = await runLane(wordLane, { branch: { item_code: 1, item_error: 'HTTP 404: Not Found' } })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.match(result.reason, /item #1.*exited 1.*HTTP 404/)
  assert.deepEqual(launchedAgents, [])
})

test('operatorWord: an item read that GitHub never answers waits for the head instead of failing the lane', async () => {
  const { result, launchedAgents } = await runLane(wordLane, { branch: { network_error: 'Could not resolve host: api.github.com', network_fails: 'always' } }, noWait)
  assert.equal(result.status, 'awaiting-head')
  assert.match(result.reason, /unreachable/)
  assert.deepEqual(launchedAgents, [])
})
