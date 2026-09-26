export const meta = {
  name: 'lane',
  description: 'One claimed lane to ready-to-land: build, a fresh Opus review (plus a Codex Sol gate on material risk), fresh fixers with evidence-bearing findings and a delta re-check by whoever raised them, then the explorative end-to-end test and CI in parallel on one tip.',
  whenToUse: 'In any repository that coordinates with aco, after the head ran `aco start <item>` (worktree, branch and claim exist). Landing stays with the head; the result lists requiredHeadActions. ' +
    'Required args: item (the work item number), worktree (the lane\'s isolated worktree path), branch (the lane branch), contract (the item\'s ruled sentences every reviewer and the tester judge against), ' +
    'e2e (what the explorative tester drives through the real entry point), scratch (a directory for briefs, Codex output and test evidence). ' +
    'Start with build (a builder brief) for a new lane, or with pr and tip (an open pull request and its head sha) to resume one. ' +
    'Optional args and their defaults: risk "normal" (or "material": adds a Codex Sol final gate and raises the review effort to xhigh); size "M" (or "S": builder, fixer and tester run at medium effort; "L" as "M"); ' +
    'reviewer "claude" (a fresh Opus reviewer; "codex" routes the ordinary review to Codex Terra); builderProvider "claude" (the only accepted value, because the gate runs on Codex); ' +
    'repo none (every gh call then targets the worktree\'s own repository; pass owner/name when the head runs elsewhere); ' +
    'productionPaths ["src/", "pyproject.toml", "uv.lock"], a default that fits a src-layout Python repository (path prefixes whose change re-opens the gate on a material lane and re-runs the end-to-end test); ' +
    'ledgers [], a default that fits a repository without append-only ledgers (files whose merge conflicts keep both sides, main\'s lines first); ' +
    'budgets {review: 5, test: 2, ci: 3, total: 8} (fix rounds per phase and in total; partial objects override single keys); ' +
    'deltaFrom none (a sha: review only the commits since it, after the head settled an awaiting-head result); answers none (what those commits answer); ' +
    'fixFirst none (Finding[]: blocking findings a fresh fixer answers before anything else); foldIn none (Followup[]: fix-in-place follow-ups for that fixer).',
  phases: [
    { title: 'Build' },
    { title: 'Sync' },
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Test and CI' },
  ],
}

// ---------------------------------------------------------------- inputs
const A = args || {}
const need = ['item', 'worktree', 'branch', 'contract', 'e2e', 'scratch']
const missing = need.filter(k => !A[k])
if (missing.length) return { status: 'failed', stage: 'input', reason: `missing args: ${missing.join(', ')}` }
if (A.pr && !A.tip) return { status: 'failed', stage: 'input', reason: 'with pr, pass tip (the PR head sha) so the first delta range is right' }
if (!A.pr && !A.build) return { status: 'failed', stage: 'input', reason: 'pass build (a brief) or pr + tip' }
if (A.builderProvider && A.builderProvider !== 'claude') {
  return { status: 'failed', stage: 'input', reason: 'the gate runs on Codex; a Codex-built lane needs a gate from another provider, which this workflow does not provide' }
}
const isPathList = (value) => Array.isArray(value) && value.every(path => typeof path === 'string' && path.length > 0)
if (A.productionPaths !== undefined && !isPathList(A.productionPaths)) return { status: 'failed', stage: 'input', reason: 'productionPaths must be a list of path prefixes' }
if (A.ledgers !== undefined && !isPathList(A.ledgers)) return { status: 'failed', stage: 'input', reason: 'ledgers must be a list of file paths' }
// A misspelled choice must never fall back to its default: a misspelled risk would silently drop the material lane's final gate.
if (A.risk !== undefined && !['normal', 'material'].includes(A.risk)) return { status: 'failed', stage: 'input', reason: 'risk must be "normal" or "material"' }
if (A.reviewer !== undefined && !['claude', 'codex'].includes(A.reviewer)) return { status: 'failed', stage: 'input', reason: 'reviewer must be "claude" or "codex"' }
if (A.size !== undefined && !['S', 'M', 'L'].includes(A.size)) return { status: 'failed', stage: 'input', reason: 'size must be "S", "M" or "L"' }
const MATERIAL = A.risk === 'material'
// Every gh call names the repository explicitly: agents start in the head's own checkout, which may be another repository.
if (A.repo && !/^[\w.-]+\/[\w.-]+$/.test(A.repo)) return { status: 'failed', stage: 'input', reason: 'repo must be owner/name' }
const R = A.repo ? ` -R ${A.repo}` : ''
const TAG = `wf-${A.item}`
// Paths whose change re-opens the gate on a material lane and re-runs the end-to-end test: code and public contract.
// The default fits a src-layout Python repository.
const PRODUCTION = A.productionPaths || ['src/', 'pyproject.toml', 'uv.lock']
// Separate budgets per phase plus one total: review usually needs 2-4 rounds, a tester or CI rarely more than 2.
const B = Object.assign({ review: 5, test: 2, ci: 3, total: 8 }, A.budgets || {})
const LEDGERS = A.ledgers || []
// Every Claude agent runs on Opus (operator ruling 26.09.2026: "opus immer, kein Sonnet mehr"); mechanical steps vary the effort, never the model.
const MECHANICAL = { agentType: 'general-purpose', model: 'opus', effort: 'low' }
const WATCHER = MECHANICAL
// With one model, effort is the switch (operator, 26.09.2026): it follows the item's size and risk, not a fixed "high".
const SIZE = A.size || 'M'
const EFFORT = {
  build: SIZE === 'S' ? 'medium' : 'high',
  fix: SIZE === 'S' ? 'medium' : 'high',
  review: MATERIAL ? 'xhigh' : 'high',
  test: SIZE === 'S' ? 'medium' : 'high',
}

// agent() with a schema THROWS when a subagent ends without calling StructuredOutput (seen on 26.09.2026: a builder hit
// its turn limit after 151 tool calls, left its work uncommitted, and the throw ended the whole run). Every call goes
// through this wrapper, so such an end is a null result the lane reports, never a crashed run.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${(opts && opts.label) || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

// --------------------------------------------------------------- schemas
// A finding carries the rule it breaks and the evidence for it, so a fixer never acts on a bare assertion.
const FINDING = {
  type: 'object',
  required: ['where', 'text', 'rule', 'evidence'],
  properties: {
    where: { type: 'string', description: 'file:line, or the check or scenario name' },
    text: { type: 'string' },
    rule: { type: 'string', description: 'the contract sentence, spec criterion, repository rule or check it breaks' },
    evidence: { type: 'string', description: 'what was observed: the code, the output, the failing log lines' },
    repro: { type: 'string', description: 'a command that shows it, when there is one' },
    testDraft: { type: 'string', description: 'path of a drafted failing test, when the finding can be automated stably' },
  },
}
const FOLLOWUP = {
  type: 'object',
  required: ['where', 'text', 'owner'],
  properties: { where: { type: 'string' }, text: { type: 'string' }, owner: { type: 'string', description: 'owning item #n, or "distributor"' } },
}
const BUILD = {
  type: 'object',
  required: ['pr', 'tip', 'blocked'],
  properties: { pr: { type: 'number' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' } },
}
const SYNC = {
  type: 'object',
  required: ['merged', 'tip', 'stoppedOnConflict'],
  properties: { merged: { type: 'boolean' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, stoppedOnConflict: { type: 'boolean' }, note: { type: 'string' } },
}
// Language models copy a 40-character hash unreliably (a sync step once dropped one character). A commit is
// accepted as 7 to 40 hex characters — git resolves an unambiguous prefix, and fixers often answer with the short form.
const SHA = /^[0-9a-f]{7,40}$/
// Two spellings name the same commit when the shorter is a prefix of the longer (git's own abbreviation rule).
const sameCommit = (a, b) => SHA.test(a || '') && SHA.test(b || '') && (a.startsWith(b) || b.startsWith(a))
const VERDICT = {
  type: 'object',
  required: ['verdict', 'blocking', 'followups'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'architectural', 'failed'] },
    blocking: { type: 'array', items: FINDING },
    followups: { type: 'array', items: FOLLOWUP },
    reportPath: { type: 'string' },
    note: { type: 'string' },
    codexExit: { type: 'number', description: 'the exit status Codex wrote to the marker file (couriers only)' },
  },
}
const COURIER_VERDICT = Object.assign({}, VERDICT, { required: VERDICT.required.concat(['codexExit']) })
const FIX = {
  type: 'object',
  required: ['oldTip', 'mergedBase', 'tip', 'mergeResolvedLaneConflict', 'files', 'disputed', 'blocked'],
  properties: {
    oldTip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, mergedBase: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' },
    mergeResolvedLaneConflict: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    disputed: {
      type: 'array',
      description: 'findings you did not fix because the evidence contradicts them',
      items: { type: 'object', required: ['where', 'text', 'counterEvidence'], properties: { where: { type: 'string' }, text: { type: 'string' }, counterEvidence: { type: 'string' } } },
    },
    regression: {
      type: 'array',
      description: 'for each finding that came with a repro or a test draft: the test that proves the fix',
      items: { type: 'object', required: ['finding', 'test', 'failedBefore', 'passesAfter'], properties: { finding: { type: 'string', description: 'the where of the finding it proves' }, test: { type: 'string' }, failedBefore: { type: 'boolean' }, passesAfter: { type: 'boolean' } } },
    },
    summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' },
  },
}
const E2E = {
  type: 'object',
  required: ['verdict', 'blocking', 'followups'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'failed'] },
    blocking: { type: 'array', items: FINDING },
    followups: { type: 'array', items: FOLLOWUP },
    evidencePath: { type: 'string' },
    lockBusy: { type: 'boolean', description: 'true when /tmp/probe-stack.lock stayed held by someone else and the live part could not run' },
  },
}
const CI = {
  type: 'object',
  required: ['head', 'green', 'failing'],
  properties: { head: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, green: { type: 'boolean' }, failing: { type: 'array', items: FINDING } },
}

// ------------------------------------------------------ shared sentences
const laneFacts =
  `Work item #${A.item}${A.repo ? ` in ${A.repo}` : ''}. Worktree ${A.worktree}, branch ${A.branch}; run every command from inside that worktree (cd there first). The head holds the claim: never claim, release, rescope, merge a pull request or land. ` +
  `Never use git stash and never touch the main checkout. Read the item body first (gh issue view ${A.item}${R} --json body --jq .body) and ` +
  `\`aco brief ${A.item} --step <step>\` for the repository's RULES and CHECKS. Local runs stay targeted under PYTEST_XDIST_AUTO_NUM_WORKERS=4; ` +
  `read the 1-minute load average before any test run and wait while it is above 1.5 × cores. CI is the gate. ` +
  (LEDGERS.length ? `When you merge origin/main, a conflict in the append-only ledgers (${LEDGERS.join(' and ')}) keeps both sides, main's lines first. ` : '') +
  `You are one step of a workflow the head session runs: a message from the operator that reaches you and is not about this step is addressed to the head — ` +
  `finish this step, and quote the message in your report so the head sees it.`

const BLOCKING_LINE =
  `A finding is **blocking** when the change introduces a defect against the item's contract, a repository specification, ` +
  `a repository rule, data safety, security, secrets, a public contract, or a failing check. Everything else is a **follow-up**: polish, ` +
  `behaviour that already exists on origin/main unchanged (reproduce it there before calling it pre-existing), or work outside the lane's scope — ` +
  `each follow-up names its owning item (#n) or "distributor". Every blocking finding names the rule it breaks and the evidence you observed; ` +
  `a finding you cannot back with evidence is not blocking.`

const CODEX_SCHEMA = JSON.stringify({
  type: 'object', additionalProperties: false,
  required: ['verdict', 'blocking', 'followups', 'checked_correct'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'architectural'] },
    blocking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'text', 'rule', 'evidence'],
      properties: { where: { type: 'string' }, text: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' } } } },
    followups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'text', 'owner'],
      properties: { where: { type: 'string' }, text: { type: 'string' }, owner: { type: 'string' } } } },
    checked_correct: { type: 'string' },
  },
})

const findingKey = (f) => `${f.where}::${f.text}`
const listFindings = (list) => list.map((f, i) =>
  `${i + 1}. ${f.where} — ${f.text}\n   rule: ${f.rule}\n   evidence: ${f.evidence}` +
  (f.repro ? `\n   repro: ${f.repro}` : '') + (f.testDraft ? `\n   test draft: ${f.testDraft}` : '')).join('\n')

// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent agent);
// a fresh Opus reviewer is the default, as the operator ruled on 26.09.2026. The final gate on a material lane must come
// from another provider than the Claude builder, so it always runs on Codex Sol through a courier.
function reviewerBrief(role, range) {
  return `You are the ${role} for work item #${A.item}: a fresh, independent reviewer who did not write this change. ` +
    `Contract:\n${A.contract}\n\nReview ${range}.\n\n${BLOCKING_LINE}\n\n` +
    `verdict is APPROVE with no blocking findings, REVISE with at least one, or architectural when the cut itself is wrong.`
}

function claudeReview(label, role, range) {
  return safeAgent(
    `Work read-only in ${A.worktree} on branch ${A.branch}: read files and run read-only commands freely; do not run tests and do not edit anything.\n` +
    reviewerBrief(role, range),
    { label, phase: 'Review', schema: VERDICT, agentType: 'atelier:code-reviewer', model: 'opus', effort: EFFORT.review })
}

function codexReview(label, tier, role, range) {
  const base = `${A.scratch}/${TAG}-${label}`
  const brief = `Read-only sandbox: read files and run read-only commands freely; do not run tests.\n` + reviewerBrief(role, range) +
    `\nGive every finding its file:line in "where".`
  return safeAgent(
    `You are a courier for one independent Codex review. Do not review anything yourself and do not edit the repository.\n` +
    `1. rm -f ${base}-out.json ${base}-out.json.exit ${base}-out.json.exit.tmp\n` +
    `2. Write this brief verbatim to ${base}-brief.md:\n-----\n${brief}\n-----\n` +
    `3. Write this JSON schema verbatim to ${base}-schema.json:\n${CODEX_SCHEMA}\n` +
    `4. Start Codex detached, recording its exit status in a marker file:\n` +
    `   cd ${A.worktree} && setsid nohup bash -c 'codex exec -s read-only -C ${A.worktree} -m gpt-5.6-${tier} -c model_reasoning_effort=high --output-schema ${base}-schema.json -o ${base}-out.json - < ${base}-brief.md; echo $? > ${base}-out.json.exit.tmp && mv ${base}-out.json.exit.tmp ${base}-out.json.exit' > ${base}-run.log 2>&1 &\n` +
    `5. Wait in the foreground — you cannot be woken later, your task ends when you answer. Run this Bash command (timeout 600000 ms) and repeat it until the marker exists, at most 7 times:\n` +
    `   timeout 540 bash -c 'until [ -f ${base}-out.json.exit ]; do sleep 30; done'; ls ${base}-out.json.exit\n` +
    `   Never answer before the marker exists or the 7 waits are spent. Never return a placeholder or a pending result.\n` +
    `6. If ${base}-run.log says the model is at capacity, wait 5 minutes and start again from step 1, once, with the same model. Never switch models: a gate stays on its tier.\n` +
    `7. Read ${base}-out.json and return its verdict, blocking and followups UNCHANGED, reportPath ${base}-out.json, and codexExit = the number in ${base}-out.json.exit. ` +
    `If the 7 waits are spent without a marker, or the exit status is not 0, or the file is missing or not valid JSON, return verdict failed, codexExit -1 when there is no marker, with the last 20 lines of ${base}-run.log in note.`,
    Object.assign({ label, phase: 'Review', schema: COURIER_VERDICT }, MECHANICAL))
    .then(v => (v && v.codexExit !== 0 && v.verdict !== 'failed') ? Object.assign({}, v, { verdict: 'failed', note: `courier returned a verdict without a clean Codex exit (${v.codexExit}): ${v.note || ''}` }) : v)
}

const reviewBy = (r, label, range) => r.provider === 'codex' ? codexReview(label, r.tier, r.role, range) : claudeReview(label, r.role, range)

// One classifier for every review round: every started review must return, and verdict and findings must agree.
function classify(results, expected) {
  const got = results.filter(Boolean)
  if (got.length !== expected) return { state: 'failed', reason: `${expected - got.length} review(s) returned nothing` }
  if (got.some(v => v.verdict === 'failed')) return { state: 'failed', reason: got.map(v => v.note || '').join(' | ') }
  if (got.some(v => v.verdict === 'architectural')) return { state: 'architectural' }
  // An evidenced blocking finding outranks its label (APPROVE with a finding counts as REVISE). A REVISE with nothing
  // to fix stays broken: that is how a courier's placeholder was caught.
  const empty = got.find(v => v.verdict === 'REVISE' && (v.blocking || []).length === 0)
  if (empty) return { state: 'failed', reason: 'a REVISE verdict came without any blocking finding' }
  return { state: got.some(v => (v.blocking || []).length > 0) ? 'revise' : 'approve' }
}

// ------------------------------------------------------------ state
const history = []
const followups = []
const disputed = []
let pr = A.pr || null
let tip = A.tip || null
const spent = { review: 0, test: 0, ci: 0, total: 0 }
const seen = new Map()  // finding key -> how often it came back after a fix
let productionSinceTest = false  // any fix since the last end-to-end test touched production
const folded = new Set()  // follow-ups already handed to a fixer to fix in place
const REVIEW = { key: 'review', provider: A.reviewer || 'claude', tier: 'terra', role: 'independent reviewer' }
const GATE = { key: 'gate', provider: 'codex', tier: 'sol', role: 'final gate (architecture, data safety, public contract)' }
const ALL = MATERIAL ? [REVIEW, GATE] : [REVIEW]

function dedupeFollowups() {
  const out = new Map()
  followups.forEach(f => { if (!out.has(findingKey(f))) out.set(findingKey(f), f) })
  return [...out.values()]
}
const openResult = (status, stage, extra) =>
  Object.assign({ status, stage, pr, tip, spent, history, followups: dedupeFollowups(), disputed }, extra || {})

// ---------------------------------------------------------------- build
if (A.build) {
  phase('Build')
  const built = await safeAgent(
    `${laneFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted, and if you run short of turns, commit what is green and report what is left instead of continuing. Merge origin/main into the lane before pushing (a merge commit). ` +
    `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip and summary.`,
    { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', model: 'opus', effort: EFFORT.build })
  if (!built) return openResult('failed', 'build', { reason: `the builder returned no result; inspect ${A.worktree} for uncommitted work, checkpoint it, and hand it to a fresh finisher` })
  if (built.blocked) return openResult('escalated', 'build', { reason: built.blockedReason })
  if (!SHA.test(built.tip || '')) return openResult('failed', 'build', { reason: `the builder returned a tip that is not a sha: ${String(built.tip).slice(0, 80)}` })
  pr = built.pr; tip = built.tip
  log(`built PR #${pr} at ${tip}`)
} else {
  phase('Sync')
  const synced = await safeAgent(
    `${laneFacts}\nBring the lane up to date with main and change nothing else. In ${A.worktree}: git fetch origin; if origin/main is already an ancestor of HEAD, change nothing. ` +
    `Otherwise git merge origin/main. ` +
    (LEDGERS.length ? `Conflicts only in the append-only ledgers: resolve them as the lane facts say, commit the merge, push. Any other conflict: ` : `Any conflict: `) +
    `run git merge --abort, confirm \`git status --porcelain\` is empty, push nothing, and return stoppedOnConflict true with the conflicting paths in note. Return merged true only when you made and pushed a merge commit, and tip as the output of \`git rev-parse HEAD\` — a sha, no words.`,
    Object.assign({ label: 'sync', phase: 'Sync', schema: SYNC }, MECHANICAL))
  if (!synced) return openResult('failed', 'sync')
  if (synced.stoppedOnConflict) return openResult('escalated', 'sync', { reason: synced.note || 'merge conflict in lane files; the worktree was left clean' })
  if (synced.merged) {
    if (!SHA.test(synced.tip || '')) return openResult('failed', 'sync', { reason: `sync merged but returned a tip that is not a sha: ${String(synced.tip).slice(0, 80)}` })
    tip = synced.tip
  }
}

// ------------------------------------------------------- review / fix
async function reviewRound(which, range) {
  const results = await parallel(which.map(r => () => reviewBy(r, `r${spent.total}-${r.key}`, range)))
  results.forEach((v, i) => {
    if (!v) return
    history.push({ after: spent.total, by: which[i].key, verdict: v.verdict, reportPath: v.reportPath || '' })
    followups.push(...(v.followups || []))
  })
  return { which, results, verdict: classify(results, which.length) }
}

// A finding that comes back unchanged after a fix meant for it is no progress; the second return stops the lane.
// A conflict with main or a missing CI run is a new event each time, never the same finding; a CI failure is the same
// only when its evidence (the failing log tail) repeats, because a courier's text for two different failures can match.
// Log tails often carry timestamps, so this rarely fires for CI; the ci budget is the real stop there.
const progressKey = (f) => (f.rule || '').startsWith('CI check') ? `${f.where}::${f.evidence}` : findingKey(f)
function noProgress(blocking) {
  const counted = blocking.filter(f => f.where !== 'mergeable' && f.where !== 'checks')
  const repeated = counted.filter(f => (seen.get(progressKey(f)) || 0) >= 1)
  counted.forEach(f => seen.set(progressKey(f), (seen.get(progressKey(f)) || 0) + 1))
  return repeated
}

async function fixBatch(blocking, source, budgetKey) {
  if (spent[budgetKey] >= B[budgetKey] || spent.total >= B.total) {
    const which = spent.total >= B.total ? 'total' : budgetKey
    return { stop: openResult(budgetKey === 'ci' ? 'ci-red' : 'unresolved', budgetKey, { reason: `${which} budget spent`, lastBlocking: blocking }) }
  }
  const repeated = noProgress(blocking)
  if (repeated.length) return { stop: openResult('unresolved', budgetKey, { reason: 'a finding came back unchanged after its fix', lastBlocking: repeated }) }
  spent[budgetKey]++; spent.total++
  // The contract lets a fixer resolve a small follow-up in a file the lane already changed, when it cannot change behaviour.
  const inPlace = followups.filter(f => /fix in place/i.test(`${f.owner} ${f.text}`) && !folded.has(findingKey(f)))
  inPlace.forEach(f => folded.add(findingKey(f)))
  const foldText = inPlace.length ? `\n\nAlso fold in these follow-ups, only because each sits in a file this lane already changed and cannot change behaviour; one commit for all of them:\n` +
    inPlace.map((f, i) => `${i + 1}. ${f.where} — ${f.text}`).join('\n') : ''
  phase('Fix')
  const fixed = await safeAgent(
    `${laneFacts}\nYou are a fresh fixer for PR #${pr} (lane tip ${tip}). Return that tip as oldTip. First merge origin/main if it moved (a merge commit; ` +
    `resolve other conflicts only when you can do so without changing behaviour, and set mergeResolvedLaneConflict true when files this lane changed needed resolution). ` +
    `Return the tip after that merge as mergedBase (oldTip when main had not moved). If the worktree already carries commits or uncommitted changes past that tip from an earlier fixer that ran out of turns, judge them, keep what is right, and continue from there. Commit each finding as soon as it is green; if you run short of turns, commit what is green and return what is left in blockedReason with blocked true. Then answer exactly these blocking findings from ${source}, and nothing else:\n${listFindings(blocking)}${foldText}\n\n` +
    `Each finding names the rule it breaks and its evidence. Check the evidence yourself first. If it does not hold — the rule is not broken, or the evidence is wrong — ` +
    `do not change code for it: list it in disputed with your counter-evidence. For a finding with a test draft, turn it into a behaviour test that fails ` +
    `before your fix and passes after it, and report it in regression with that finding's where. When the only finding is that the pull request conflicts with main, the merge is the whole fix. ` +
    `Otherwise one commit per finding. Push, patch the PR body only where it became false (REST PATCH with --input, never gh pr edit --body-file), run \`aco check ${pr}\` from the worktree. ` +
    `Return the new tip and files: git diff --name-only from mergedBase (from oldTip when mergeResolvedLaneConflict) to the new tip.`,
    { label: `fix-${spent.total}`, phase: 'Fix', schema: FIX, agentType: 'atelier:code-fixer', model: 'opus', effort: EFFORT.fix })
  if (!fixed) return { stop: openResult('failed', 'fix', { reason: `the fixer returned no result; inspect ${A.worktree} for commits past ${tip} and uncommitted work, then resume this run`, lastBlocking: blocking }) }
  if (![fixed.oldTip, fixed.mergedBase, fixed.tip].every(t => SHA.test(t || ''))) return { stop: openResult('failed', 'fix', { reason: 'the fixer returned a tip that is not a sha' }) }
  if (fixed.blocked) return { stop: openResult('escalated', 'fix', { reason: fixed.blockedReason }) }
  if ((fixed.disputed || []).length) {
    // A disputed finding is a disagreement between two fresh agents about evidence: the head decides it.
    disputed.push(...fixed.disputed)
    tip = fixed.tip
    const committed = !sameCommit(fixed.tip, fixed.oldTip)
    history.push({ after: spent.total, by: 'fix', tip: fixed.tip, reviewed: !committed })
    return { stop: openResult('awaiting-head', 'fix', { reason: committed ? 'the fixer disputes findings with counter-evidence; the returned tip carries fix commits no reviewer has seen' : 'the fixer disputes every finding with counter-evidence and committed nothing', lastBlocking: blocking }) }
  }
  const proofs = fixed.regression || []
  const brokenProof = proofs.filter(r => !r.failedBefore || !r.passesAfter)
  if (brokenProof.length) return { stop: openResult('failed', 'fix', { reason: 'a regression test did not fail before and pass after its fix', regression: proofs }) }
  const unproven = blocking.filter(f => f.testDraft && !proofs.some(r => r.finding === f.where))
  if (unproven.length) return { stop: openResult('failed', 'fix', { reason: 'a finding with a test draft got no regression test', lastBlocking: unproven }) }
  if (sameCommit(fixed.tip, fixed.oldTip)) return { stop: openResult('failed', 'fix', { reason: 'the fixer changed nothing', lastBlocking: blocking }) }
  const onlyMerged = sameCommit(fixed.tip, fixed.mergedBase)
  const mergeWasTheFinding = blocking.length === 1 && blocking[0].where === 'mergeable'
  if (onlyMerged && !mergeWasTheFinding) return { stop: openResult('failed', 'fix', { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }) }
  const from = fixed.mergeResolvedLaneConflict ? fixed.oldTip : fixed.mergedBase
  // A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
  const relative = (fixed.files || []).map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))
  if (relative.some(f => f.startsWith('/'))) return { stop: openResult('failed', 'fix', { reason: `the fixer reported paths outside the worktree: ${relative.filter(f => f.startsWith('/')).join(', ')}` }) }
  const touchesProduction = fixed.mergeResolvedLaneConflict || relative.some(f => PRODUCTION.some(prefix => f.startsWith(prefix)))
  tip = fixed.tip
  if (touchesProduction) productionSinceTest = true
  if (sameCommit(from, fixed.tip)) {  // a clean merge of main answered the mergeable finding: nothing of the lane changed to review
    log(`fix ${spent.total}: merged main cleanly, no lane change to review`)
    return { range: null, gateAgain: false, touchesProduction: false }
  }
  const range = `only this delta: git diff ${from}..${fixed.tip}` +
    (fixed.mergeResolvedLaneConflict ? ' (it includes a merge of main whose conflicts in this lane\'s files were resolved by hand)' : ' (the merge of main before it is not this lane\'s work)') +
    `. It answers these findings:\n${listFindings(blocking)}`
  log(`fix ${spent.total}: ${from.slice(0, 7)}..${tip.slice(0, 7)}`)
  return { range, gateAgain: MATERIAL && touchesProduction, touchesProduction }
}

// Review until clean. After every fix the delta goes back to whoever raised a finding, and the gate returns on a
// material lane when the fix touched production or resolved lane conflicts. REVISE is handled one way everywhere.
async function reviewUntilClean(which, range) {
  phase('Review')
  let rr = await reviewRound(which, range)
  while (rr.verdict.state === 'revise') {
    const blocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
    const raised = rr.which.filter((r, i) => rr.results[i] && (rr.results[i].blocking || []).length > 0)
    const f = await fixBatch(blocking, 'the review', 'review')
    if (f.stop) return f.stop
    if (!f.range) return openResult('failed', 'review', { reason: 'a review finding was answered by a merge alone', lastBlocking: blocking })
    const next = f.gateAgain && !raised.includes(GATE) ? raised.concat([GATE]) : raised
    phase('Review')
    rr = await reviewRound(next, f.range)
  }
  if (rr.verdict.state === 'failed') return openResult('failed', 'review', { reason: rr.verdict.reason })
  if (rr.verdict.state === 'architectural') return openResult('escalated', 'review', { reason: 'architectural verdict' })
  return null
}

// Re-entry after the head settled an awaiting-head result: review only the fix commits no reviewer has seen yet.
if (A.deltaFrom && !SHA.test(A.deltaFrom)) return openResult('failed', 'input', { reason: 'deltaFrom is not a sha' })
const firstRange = A.deltaFrom
  ? `only this delta: git diff ${A.deltaFrom}..HEAD — fix commits made for earlier blocking findings that no reviewer has seen yet. They answer:\n${A.answers || '(see the commit messages in the range)'}`
  : 'the whole lane: git diff origin/main...HEAD'
// Re-entry at the fix: the head hands over blocking findings from an earlier run (for example the tester's), and
// in-place follow-ups to fold in. The delta the fixer makes is reviewed before the test and CI run again.
if (A.fixFirst && A.fixFirst.length) {
  followups.push(...(A.foldIn || []))
  const f = await fixBatch(A.fixFirst, 'the head (carried over from the previous run)', 'test')
  if (f.stop) return f.stop
  // With deltaFrom, the head says a reviewer has not yet seen the commits since that sha: review all of them.
  const range = A.deltaFrom
    ? `only this delta: git diff ${A.deltaFrom}..HEAD — fixes no reviewer has seen yet. They answer:\n${A.answers || ''}\n${listFindings(A.fixFirst)}`
    : f.range
  if (range) {
    const stop = await reviewUntilClean(A.deltaFrom || f.gateAgain ? ALL : [REVIEW], range)
    if (stop) return stop
  }
} else {
  const first = await reviewUntilClean(ALL, firstRange)
  if (first) return first
}

// ---------------------------- end-to-end test and CI, in parallel, on one tip
function explore(n) {
  const prompt =
    `${laneFacts}\nYou test PR #${pr} at its lane tip ${tip} through the real entry point, like a curious user, before it lands. ` +
    `Run the lane's code, not the installed tool (from ${A.worktree}). What to drive:\n${A.e2e}\n\nContract:\n${A.contract}\n\n${BLOCKING_LINE}\n` +
    `For every blocking finding give a scenario name in where, unique within your report, the command that shows it in repro, and — when it can be automated stably — a failing test draft ` +
    `under your scratch path in testDraft (a live or UI case stays a manual proof; leave testDraft empty then). ` +
    `Write only under ${A.scratch}/${TAG}-e2e-${n}/. Take /tmp/probe-stack.lock with flock for any server or browser run, use a free port above 8790, ` +
    `stop every process you start, and never touch another session's server. Wait for the lock with \`flock -w 1200\`; if it stays held by someone else, return verdict failed with lockBusy true instead of guessing. verdict is PASS with no blocking findings and FAIL with at least one. Return evidencePath.`
  return safeAgent(prompt, { label: `e2e-${n}`, phase: 'Test and CI', schema: E2E, agentType: 'atelier:explorative-tester', model: 'opus', effort: EFFORT.test })
    .then(r => r || safeAgent(`Load the atelier:explorative-testing skill first.\n${prompt}`,
      { label: `e2e-${n}-fallback`, phase: 'Test and CI', schema: E2E, agentType: 'general-purpose', model: 'opus', effort: EFFORT.test }))
}

function watchCi(n) {
  return safeAgent(
    `Report CI for pull request #${pr}${A.repo ? ` in ${A.repo}` : ''}; change nothing in the repository. Return the PR head sha as head (\`gh pr view ${pr}${R} --json headRefOid --jq .headRefOid\`). ` +
    `If \`gh pr view ${pr}${R} --json mergeable --jq .mergeable\` says CONFLICTING, return green false with one failing entry: where "mergeable", text "the pull request conflicts with main", ` +
    `rule "GitHub runs no CI on a conflicting pull request", evidence the mergeable value. Otherwise wait in the foreground — you cannot be woken later: run \`timeout 540 gh pr checks ${pr}${R} --watch --interval 90\` (Bash timeout 600000 ms) and repeat it until it exits on its own rather than by the timeout, at most 7 times. If a check fails, ` +
    `rerun the failed jobs once (\`gh run rerun <run-id>${R} --failed\`) and watch again, so a flaky check does not count. green is true only when at least one check ran on head ` +
    `and every check on head succeeded; no checks at all is one failing entry: where "checks", text "no CI checks ran on the head commit", rule "CI must run on head", evidence the gh pr checks output. For each check that still failed: where = its name, text = what failed, ` +
    `rule = "CI check <name>", evidence = the last 30 lines of \`gh run view <run-id>${R} --log-failed\`.`,
    Object.assign({ label: `ci-${n}`, phase: 'Test and CI', schema: CI }, WATCHER))
}

let n = 0
let needTest = true
let lockRetried = false
while (true) {
  phase('Test and CI')
  // Both read the same immutable tip, so running them together cannot mix states; nothing fixes before both answered.
  const [e2e, ci] = await parallel([
    () => needTest ? explore(n) : Promise.resolve({ verdict: 'PASS', skipped: true, blocking: [], followups: [], evidencePath: 'skipped: no production change since the last test' }),
    () => watchCi(n),
  ])
  if (needTest) productionSinceTest = false
  n++
  if (e2e && e2e.verdict === 'failed' && e2e.lockBusy && !lockRetried) {
    lockRetried = true
    log('the shared probe lock was busy; trying the end-to-end test once more')
    continue
  }
  if (!e2e || e2e.verdict === 'failed') return openResult('failed', 'test', { reason: e2e && e2e.lockBusy ? 'the shared probe lock stayed busy twice' : 'the tester returned no usable result' })
  if (!ci) return openResult('failed', 'ci')
  const testBlocking = e2e.blocking || []
  if (e2e.verdict === 'FAIL' && testBlocking.length === 0) return openResult('failed', 'test', { reason: 'a FAIL verdict came without any blocking finding' })
  // A blocking finding outranks a PASS label, as in the review classifier.
  if (!sameCommit(ci.head, tip)) return openResult('failed', 'ci', { reason: `the pull request head ${ci.head} is not the lane tip ${tip}` })
  history.push({ after: spent.total, by: `e2e-${n - 1}`, verdict: e2e.skipped ? 'SKIPPED' : (testBlocking.length ? 'FAIL' : 'PASS'), reportPath: e2e.evidencePath || '' })
  history.push({ after: spent.total, by: `ci-${n - 1}`, verdict: ci.green ? 'GREEN' : 'RED' })
  followups.push(...(e2e.followups || []))
  if (testBlocking.length === 0 && ci.green) break

  const ciBlocking = ci.green ? [] : (ci.failing || [])
  const budgetKey = testBlocking.length ? 'test' : 'ci'
  const f = await fixBatch(testBlocking.concat(ciBlocking), testBlocking.length ? 'the end-to-end test and CI' : 'CI', budgetKey)
  if (f.stop) return f.stop
  if (f.range) {
    const stop = await reviewUntilClean(f.gateAgain ? ALL : [REVIEW], f.range)
    if (stop) return stop
  }
  // The tester runs again when it had failed or when any fix since its last run (a review fix included) touched production.
  // A clean merge of main alone does not re-run it: the integrated tree is then proven by CI, not by the tester. CI always runs again.
  needTest = testBlocking.length > 0 || productionSinceTest
}

const openFollowups = dedupeFollowups()
return {
  status: 'ready-to-land', pr, tip, spent, history, followups: openFollowups, disputed,
  requiredHeadActions: [
    `land with \`aco land ${pr}\` only while the pull request head is still ${tip}`,
    ...(openFollowups.length ? [`route ${openFollowups.length} follow-up(s) to their owning items before landing`] : []),
    `update the body of item #${A.item}'s parent and name what the landing freed`,
  ],
}
