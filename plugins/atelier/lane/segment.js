// A run stores its stages on the claim as segments: a segment is one aco run, the span of the run's stages between two proven points (a review that approves the tip, a gate that approves it on a material lane, the tester's pass).
// aco sums the counts and joins the verdicts over the stored runs, so each segment's record holds only its own slice of the history for the verdicts and the --ran stages, and the run's counts since the segment's start; the approvals of the earlier segments stay in the history.
// The first segment begins with the run. A later one begins right before its first stage, or at once when a tester still runs, so a run that stops at a proven point, or ends after a CI finding with no fixer, leaves no begun run without a record, and a run killed in the middle of a segment leaves one, which aco counts as lost.
let began = null  // set once aco lane-record begin ran for a segment, so the records go to the claim and landing or release takes no --record: what its read of the stored runs found
let firstBegan = null  // the read of the run's first begin: the earlier runs' approvals and the gap the misses of every segment's record are judged by, never the later reads that hold this run's own approvals
const startedStages = { build: false, review: false, test: false }  // the stages the open segment started that the history does not show yet
let segmentNumber = 1
let segmentBegun = false  // the open segment has begun on the claim and is not added yet
let segmentStartTip = null  // the tip the open segment begins at: the previous segment's end tip, none for the first segment of a build
let segmentFrom = { history: 0, fixRoles: 0, fixRounds: zeroCounts() }  // what the run held when the open segment started
let addAttempted = false  // aco lane-record add runs once per segment
let recordsWritten = 0

const segmentRunIdNow = () => segmentRunId(runId, segmentNumber)
// A tester that has not answered belongs to the segment its answer lands in, so it counts as started only once it is judged.
const segmentSlice = () => ({ history: history.slice(segmentFrom.history), fixRole: fixRolesRun.slice(segmentFrom.fixRoles).at(-1) ?? null, testStarted: startedStages.test && !pendingTest })
// The stages the open segment started, in aco's order; a segment that started none (the run ending after a CI finding read at a proven point, with no fixer) stores nothing, since aco takes no empty --ran and a stage that did not run is never claimed.
const stagesStarted = () => stagesRan({ ...segmentSlice(), builderRan: startedStages.build, reviewStarted: startedStages.review })

// The lane record reaches <scratch>/lane-record.json through a courier that cuts it out of its own transcript; the printer then runs aco lane-record check on it and a CRC-signed line brings the exit back.
// A lane stopped by the Claude usage limit writes none, since the courier is a Claude agent too, and neither does a run refused at input, which has no lane state yet.
async function writeRecord() {
  const file = `${A.scratch}/lane-record.json`
  // The counts are the run's up to now minus its up to the segment's start, so the segments sum to the unsplit run's figures.
  const record = laneRecord({ routing: ROUTING, ...segmentSlice(), history, since: segmentFrom.history, fixRounds: fixRoundsSince(fixRoundsByStage, segmentFrom.fixRounds), risk: MATERIAL ? 'material' : 'normal', experiment: A.experiment, earlier: firstBegan })
  const label = `record-${++recordsWritten}`
  const nonce = label
  const { brief, before, fileArgument } = recordCourier({ record, file, scratch: A.scratch, label })
  const relayed = await relay({ label, phase: 'Record', step: 'record', relayArgs: [fileArgument, `'${nonce}'`], nonce, requiredKeys: ['check'], brief, before })
  if (!relayed || relayed.problem) return { problem: `the record courier ${relayed?.problem ?? 'ended without a result'}${relayed ? printedLine(relayed) : ''}` }
  const { code, err } = relayed.values.check
  return code === 0 ? { file, fileArgument } : { problem: `aco lane-record check exited ${code}: ${err}` }
}
// The first segment begins right after the run's input checks (the branch check, or the sync and, unless it starts at a fixer, the scope check), a later one right before its first stage; a refused begin ends the run, since nothing is stored for the segment.
async function beginRun(startTip = segmentStartTip) {
  if (segmentBegun) return null
  const runId = segmentRunIdNow()
  const begun = beganRun(await relay(beginRequest({ item: A.item, runId, startTip, facts: laneFacts })), printedLine, { item: A.item, runId })
  const unstored = segmentNumber === 1 ? 'this run on the claim, so the run did none of its work' : 'the next stored run of this lane run on the claim, so the run stopped before its next stage'
  if (begun.problem) return await openResult('awaiting-head', 'record', { reason: `aco did not begin ${unstored}: ${begun.problem}` })
  began = begun.read
  firstBegan ??= begun.read
  segmentBegun = true
  return null
}
// The open segment's record goes to the claim once, with the stages the segment started; aco takes no empty --ran, so a begun segment that started no stage stores nothing.
async function addRecord(written) {
  if (!segmentBegun || addAttempted || !written?.file || approvesRevisedTip(history)) return null
  const ran = stagesStarted()
  if (!ran.length) return null
  addAttempted = true
  const runId = segmentRunIdNow()
  return storeProblem('add', await relay(addRequest({ item: A.item, runId, fileArgument: written.fileArgument, tip, ran, facts: laneFacts })), printedLine, { item: A.item, runId })
}
// A proven point adds the open segment, ending at the tip, and the next segment starts from that tip; a segment that started no stage since the last point stores nothing.
async function storeProvenPoint() {
  if (!segmentBegun || !stagesStarted().length) return null
  const written = await writeRecord()
  if (written.problem) return await openResult('awaiting-head', 'record', { reason: `${written.problem}. Start a new run with pr ${pr} and tip ${tip}.` })
  const refusedAdd = await addRecord(written)
  if (refusedAdd) return await openResult('awaiting-head', 'record', { reason: refusedAddReason(refusedAdd, `by going on past the proven point at ${tip}`) })
  segmentNumber++
  segmentBegun = false
  addAttempted = false
  segmentStartTip = tip
  segmentFrom = { history: history.length, fixRoles: fixRolesRun.length, fixRounds: { ...fixRoundsByStage } }
  Object.assign(startedStages, { build: false, review: false, test: Boolean(pendingTest) })
  // A tester still running is work to come: its answer needs a begun segment, and a run killed meanwhile must leave one with no record.
  return pendingTest ? await beginRun() : null
}
