// Drives the atelier lane workflow script with a stub agent runner; shared by the lane workflow tests.
import fs from 'node:fs'

const LANE_SCRIPT = new URL('../plugins/atelier/workflows/lane.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// answers holds each agent's result by its label; an agent without one ends without a result. Without answers only
// the sync step answers (an up-to-date lane), so a run gets as far as starting its first review round.
export async function runLane(args, answers = {}) {
  const source = fs.readFileSync(LANE_SCRIPT, 'utf8').replace(/^export const meta/m, 'const meta')
  const launchedAgents = []
  const agentCalls = {}
  const cleanSync = { merged: false, tip: args.tip, stoppedOnConflict: false }
  const coveredByClaim = { outside_claim: '[]' }
  const defaultAnswerFor = (label) => label === 'sync' ? cleanSync : label.startsWith('scope-') ? coveredByClaim : null
  // The remote branch carries the newest tip a builder or fixer returned, unless a test says what the push printed
  // or the answer carries the error of a failed push.
  let newestTip = args.tip
  const pushPrintedSomething = (answer) => !answer.command_error || 'remote_tip' in answer
  const answerFor = (label) => {
    const answer = label in answers ? structuredClone(answers[label]) : defaultAnswerFor(label)
    if (answer?.tip && /^(build|fix-|sync)/.test(label)) newestTip = answer.tip
    return label.startsWith('scope-') && answer && pushPrintedSomething(answer) ? { remote_tip: newestTip, ...answer } : answer
  }
  const agent = async (prompt, options = {}) => { launchedAgents.push(options.label); agentCalls[options.label] = { prompt, options }; return answerFor(options.label) }
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk()))
  const ignore = () => {}
  const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', source)
  const result = await run(args, agent, parallel, async () => [], ignore, ignore)
  return { result, launchedAgents, agentCalls }
}
