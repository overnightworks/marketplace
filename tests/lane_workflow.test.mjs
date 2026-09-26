// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const LANE_SCRIPT = new URL('../plugins/atelier/workflows/lane.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function runLane(args) {
  const source = fs.readFileSync(LANE_SCRIPT, 'utf8').replace(/^export const meta/m, 'const meta')
  const launchedAgents = []
  const agent = async (_prompt, options = {}) => { launchedAgents.push(options.label); return null }
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk()))
  const ignore = () => {}
  const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', source)
  const result = await run(args, agent, parallel, async () => [], ignore, ignore)
  return { result, launchedAgents }
}

const resumedLane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip: 'abcdef0' }

for (const risk of ['Material', 'MATERIAL', 'high']) {
  test(`refuses risk ${JSON.stringify(risk)} before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk })
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'input')
    assert.deepEqual(launchedAgents, [])
  })
}
