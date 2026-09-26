// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const LANE_SCRIPT = new URL('../plugins/atelier/workflows/lane.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function runLane(args) {
  const source = fs.readFileSync(LANE_SCRIPT, 'utf8').replace(/^export const meta/m, 'const meta')
  const launchedAgents = []
  // Only the sync step answers (an up-to-date lane), so a run gets as far as starting its first review round.
  const cleanSync = { merged: false, tip: args.tip, stoppedOnConflict: false }
  const agent = async (_prompt, options = {}) => { launchedAgents.push(options.label); return options.label === 'sync' ? cleanSync : null }
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk()))
  const ignore = () => {}
  const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', source)
  const result = await run(args, agent, parallel, async () => [], ignore, ignore)
  return { result, launchedAgents }
}

const resumedLane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip: 'abcdef0' }

const misspelledChoices = [
  ['risk', 'Material'], ['risk', 'MATERIAL'], ['risk', 'high'],
  ['reviewer', 'Codex'], ['reviewer', 'terra'],
  ['size', 's'], ['size', 'XL'],
]
for (const [name, value] of misspelledChoices) {
  test(`refuses ${name} ${JSON.stringify(value)} before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, [name]: value })
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'input')
    assert.deepEqual(launchedAgents, [])
  })
}

const firstReviewRoundByRisk = [
  [undefined, ['r0-review']],
  ['normal', ['r0-review']],
  ['material', ['r0-review', 'r0-gate']],
]
for (const [risk, reviewers] of firstReviewRoundByRisk) {
  test(`risk ${JSON.stringify(risk)} passes input and starts the reviews ${reviewers.join(' and ')}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk })
    assert.notEqual(result.stage, 'input')
    assert.deepEqual(launchedAgents, ['sync', ...reviewers])
  })
}
