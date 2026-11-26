// One normal lane in ten also gets the final gate (instructions/HEAD.md, Re-measurement): the gate reviews the tip the review approved, on its own, so the blocking findings it raises
// are the ones one review let through. The look is a measurement, so one that ends without a verdict is skipped and leaves nothing in the record; a re-check it owes is never skipped.
const SAMPLE_EVERY = 10
// The round states in which the gate gave no verdict.
const LOOK_WITHOUT_VERDICT = new Set(['limited', 'hung', 'brief-mismatch', 'no-brief-record', 'failed'])
let sampled = false  // the lane's gate ran as the sample or as the re-check an earlier run owed
let sampledSkip = null  // why the sampled look was skipped
let gateOwesWholeLane = false  // a lost run owes the gate on the whole lane in the first review round, whatever range the review reads
const sampledView = () => ({ sampled: sampledSkip ? 'skipped' : sampled, ...(sampledSkip && { sampledReason: sampledSkip }) })

// What the first begin's read of the stored runs leaves the lane to do: a stop when the read failed, or whether to take the sample or to re-check the gate: owed after a stored REVISE or a lost run.
async function sampledDuty(read) {
  const none = { take: false, owed: false }
  if (MATERIAL || Number(A.item) % SAMPLE_EVERY !== 0) return none
  if (read.gap) return { stop: await openResult('awaiting-head', 'record', { reason: `item #${A.item} is sampled for the final gate, but the stored runs cannot show whether the gate ran: ${read.gap}. A sampled lane takes no sample and skips no owed re-check. Start a new run with pr ${pr} and tip ${tip} once the stored runs can be read.` }) }
  // A lost run may have run the gate and said anything, so the lane owes the gate on the whole lane like a stored REVISE: its look is never skipped.
  const owed = read.lastGate === 'revise' || Boolean(read.lost)
  sampled = owed
  gateOwesWholeLane = Boolean(read.lost)
  return { take: !owed && !read.gateRan, owed }
}

// The range a lost run owes the gate, handed out once: the first review round takes it, whatever range that round reads.
function takeOwedGateRange() {
  const owed = gateOwesWholeLane
  gateOwesWholeLane = false
  return owed ? WHOLE_LANE : undefined
}

// The one look at the whole lane on the tip the review approved, in the round of that approval so the existing miss rule counts no miss for it.
async function sampledLook() {
  if (MODEL_PROVIDER[ROUTING.build.model] === GATE.provider) {
    sampledSkip = `the gate (${ROUTING.gate.model}) runs on the builder's provider, so it gives no independent look`
    return null
  }
  const approval = history.findLast(approvesRange)
  sampled = true
  return await reviewUntilClean([GATE], WHOLE_LANE, undefined, { after: approval?.after ?? spent.total })
}

// A look that ended without a verdict is skipped and leaves nothing in the record.
function skipSampledLook(round) {
  sampled = false
  sampledSkip = round.verdict.reason ?? `the gate returned no verdict (${round.verdict.state})`
  return null
}
