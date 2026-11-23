// How a fix round ends without an accepted fix: the stop and hand-over answers the fixer can return.

// The fixer's returned tip becomes the lane tip; it is unreviewed when the fixer committed anything. Returns whether it did.
function adoptFixerTip(fixed) {
  tip = fixed.tip
  const committed = !fixed.unchanged
  history.push({ after: spent.total, by: 'fix', tip: fixed.tip, reviewed: !committed })
  return committed
}

// A disputed finding is a disagreement between two fresh agents about evidence: the head decides it.
async function awaitHeadOnDispute(fixed, blocking) {
  disputed.push(...fixed.disputed)
  const committed = adoptFixerTip(fixed)
  return openResult('awaiting-head', 'fix', { reason: committed ? 'the fixer disputes findings with counter-evidence; the returned tip carries fix commits no reviewer has seen' : 'the fixer disputes every finding with counter-evidence and committed nothing', lastBlocking: blocking })
}

// The push of a merge of main cannot be undone, so a rejected merge-only answer leaves the merged tip to the head instead of failing the lane.
async function awaitHeadOnRejectedMerge(fixed) {
  const { rejection } = fixed
  adoptFixerTip(fixed)
  return openResult('awaiting-head', 'fix', { ...rejection, reason: `${rejection.reason}; the fixer pushed a merge of main, so the branch head is now ${fixed.tip}: start a new run with pr ${pr} and tip ${fixed.tip}` })
}

// What the fixer says it found already done is only reported to the head: an unaccepted fix folds nothing in.
const unaccepted = (answered, result) => ({ stop: (answered.resolved || []).length ? { ...result, resolved: answered.resolved } : result })

// The stop or flake result of an answer that carries no accepted fix, or null when the fix goes on to acceptance.
async function fixAnswerStop(answered, blocking, foldIn, tipBeforeFix) {
  // A blocked fixer may have run out of turns before the relay line, and the blocked answer reads no tip.
  if (answered.blocked) return unaccepted(answered, await openResult('escalated', 'fix', { reason: `${answered.blockedReason} Start a new run with the arguments in resume and the branch's current head as tip: a blocked answer reads no tip.`, resume: { ...claudeLimitResume('fix', { lastBlocking: blocking, withoutTip: true, foldIn: blocking.length ? [] : foldIn }), deltaFrom: tipBeforeFix } }))
  if (answered.problem || answered.commandFailed) return { stop: await openResult('failed', 'fix', { reason: `the fixer's relay line ${answered.problem || 'reports a failed git command'}${printedLine(answered)}` }) }
  if (answered.outcome === 'flake') return { flakes: answered.flakes, fixed: answered }
  if (answered.outcome === 'disputed') return unaccepted(answered, await awaitHeadOnDispute(answered, blocking))
  if (answered.outcome === 'rejected') return unaccepted(answered, answered.mergeOnly ? await awaitHeadOnRejectedMerge(answered) : await openResult('failed', 'fix', answered.rejection))
  return null
}
