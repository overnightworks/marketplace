export const meta = {
  name: 'lane-build',
  description: 'Internal to the lane workflow, never started by a head: runs the builder of one lane and returns its answer, or null when the builder ended without a result; the lane judges the answer itself.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_BUILD_PROTOCOL = 3
const A = args || {}
if (A.protocolQuery) return { protocol: LANE_BUILD_PROTOCOL }
const need = ['protocol', 'delegatedLine', 'laneFacts', 'driveFacts', 'rescopeFacts', 'localCheckFacts', 'build', 'rescope', 'checkReport', 'routing']
if (A.protocol !== LANE_BUILD_PROTOCOL) return { refused: `lane-build speaks protocol ${JSON.stringify(LANE_BUILD_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }

const BUILD = {
  type: 'object',
  required: ['pr', 'tip', 'blocked', 'check'],
  properties: { pr: { type: 'number' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' }, check: A.checkReport, rescope: A.rescope },
}

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
try {
  return await agent(
    `${A.delegatedLine}\n${A.laneFacts} ${A.driveFacts} ${A.rescopeFacts} ${A.localCheckFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted, and if you run short of turns, commit what is green and report what is left instead of continuing. Merge origin/main into the lane before pushing (a merge commit). ` +
    `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip, summary and check.`,
    { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', ...A.routing })
} catch (error) {
  log(`build ended without a result: ${String(error).slice(0, 160)}`)
  return null
}
