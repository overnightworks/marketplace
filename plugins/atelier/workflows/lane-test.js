export const meta = {
  name: 'lane-test',
  description: 'Internal to the lane workflow, never started by a head: runs the explorative end-to-end tester of one pull request tip, with a fallback agent, and returns its answer with the history entry, the follow-ups at the tested tip and the reason an empty verdict is unusable; the lane judges the rest itself.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_TEST_PROTOCOL = 3
const A = args || {}
if (A.protocolQuery) return { protocol: LANE_TEST_PROTOCOL }
const need = ['protocol', 'delegatedLine', 'n', 'pr', 'tip', 'worktree', 'scratch', 'tag', 'e2e', 'contract', 'laneFacts', 'blockingLine', 'finding', 'followup', 'routing']
if (A.protocol !== LANE_TEST_PROTOCOL) return { refused: `lane-test speaks protocol ${JSON.stringify(LANE_TEST_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const { pr, tip } = A

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
async function agentOrNull(prompt, opts) {
  try {
    return await agent(`${A.delegatedLine}\n${prompt}`, opts)
  } catch (error) {
    log(`${opts.label} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

const E2E = {
  type: 'object',
  required: ['verdict', 'blocking', 'followups', 'cells'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'failed'] },
    blocking: { type: 'array', items: A.finding },
    followups: { type: 'array', items: A.followup },
    cells: {
      type: 'array', description: 'every cell you drove or chose not to drive; the head reads your verdict from here; scratch is only transport',
      items: { type: 'object', required: ['cell', 'result', 'command', 'exit'], properties: { cell: { type: 'string', description: 'what was driven' }, result: { type: 'string', enum: ['held', 'failed', 'not driven'] }, command: { type: 'string', description: 'the command or action' }, exit: { type: 'string', description: 'its exit code or observed outcome' } } },
    },
    evidencePath: { type: 'string' },
    lockBusy: { type: 'boolean', description: 'true when probe-run exited 3 without starting the stack because the load stayed above the limit, and the live part could not run' },
  },
}

function explore() {
  const prompt =
    `${A.laneFacts}\nYou test PR #${pr} at its lane tip ${tip} through the real entry point, like a curious user, before it lands. ` +
    `Run the lane's code, not the installed tool (from ${A.worktree}). What to drive:\n${A.e2e}\n\nContract:\n${A.contract}\n\n${A.blockingLine}\n` +
    `For every blocking finding give a scenario name in where, unique within your report, the command that shows it in repro, and — when it can be automated stably — a failing test draft ` +
    `under your scratch path in testDraft (a live or UI case stays a manual proof; leave testDraft empty then). ` +
    `First create your own directory with \`mktemp -d ${A.scratch}/${A.tag}-e2e-${A.n}-XXXXXX\` and write only there, besides the environment the repository's own sync command creates in ${A.worktree}. For any server, browser or E2E run load the atelier:explorative-testing skill and follow its Probe stack section; use a free port above 8790 and keep your pid files in your directory. ` +
    `Never touch another session's server. ` +
    `Drive only the cells no named CI test proves; for every cell you skip, name the CI test that proves it, judge that test against the cell and mark the cell held or failed on that reading. ` +
    `Prepare and check everything that needs no server or browser first (build the page, install dependencies, start a throwaway database), because a setup that fails inside probe-run spends your turn; wrap only the drive in \`probe-run\`, which waits up to 3600 seconds until the 1-minute load is below 1.5 × cores. ` +
    `If probe-run exits 3 (it ends without starting the stack because the load stayed above the limit), return verdict failed with lockBusy true instead of guessing. ` +
    `verdict is PASS with no blocking findings and FAIL with at least one. A PASS needs at least one held cell. Return every cell in cells, each with its command and exit; return evidencePath too, keep your evidence under evidencePath and remove your playground before you report.`
  return agentOrNull(prompt, { label: `e2e-${A.n}`, phase: 'Test and CI', schema: E2E, agentType: 'atelier:explorative-tester', ...A.routing })
    .then(r => r || agentOrNull(`Load the atelier:explorative-testing skill first.\n${prompt}`,
      { label: `e2e-${A.n}-fallback`, phase: 'Test and CI', schema: E2E, agentType: 'general-purpose', ...A.routing }))
}

// A blocking finding outranks a PASS label, as in the classifier of lane-review.js.
function emptyVerdictReason(answer) {
  if (answer.verdict === 'PASS' && !(answer.cells || []).some(c => c.result === 'held')) return 'a PASS without driven cells: the tester named no held cell'
  if (answer.verdict === 'FAIL' && (answer.blocking || []).length === 0) return 'a FAIL verdict came without any blocking finding'
  return ''
}

// The lane adds the point of the run where it judges the answer, because fix rounds can pass while the tester works.
function recordedAnswer(answer) {
  if (!answer) return answer
  const blocking = answer.blocking || []
  return {
    ...answer,
    emptyVerdictReason: emptyVerdictReason(answer),
    historyEntry: { by: `e2e-${A.n}`, verdict: blocking.length ? 'FAIL' : 'PASS', blocking: blocking.map(f => f.where), cells: answer.cells || [], reportPath: answer.evidencePath || '' },
    followups: (answer.followups || []).map(f => ({ ...f, tip })),
  }
}

return recordedAnswer(await explore())
