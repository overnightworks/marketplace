// Runs the builder of one lane and returns its answer, or null when the builder ended without a result; the lane judges the answer itself.
export async function laneBuild(A) {
  const BUILD = {
    type: 'object',
    required: ['pr', 'tip', 'reuse', 'blocked'],
    properties: { pr: { type: 'number', minimum: 1, description: 'the number of the open pull request you opened for this lane' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, summary: { type: 'string' }, reuse: { type: 'string', description: 'the owner you extended (module and function), or the search you ran and why nothing found fits' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' } },
  }

  // An end without a result is a null the lane reports; so is an unblocked answer without an open pull request, which the schema's minimum names but a runtime need not enforce.
  const { answer } = await settledAgent(
    `${A.delegatedLine}\n${A.laneFacts} ${A.driveFacts} ${A.rescopeFacts} ${A.localCheckFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted. Merge origin/main into the lane before pushing (a merge commit). ` +
    `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip, summary and reuse: the owner you extended (module and function), or the search you ran and why nothing found fits.`,
    { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', ...A.routing })
  return answer?.blocked || (Number.isInteger(answer?.pr) && answer.pr >= 1) ? answer : null
}
