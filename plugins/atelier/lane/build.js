// Runs the builder of one lane and returns its answer, or null when the builder ended without a result; the lane judges the answer itself.
export async function laneBuild(A) {
  const BUILD = {
    type: 'object',
    required: ['pr', 'tip', 'blocked'],
    properties: { pr: { type: 'number' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' } },
  }

  // agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
  try {
    return await agent(
      `${A.delegatedLine}\n${A.laneFacts} ${A.driveFacts} ${A.rescopeFacts} ${A.localCheckFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted. Merge origin/main into the lane before pushing (a merge commit). ` +
      `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip and summary.`,
      { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', ...A.routing })
  } catch (error) {
    log(`build ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}
