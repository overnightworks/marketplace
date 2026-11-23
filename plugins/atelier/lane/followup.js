// The contract lets the lane's fixer resolve a small follow-up in a file the lane already changed, when its fix cannot change behaviour outside the reviewed diff.
// A follow-up is in place when its raiser set inPlace or the head named it in foldIn; one the fixer declined is never handed to a fixer again.
// A fold-in counts as folded only once the fix that carries it is accepted; until then it stays open.
const inPlaceFollowups = () => {
  const namedByHead = new Set((A.foldIn || []).map(findingKey))
  return openFollowups().filter(f => !declined.has(findingKey(f)) && (namedByHead.has(findingKey(f)) || f.inPlace === true))
}
const listFoldIns = (foldIn) => foldIn.map(f => `- ${f.where} — ${f.text}`).join('\n')
// The reviewer sees which follow-ups the fixer was given and which it declined with what reason, so it can tell a skipped one from a done one.
const foldInsInRange = (foldIn, declinedBy = {}, lead = 'The fixer was also given these follow-ups to fold in; check each is done:') => {
  const refused = foldIn.filter(f => Object.hasOwn(declinedBy, f.where))
  const done = foldIn.filter(f => !refused.includes(f))
  const declinedText = refused.map(f => `- ${f.where} — ${f.text} (declined: ${declinedBy[f.where]})`).join('\n')
  return [done.length && [lead, listFoldIns(done)].filter(Boolean).join('\n'), refused.length && `The fixer declined these follow-ups; check each reason holds:\n${declinedText}`]
    .filter(Boolean).map(text => `\n${text}`).join('')
}

// A review that passes with in-place follow-ups open runs one batch per run, when the review and total budgets allow it. The batch's re-check
// always runs the ordinary review, and the gate too when a fold-in came from the gate or the fix touched production on a material lane.
// A follow-up the re-check raises, one the fixer declined and one left by a spent budget stay open for the head.
let followUpBatchRun = false
async function followUpBatch() {
  if (followUpBatchRun || !inPlaceFollowups().length || spent.review >= B.review || spent.total >= B.total) return null
  followUpBatchRun = true
  const fixed = await fixRound([], "the passing review's follow-ups", ROUND.review, 'review', false)
  if (fixed.stop) return fixed.stop
  if (!fixed.range) return null
  const withGate = MATERIAL && (fixed.gateAgain || fixed.foldIn.some(f => f.stage === 'gate'))
  phase('Review')
  return await settleReview(await reviewRound(withGate ? [REVIEW, GATE] : [REVIEW], fixed.range, fixed.deltaFrom)) ?? await storeProvenPoint()
}
