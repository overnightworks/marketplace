export const meta = {
  name: 'lane-ci',
  description: 'Internal to the lane workflow, never started by a head: watches the CI of one pull request and returns whether it went green with the failing checks quoted; the lane reads the listing itself.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_CI_PROTOCOL = 5
const A = args || {}
if (A.protocolQuery) return { protocol: LANE_CI_PROTOCOL }
const need = ['protocol', 'delegatedLine', 'pr', 'n', 'worktree', 'finding', 'watcher']
if (A.protocol !== LANE_CI_PROTOCOL) return { refused: `lane-ci speaks protocol ${JSON.stringify(LANE_CI_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const { pr } = A
const R = A.repo ? ` -R ${A.repo}` : ''
const IN_REPO = A.repo ? ` in ${A.repo}` : ''
const WATCHER = A.watcher

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
async function agentOrNull(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${opts.label} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

// A job qualifies for the one re-run only when the step it failed in is listed here; any other step, or none known, never does.
const SETUP_STEPS = new Set(['Set up job'])

const REDCHECK = {
  type: 'object',
  required: ['name', 'link', 'runId', 'jobId', 'failingStep', 'findings'],
  properties: {
    name: { type: 'string' }, link: { type: 'string' }, runId: { type: 'string' }, jobId: { type: 'string' },
    failingStep: { type: ['string', 'null'] }, findings: { type: 'array', items: A.finding },
  },
}
const CI = {
  type: 'object',
  required: ['green', 'failing'],
  properties: { green: { type: 'boolean' }, failing: { type: 'array', items: A.finding }, red: { type: 'array', items: REDCHECK } },
}
const RERUN = {
  type: 'object',
  required: ['link', 'bucket', 'findings'],
  properties: { link: { type: 'string' }, bucket: { type: 'string' }, findings: { type: 'array', items: A.finding } },
}

// How a red check becomes findings; the first watch and a job re-run quote the same way.
function evidenceRules(inWorktree) {
  return (
    `A check whose link is not an Actions job link has no job log: skip the log command and make one entry under its check name with its gh pr checks line and link as evidence. ` +
    `The evidence is the output that made the check red: run \`${inWorktree}gh run view <run-id>${R} --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200\` and quote what it prints, leaving out each line's \`<job>\\tUNKNOWN STEP\\t<timestamp>Z \` prefix. ` +
    `It reads that job's own log up to its first ##[error] line, because for a job of a called workflow \`--log-failed\` prints the whole log with every line unlabelled, so its tail is only cleanup. ` +
    `When those lines list findings as path:line plus a rule id (such as \`sonar tests/x.py:498 - python:S5778: text\`), return one failing entry per listed finding instead: where = path:line, kind = "defect", ` +
    `text = the finding's text, rule = its rule id, evidence = that line; a \`Fix:\` line belongs to the finding above it, and the list's header count (\`N open finding(s)\`) must equal your entries. A red check without such a list stays one entry under its check name with the quoted lines as evidence. ` +
    `If the last printed line is not an ##[error] line, the job did not fail in its own steps: make one entry under its check name with the check's state and link as evidence and say the log held no error line. ` +
    `A check whose log only reports that a job it needs failed (such as \`gate job "sonar" result failure\`) is derived: leave it out when another failing entry already covers that job. Never guess a cause such as flakiness; quote what the log shows. `
  )
}

function watchCi() {
  const inWorktree = A.repo ? '' : `cd '${A.worktree}' && `
  const rulesRepoPath = A.repo ? `repos/${A.repo}` : 'repos/{owner}/{repo}'
  return agentOrNull(
    `${A.delegatedLine}\nReport CI for pull request #${pr}${IN_REPO}; change nothing in the repository. ` +
    `If \`${inWorktree}gh pr view ${pr}${R} --json mergeable --jq .mergeable\` says CONFLICTING, return green false with one failing entry: where "mergeable", kind "defect", text "the pull request conflicts with main", ` +
    `rule "GitHub runs no CI on a conflicting pull request", evidence the mergeable value. Otherwise wait in the foreground — you cannot be woken later. First wait until CI has registered the head, because a just-pushed head lists no check yet: run \`${inWorktree}for i in $(seq 1 5); do [ "$(gh pr checks ${pr}${R} --json name --jq length 2>/dev/null)" -gt 0 ] 2>/dev/null && break; sleep 60; done\` (Bash timeout 600000 ms; it ends with status 0 after about 5 minutes even when no check registered, then go on). Then run \`${inWorktree}timeout 540 gh pr checks ${pr}${R} --watch --fail-fast --interval 90\` (Bash timeout 600000 ms) and repeat it until it exits on its own rather than by the timeout, at most 7 times; on a red check it exits before the run ends. Never re-run anything: the lane decides that from the facts you return. ` +
    `When it exits on a red check, take every check in the fail bucket of \`${inWorktree}gh pr checks ${pr}${R} --json name,state,bucket,link\` at that moment, not only the first. green is true only when at least one check ran on head ` +
    `and every check on head succeeded; no checks at all is one failing entry: where "checks", kind "defect", text "no CI checks ran on the head commit", rule "CI must run on head", evidence the gh pr checks output after that wait. For each check in the fail bucket: where = its name, kind = "defect", text = what failed, ` +
    `rule = "CI check <name>". Take run-id and job-id from the check's link (the link ends …/actions/runs/<run-id>/job/<job-id>). ` +
    `Also return each such check once in red: name, its link as printed, runId, jobId (empty strings when the link is not an Actions job link), findings = the entries you made for that check, and failingStep = the name of the first step whose conclusion is failure in \`${inWorktree}gh run view <run-id>${R} --json jobs --jq '.jobs[]|select(.databaseId==<job-id>)|[.steps[]|select(.conclusion=="failure")|.name][0]'\` (null when it prints nothing or you cannot read it); failing is all findings together. ` +
    evidenceRules(inWorktree) +
    `Read the required contexts of the base branch only to pace the wait: \`${inWorktree}gh api ${rulesRepoPath}/rules/branches/<base> --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'\`, ` +
    `the base is \`${inWorktree}gh pr view ${pr}${R} --json baseRefName --jq .baseRefName\`. The lane reads them again itself, so neither what you read nor its error is returned or judged; when the read fails, wait as if no required context were missing. ` +
    `If a required context is missing from \`${inWorktree}gh pr checks ${pr}${R} --json name,bucket\`, or a check is still pending after the watch, watch again; re-watching shares the cap of 7 watches and the 540 s timeout per watch.`,
    { label: `ci-${A.n}`, phase: 'Test and CI', schema: CI, ...WATCHER })
}

function rerunJob(red, index) {
  const inWorktree = A.repo ? '' : `cd '${A.worktree}' && `
  return agentOrNull(
    `${A.delegatedLine}\nRe-run one job of pull request #${pr}${IN_REPO} once and report its check; change nothing in the repository. Wait in the foreground — you cannot be woken later. ` +
    `The job is check "${red.name}", run ${red.runId}, job ${red.jobId}. GitHub may refuse a job re-run while its run is still in progress: if \`${inWorktree}gh run view ${red.runId}${R} --json status --jq .status\` is not completed, wait with \`${inWorktree}gh run watch ${red.runId}${R} --exit-status\` (Bash timeout 600000 ms, repeat while the run is not completed, at most 3 times). ` +
    `Then run \`${inWorktree}gh run rerun ${red.runId}${R} --job ${red.jobId}\` once; never re-run anything else and never a second time. Then run \`${inWorktree}timeout 540 gh pr checks ${pr}${R} --watch --interval 90\` (Bash timeout 600000 ms) and repeat it until it exits on its own, at most 5 times. ` +
    `Return the link of check "${red.name}" as \`${inWorktree}gh pr checks ${pr}${R} --json name,bucket,link\` prints it after that, and its bucket. If its bucket is fail, ` +
    `return findings for it: each entry has kind = "defect" and rule = "CI check ${red.name}" unless the log lists findings with their own rule ids. Otherwise findings is empty. ` +
    evidenceRules(inWorktree),
    { label: `ci-${A.n}-rerun-${index + 1}`, phase: 'Test and CI', schema: RERUN, ...WATCHER })
}

const canRerun = red => SETUP_STEPS.has(red.failingStep) && Boolean(red.runId) && Boolean(red.jobId)

// The first finding stands unless the re-run reached the check, which shows as another link.
function afterRerun(red, rerun) {
  if (!rerun || rerun.link === red.link) return red.findings
  if (rerun.bucket === 'pass') return []
  return rerun.findings.length ? rerun.findings : red.findings
}

async function ciFindings() {
  const first = await watchCi()
  if (!first) return null
  const { red = [], ...answer } = first
  if (answer.green || !red.length || !red.every(canRerun)) return answer
  const reruns = await Promise.all(red.map(rerunJob))
  const failing = red.flatMap((one, index) => afterRerun(one, reruns[index]))
  return { green: failing.length === 0, failing }
}

return await ciFindings()
