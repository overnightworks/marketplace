// Runs the explorative end-to-end tester of one pull request tip, with a fallback agent, and returns its answer with the history entry, the follow-ups at the tested tip and the reason an empty verdict is unusable; the lane judges the rest itself.
export async function laneTest(A) {
  const { pr, tip } = A

  // An end without a result is a null the lane reports.
  const agentOrNull = (prompt, opts) => agentAnswer(`${A.delegatedLine}\n${prompt}`, opts)

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
      design: DESIGN_RESULT,
      lockBusy: { type: 'boolean', description: 'true when probe-run exited 75 without starting the stack because the load stayed above the limit, and the live part could not run' },
    },
  }

  function explore() {
    const fixRange = A.fixRange && `This is a delta re-check of a fix: the fix is \`git diff ${A.fixRange.from}..HEAD\` and answers these findings of your earlier round:\n${A.fixRange.findings}\n` +
      `Judge whether the repair holds and opened nothing new, and still drive the real flow in full. Mark a new finding against the lane's whole diff, \`git diff origin/main...HEAD\`, not the fix range.\n\n`
    const prompt =
      `${A.laneFacts}\nYou test PR #${pr} at its lane tip ${tip} through the real entry point, like a curious user, before it lands. ` +
      `Run the lane's code, not the installed tool (from ${A.worktree}). What to drive:\n${A.e2e}\n\nContract:\n${A.contract}\n\n${fixRange || ''}${A.blockingLine}${A.surfaceFacts}\n` +
      `For every blocking finding give a scenario name in where, unique within your report, the command that shows it in repro, and — when it can be automated stably — a failing test draft ` +
      `under your scratch path in testDraft (a live or UI case stays a manual proof; leave testDraft empty then). ` +
      `First create your own directory with \`mktemp -d ${A.scratch}/${A.tag}-e2e-${A.n}-XXXXXX\` and write only there, besides the environment the repository's own sync command creates in ${A.worktree}. For any server, browser or E2E run load the atelier:explorative-testing skill and follow its Probe stack section; use a free port above 8790 and keep your pid files in your directory. ` +
      `Never touch another session's server. ` +
      `Drive only the cells no named CI test proves; for every cell you skip, name the CI test that proves it, judge that test against the cell and mark the cell held or failed on that reading. ` +
      `The state of a CI check (green, red, pending) is the CI step's to judge and never your finding; a CI test counts only as the proof of one of your cells. ` +
      `Prepare and check everything that needs no server or browser first (build the page, install dependencies, start a throwaway database), because a setup that fails inside probe-run spends your turn; wrap only the drive in \`probe-run\`, which waits for the load limit and ends the stack at the cap, both as \`probe-run\` states them. ` +
      `If probe-run exits 75 (it ends without starting the stack because the load stayed above the limit), return verdict failed with lockBusy true instead of guessing. ` +
      `verdict is PASS with no blocking findings and FAIL with at least one. A PASS needs at least one held cell. Return every cell in cells, each with its command and exit; return evidencePath too, keep your evidence under evidencePath and remove your playground before you report.`
    return agentOrNull(prompt, { label: `e2e-${A.n}`, phase: 'Test and CI', schema: E2E, agentType: 'atelier:explorative-tester', ...A.routing })
      .then(r => r || agentOrNull(`Load the atelier:explorative-testing skill first.\n${prompt}`,
        { label: `e2e-${A.n}-fallback`, phase: 'Test and CI', schema: E2E, agentType: 'general-purpose', ...A.routing }))
  }

  // The lane adds the point of the run where it judges the answer, because fix rounds can pass while the tester works.
  function recordedAnswer(raw) {
    if (!raw) return raw
    const answer = relativeAnswer(raw, A.roots)
    const blocking = answer.blocking || []
    const design = designRecord(answer, A.surfaced, tip)
    return {
      ...answer,
      emptyVerdictReason: emptyVerdictReason(answer),
      historyEntry: { by: `e2e-${A.n}`, verdict: blocking.length ? 'FAIL' : 'PASS', blocking: blocking.map(f => f.where), cells: answer.cells || [], reportPath: answer.evidencePath || '', ...design.entry },
      followups: [...(answer.followups || []).map(f => ({ ...f, stage: 'test', tip })), ...design.followups],
    }
  }

  return recordedAnswer(await explore())
}

// A blocking finding outranks a PASS label, as in the classifier of review.js.
function emptyVerdictReason(answer) {
  if (answer.verdict === 'PASS' && !(answer.cells || []).some(c => c.result === 'held')) return 'a PASS without driven cells: the tester named no held cell'
  if (answer.verdict === 'FAIL' && (answer.blocking || []).length === 0) return 'a FAIL verdict came without any blocking finding'
  return ''
}

// The tester's state across rounds, assigned in this file only; every part shares the bundle's one scope.
let testSettled = false
let pendingTest = null  // the tester started and not yet judged
let testBlocking = []  // the tester's findings, held until a fix batch takes them
let lastTestedTip = null  // the tip the last tester round that returned a verdict started on
let lastTestRaised = []  // the blocking findings that round raised, which the fix answers
let pendingTestTip = null
function trackTest(startedOnTip, running) {
  testSettled = false
  pendingTestTip = startedOnTip
  pendingTest = running.then(e2e => {
    testSettled = true
    return e2e
  })
}
const takePendingTest = () => pendingTest.then(e2e => {
  pendingTest = null
  return e2e
})
// Why the tester's answer cannot be used, or '' when it can; the one judge of an answer, for the stage and for an early stop.
function unusableTesterReason(e2e) {
  if (e2e?.problem) return `the tester ${e2e.problem}`
  if (e2e && typeof e2e.verdict !== 'string') return `lane-test answered without a verdict: ${JSON.stringify(e2e).slice(0, 200)}`
  if (e2e?.verdict === 'failed' && e2e.lockBusy) return 'the load wait kept the tester from running: the load stayed above the limit'
  if (!e2e || e2e.verdict === 'failed') return 'the tester returned no usable result'
  return e2e.emptyVerdictReason || ''
}
// A usable verdict joins the round state, the history and the follow-ups.
function recordUsableTest(e2e) {
  recordTestRound(e2e.blocking || [])
  history.push({ after: spent.total, ...e2e.historyEntry })
  followups.push(...e2e.followups)
}
// A run that ends early waits for a tester still running: a usable verdict is recorded and its findings go to the result; any other answer comes back as `unusable` for the run's reason. Returns nothing when no tester runs.
async function settleTesterAtStop() {
  if (!pendingTest) return {}
  const e2e = await takePendingTest()
  const unusable = unusableTesterReason(e2e)
  if (unusable) return { unusable }
  recordUsableTest(e2e)
  return { testerAtStop: { verdict: e2e.verdict, blocking: e2e.blocking || [] } }
}
function recordTestRound(blocking) {
  testBlocking = blocking
  lastTestedTip = pendingTestTip
  lastTestRaised = blocking
}
function takeTestBlocking() {
  const taken = testBlocking
  testBlocking = []
  return taken
}
// A round after a settled one, on a later tip, re-checks the fix range of the findings that round raised; a first round and a retry of one without a verdict carry none.
const fixRangeOfTest = () => lastTestedTip && !sameCommit(lastTestedTip, tip) ? { from: lastTestedTip, findings: lastTestRaised.length ? listFindings(lastTestRaised) : '(none: the fix answers CI or review only)' } : undefined
