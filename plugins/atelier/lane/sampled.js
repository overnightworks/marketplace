// One normal lane in ten also gets the final gate (instructions/HEAD.md, Re-measurement): the gate reviews the tip the review approved, on its own, so the blocking findings it raises
// are the ones one review let through. The look is a measurement, so one that ends without a verdict is skipped and leaves nothing in the record; a re-check it owes is never skipped.
const SAMPLE_EVERY = 10
// The round states in which the gate gave no verdict.
const LOOK_WITHOUT_VERDICT = new Set(['limited', 'hung', 'brief-mismatch', 'no-brief-record', 'failed'])
let sampled = false  // the lane's gate ran as the sample or as the re-check an earlier run owed
let sampledSkip = null  // why the sampled look was skipped
const sampledView = () => ({ sampled: sampledSkip ? 'skipped' : sampled, ...(sampledSkip && { sampledReason: sampledSkip }) })

// What the first begin's read of the stored runs leaves the lane to do: a stop that ends the lane, or whether to take the sample or to re-check the gate's REVISE an earlier run stored.
async function sampledDuty(read) {
  const none = { take: false, owed: false }
  if (MATERIAL || Number(A.item) % SAMPLE_EVERY !== 0) return none
  const unknown = read.gap ?? (read.lost && 'a stored run of the lane is lost, so it may have run the gate')
  if (unknown) return { stop: await openResult('awaiting-head', 'record', { reason: `item #${A.item} is sampled for the final gate, but the stored runs cannot show whether the gate ran: ${unknown}. A sampled lane takes no sample and skips no owed re-check. Start a new run with pr ${pr} and tip ${tip} once the stored runs can be read.` }) }
  const owed = read.lastGate === 'revise'
  sampled = owed
  return { take: !read.gateRan, owed }
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
