export const meta = {
  name: 'lane-ci',
  description: 'Internal to the lane workflow, never started by a head: watches the CI of one pull request and returns the check listing the lane judges.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_CI_PROTOCOL = 2
const A = args || {}
const need = ['protocol', 'pr', 'n', 'worktree', 'finding', 'watcher']
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
if (A.protocol !== LANE_CI_PROTOCOL) return { refused: `lane-ci speaks protocol ${JSON.stringify(LANE_CI_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
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

const CI_BUCKETS = ['pass', 'fail', 'pending', 'skipping', 'cancel']
const ACCEPTED_CI_BUCKETS = ['pass', 'skipping']
const CI = {
  type: 'object',
  required: ['head', 'green', 'failing', 'checks', 'requiredChecks'],
  properties: {
    head: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, green: { type: 'boolean' }, failing: { type: 'array', items: A.finding },
    checks: { type: 'array', description: 'the gh pr checks --json name,bucket listing, copied unchanged', items: { type: 'object', required: ['name', 'bucket'], properties: { name: { type: 'string' }, bucket: { enum: CI_BUCKETS } } } },
    requiredChecks: { type: 'array', items: { type: 'string' }, description: 'the required status check contexts of the base branch' },
    baseChecks: { type: 'array', description: 'the check runs of the base branch tip, copied unchanged; a run still pending has a null conclusion', items: { type: 'object', required: ['name', 'status', 'conclusion'], properties: { name: { type: 'string' }, status: { type: 'string' }, conclusion: { type: ['string', 'null'] } } } },
    requiredChecksError: { type: 'string', description: 'the error of the gh api call that reads the required contexts' },
  },
}

function watchCi() {
  const inWorktree = A.repo ? '' : `cd '${A.worktree}' && `
  const rulesRepoPath = A.repo ? `repos/${A.repo}` : 'repos/{owner}/{repo}'
  return agentOrNull(
    `Report CI for pull request #${pr}${IN_REPO}; change nothing in the repository. Return the PR head sha as head (\`${inWorktree}gh pr view ${pr}${R} --json headRefOid --jq .headRefOid\`). ` +
    `If \`${inWorktree}gh pr view ${pr}${R} --json mergeable --jq .mergeable\` says CONFLICTING, return green false with one failing entry: where "mergeable", kind "defect", text "the pull request conflicts with main", ` +
    `rule "GitHub runs no CI on a conflicting pull request", evidence the mergeable value. Otherwise wait in the foreground — you cannot be woken later. First wait until CI has registered the head, because a just-pushed head lists no check yet: run \`${inWorktree}for i in $(seq 1 20); do [ "$(gh pr checks ${pr}${R} --json name --jq length 2>/dev/null)" -gt 0 ] 2>/dev/null && break; sleep 15; done\` (Bash timeout 600000 ms; it ends with status 0 after about 5 minutes even when no check registered, then go on). Then run \`${inWorktree}timeout 540 gh pr checks ${pr}${R} --watch --interval 90\` (Bash timeout 600000 ms) and repeat it until it exits on its own rather than by the timeout, at most 7 times. If a check fails, ` +
    `rerun the failed jobs once (\`${inWorktree}gh run rerun <run-id>${R} --failed\`) and watch again, so a flaky check does not count. green is true only when at least one check ran on head ` +
    `and every check on head succeeded; no checks at all is one failing entry: where "checks", kind "defect", text "no CI checks ran on the head commit", rule "CI must run on head", evidence the gh pr checks output after that wait. For each check that still failed: where = its name, kind = "defect", text = what failed, ` +
    `rule = "CI check <name>". Take run-id and job-id from the check's link (\`${inWorktree}gh pr checks ${pr}${R} --json name,state,link\`; the link ends …/actions/runs/<run-id>/job/<job-id>). ` +
    `A check whose link is not an Actions job link has no job log: skip the log command and make one entry under its check name with its gh pr checks line and link as evidence. ` +
    `The evidence is the output that made the check red: run \`${inWorktree}gh run view <run-id>${R} --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200\` and quote what it prints, leaving out each line's \`<job>\\tUNKNOWN STEP\\t<timestamp>Z \` prefix. ` +
    `It reads that job's own log up to its first ##[error] line, because for a job of a called workflow \`--log-failed\` prints the whole log with every line unlabelled, so its tail is only cleanup. ` +
    `When those lines list findings as path:line plus a rule id (such as \`sonar tests/x.py:498 - python:S5778: text\`), return one failing entry per listed finding instead: where = path:line, kind = "defect", ` +
    `text = the finding's text, rule = its rule id, evidence = that line; a \`Fix:\` line belongs to the finding above it, and the list's header count (\`N open finding(s)\`) must equal your entries. A red check without such a list stays one entry under its check name with the quoted lines as evidence. ` +
    `If the last printed line is not an ##[error] line, the job did not fail in its own steps: make one entry under its check name with the check's state and link as evidence and say the log held no error line. ` +
    `A check whose log only reports that a job it needs failed (such as \`gate job "sonar" result failure\`) is derived: leave it out when another failing entry already covers that job. Never guess a cause such as flakiness; quote what the log shows. ` +
    `Proof the script judges, not you: after the watch exits on its own, and after any rerun, copy \`${inWorktree}gh pr checks ${pr}${R} --json name,bucket\` unchanged into checks. ` +
    `Copy the required contexts of the base branch into requiredChecks from \`${inWorktree}gh api ${rulesRepoPath}/rules/branches/<base> --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'\`; ` +
    `the base is \`${inWorktree}gh pr view ${pr}${R} --json baseRefName --jq .baseRefName\`. Only a successful, empty response means []. A non-zero gh api exit is never \`[]\`: put the error into requiredChecksError and leave it out of failing, because no fixer can repair an API or permission error. ` +
    `If a required context is missing from the listing, or a check is still pending after the watch, watch again before you copy the listing; re-watching shares the cap of 7 watches and the 540 s timeout per watch. Once the cap is spent, copy the listing as it stands. ` +
    `Copy the check runs of the base branch tip into baseChecks from \`${inWorktree}gh api ${rulesRepoPath}/commits/<base>/check-runs --paginate --jq '.check_runs[]|{name,status,conclusion}'\`, unchanged; do not judge them. ` +
    `On the conflicting pull request path return checks: [] and requiredChecks: [] and baseChecks: [].`,
    { label: `ci-${A.n}`, phase: 'Test and CI', schema: CI, ...WATCHER })
}

// The listing the agent copied, not its conclusion, decides whether CI counts as green; null means the listing proves it.
function unprovenGreen(ci) {
  const checks = ci.checks || []
  if (checks.length === 0) return 'no checks are listed for the pull request head'
  const problems = checks
    .filter(c => !ACCEPTED_CI_BUCKETS.includes(c.bucket))
    .map(c => `check "${c.name}" is ${c.bucket}, not ${ACCEPTED_CI_BUCKETS.join(' or ')}`)
  const listed = new Map(checks.map(c => [c.name, c.bucket]))
  for (const name of ci.requiredChecks || []) {
    if (!listed.has(name)) problems.push(`required check "${name}" is missing from the listing`)
    else if (listed.get(name) !== 'pass') problems.push(`required check "${name}" is ${listed.get(name)}, not pass`)
  }
  return problems.length ? problems.join('; ') : null
}

const ci = await watchCi()
if (!ci) return null
return { ...ci, unproven: ci.green ? unprovenGreen(ci) : null }
