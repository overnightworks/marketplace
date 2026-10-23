export const meta = {
  name: 'lane',
  description: 'One claimed lane to ready-to-land: build, a fresh Sonnet review (plus a Codex gpt-6-astra gate on material risk), fresh fixers with evidence-bearing findings and a delta re-check by whoever raised them, then the explorative end-to-end test and CI in parallel on one tip.',
  whenToUse: 'In any repository that coordinates with aco, after the head ran `aco start <item>` (worktree, branch and claim exist). Landing stays with the head; the result lists requiredHeadActions. Required args: item (the work item number), worktree (the lane\'s isolated worktree path), branch (the lane branch), contract (the item\'s ruled sentences every reviewer and the tester judge against), e2e (what the explorative tester drives through the real entry point), scratch (a directory for briefs, Codex output and test evidence). Start with build (a builder brief) for a new lane, or with pr and tip (an open pull request and its head sha) to resume one. Optional args and their defaults: risk "normal" (or "material": adds a Codex gpt-6-astra final gate); reviewer "claude" (a fresh Sonnet reviewer; "codex" routes the ordinary review to Codex gpt-6-astra); routing none (per-role overrides {role: {model, effort}} of the table at the top of the script, for build, fix, test, review, gate and mechanical; a fix batch whose blocking findings are all docs and that carries no fold-ins runs as mechanical; effort never above high, the gate always on another provider than the builder); builderProvider "claude" (the only accepted value, because the gate runs on Codex); repo none (every gh call then targets the worktree\'s own repository; pass owner/name when the head runs elsewhere); productionPaths ["src/", "pyproject.toml", "uv.lock"], a default that fits a src-layout Python repository (path prefixes whose change re-opens the gate on a material lane and re-runs the end-to-end test); ledgers [], a default that fits a repository without append-only ledgers (files whose merge conflicts keep both sides, main\'s lines first); budgets {review: 5, test: 2, ci: 3, total: 8} (fix rounds per phase and in total; partial objects override single keys); deltaFrom none (a sha: review only the commits since it, after the head settled an awaiting-head result); answers none (what those commits answer); fixFirst none (Finding[]: blocking findings a fresh fixer answers before anything else); foldIn none (Followup[]: follow-ups for that fixer, each handed over whatever its owner or wording; given alone it still starts the fixer).',
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
const MATERIAL = A.risk === 'material'
// Every gh call names the repository explicitly: agents start in the head's own checkout, which may be another repository.
if (A.repo && !/^[\w.-]+\/[\w.-]+$/.test(A.repo)) return { status: 'failed', stage: 'input', reason: 'repo must be owner/name' }
const R = A.repo ? ` -R ${A.repo}` : ''
const IN_REPO = A.repo ? ` in ${A.repo}` : ''
const TAG = `wf-${A.item}`
// Paths whose change re-opens the gate on a material lane and re-runs the end-to-end test: code and public contract.
// The default fits a src-layout Python repository.
const PRODUCTION = A.productionPaths || ['src/', 'pyproject.toml', 'uv.lock']
// Separate budgets per phase plus one total: review usually needs 2-4 rounds, a tester or CI rarely more than 2.
const B = { review: 5, test: 2, ci: 3, total: 8, ...A.budgets }
const LEDGERS = A.ledgers || []
// The one table of every role's model and effort (instructions/AGENTS.md, "Model routing"). Effort is medium unless the
// row says otherwise; high is the ceiling. Nothing else in this script names a model.
const MODEL_PROVIDER = { haiku: 'claude', sonnet: 'claude', opus: 'claude', fable: 'claude', 'gpt-6-astra': 'codex' }
const EFFORT_CEILING = new Set(['low', 'medium', 'high'])
const BUILDER_PROVIDER = A.builderProvider || 'claude'
const REVIEWER_PROVIDER = A.reviewer || 'claude'
const DEFAULT_ROUTING = {
  mechanical: { model: 'haiku', effort: 'low' },
  build: { model: 'sonnet', effort: 'medium' },
  fix: { model: 'sonnet', effort: 'medium' },
  test: { model: 'sonnet', effort: 'medium' },
  review: REVIEWER_PROVIDER === 'codex' ? { model: 'gpt-6-astra', effort: 'medium' } : { model: 'sonnet', effort: 'medium' },
  gate: { model: 'gpt-6-astra', effort: 'high' },
}
// The provider each role must run on: reviews on the chosen reviewer provider, the gate on any provider but the builder's.
const providerAllowed = {
  mechanical: (provider) => provider === 'claude',
  build: (provider) => provider === 'claude',
  fix: (provider) => provider === 'claude',
  test: (provider) => provider === 'claude',
  review: (provider) => provider === REVIEWER_PROVIDER,
  gate: (provider) => provider !== BUILDER_PROVIDER,
}

// Why one role's override is refused, or null.
function roleChoiceRefusal(role, choice) {
  if (!Object.hasOwn(DEFAULT_ROUTING, role)) return `routing names an unknown role "${role}"`
  if (typeof choice !== 'object' || choice === null) return `routing for ${role} must be {model, effort}`
  const knownModel = typeof choice.model === 'string' && Object.hasOwn(MODEL_PROVIDER, choice.model)
  if (choice.model !== undefined && !knownModel) return `routing for ${role} names an unknown model "${choice.model}"`
  if (choice.effort !== undefined && !EFFORT_CEILING.has(choice.effort)) return `routing for ${role} sets effort "${choice.effort}"; high is the ceiling`
  const model = choice.model || DEFAULT_ROUTING[role].model
  if (providerAllowed[role](MODEL_PROVIDER[model])) return null
  return `routing for ${role} puts it on ${MODEL_PROVIDER[model]}, which breaks ${role === 'gate' ? 'gate provider separation from the builder' : 'the role\'s provider'}`
}

// Why a routing override is refused, or null. An override never bypasses reviewer independence, gate provider
// separation or the effort ceiling.
function routingRefusal(overrides) {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return 'routing must be an object of roles'
  for (const [role, choice] of Object.entries(overrides)) {
    const refusal = roleChoiceRefusal(role, choice)
    if (refusal) return refusal
  }
  return null
}
if (A.routing !== undefined) {
  const refusal = routingRefusal(A.routing)
  if (refusal) return { status: 'failed', stage: 'input', reason: refusal }
}
const ROUTING = Object.fromEntries(Object.entries(DEFAULT_ROUTING).map(([role, chosen]) => [role, { ...chosen, ...A.routing?.[role] }]))
const MECHANICAL = { agentType: 'general-purpose', ...ROUTING.mechanical }
const WATCHER = MECHANICAL
const claudeRole = (role) => ({ model: ROUTING[role].model, effort: ROUTING[role].effort })

// agent() with a schema THROWS when a subagent ends without calling StructuredOutput (seen on 26.09.2026: a builder hit
// its turn limit after 151 tool calls, left its work uncommitted, and the throw ended the whole run). Every call goes
// through this wrapper, so such an end is a null result the lane reports, never a crashed run.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

// --------------------------------------------------------------- schemas
// A finding carries the rule it breaks and the evidence for it, so a fixer never acts on a bare assertion. Its kind
// decides what proves the fix: a defect's test fails before it, a test-gap's test fails under a named mutation.
const FINDING_KINDS = ['defect', 'test-gap', 'docs']
const FINDING = {
  type: 'object',
  required: ['where', 'kind', 'text', 'rule', 'evidence'],
  properties: {
    where: { type: 'string', description: 'file:line, or the check or scenario name' },
    kind: { type: 'string', enum: FINDING_KINDS, description: 'defect: the code breaks a rule or its promise; test-gap: a behaviour without a test, the code is right and only the test pinning it is missing; docs: only text is wrong' },
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
const RESCOPE = {
  type: 'array',
  description: 'paths outside the claim scope that the work needs changed; you edited none of them',
  items: { type: 'object', required: ['path', 'change', 'reason'], properties: { path: { type: 'string' }, change: { type: 'string', description: 'the change the path needs' }, reason: { type: 'string', description: 'why the work cannot be done without it' } } },
}
const BUILD = {
  type: 'object',
  required: ['pr', 'tip', 'blocked'],
  properties: { pr: { type: 'number' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' }, rescope: RESCOPE },
}
const SYNC = {
  type: 'object',
  required: ['merged', 'tip', 'stoppedOnConflict'],
  properties: { merged: { type: 'boolean' }, tip: { type: 'string', pattern: '^[0-9a-f]{7,40}$', description: 'a commit sha from git rev-parse, nothing else' }, stoppedOnConflict: { type: 'boolean' }, note: { type: 'string' } },
}
// The agent copies aco's outside_claim as JSON text; the script parses it, so no field is derived by the model.
// The pattern admits exactly aco's two printed forms (null, or a list of strings), so a copying slip fails the schema
// and the agent answers again; a failed command is reported in command_error, never in a scope answer.
const JSON_STRING = String.raw`"([^"\\]|\\.)*"`
const OUTSIDE_CLAIM_PATTERN = String.raw`^\s*(null|\[\s*(${JSON_STRING}(\s*,\s*${JSON_STRING})*)?\s*\])\s*$`
const PUSH_AND_SCOPE_CHECK = {
  type: 'object',
  required: [],
  properties: {
    remote_tip: { type: 'string', description: 'the last printed line of the first command line, unchanged; leave it out when that command failed' },
    outside_claim: { type: 'string', pattern: OUTSIDE_CLAIM_PATTERN, description: 'the printed line of the second command line, unchanged; leave it out when either command failed' },
    command_error: { type: 'string', description: 'the error output of the command line that failed or printed nothing; leave it out when both succeeded' },
  },
}
const CLAIM_SCOPE_RULE = 'a lane edits only inside its claim scope'
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
const COURIER_VERDICT = { ...VERDICT, required: [...VERDICT.required, 'codexExit'] }
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
    resolved: {
      type: 'array',
      description: 'fold-ins you found already done: left in the worktree by an earlier fixer whose fix was not accepted, or already satisfied by the lane tip',
      items: { type: 'object', required: ['where', 'text', 'evidence'], properties: { where: { type: 'string' }, text: { type: 'string' }, evidence: { type: 'string', description: 'the test, probe cell or line that already satisfies it' } } },
    },
    regression: {
      type: 'array',
      description: "every test you add for a finding, under that finding's exact where",
      items: { type: 'object', required: ['finding', 'kind', 'test', 'failedBefore', 'passesAfter'], properties: { finding: { type: 'string', description: 'the where of the finding it proves' }, kind: { type: 'string', enum: FINDING_KINDS, description: "the kind of that finding, so a proof is judged by its own finding's bar" }, resolution: { type: 'string', enum: ['removed-vacuous'], description: 'for a test-gap finding whose test pins no behaviour: the fix removed that test instead of adding one' }, diff: { type: 'string', description: 'for removed-vacuous: the removal diff' }, test: { type: 'string' }, failedBefore: { type: 'boolean' }, passesAfter: { type: 'boolean' }, mutation: { type: 'string', description: 'for a test-gap finding: the production change, made and reverted, under which the test fails' } } },
    },
    summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' }, rescope: RESCOPE,
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
  `Work item #${A.item}${IN_REPO}. Worktree ${A.worktree}, branch ${A.branch}; run every command from inside that worktree (cd there first). The head holds the claim: never claim, release, rescope, merge a pull request or land. ` +
  `Never use git stash and never touch the main checkout. Read the item body first (gh issue view ${A.item}${R} --json body --jq .body) and ` +
  `\`aco brief ${A.item} --step <step>\` for the repository's RULES and CHECKS. Local runs stay targeted under PYTEST_XDIST_AUTO_NUM_WORKERS=4; ` +
  `read the 1-minute load average before any test run and wait while it is above 1.5 × cores. CI is the gate. ` +
  (LEDGERS.length ? `When you merge origin/main, a conflict in the append-only ledgers (${LEDGERS.join(' and ')}) keeps both sides, main's lines first. ` : '') +
  `You are one step of a workflow the head session runs: a message from the operator that reaches you and is not about this step is addressed to the head — ` +
  `finish this step, and quote the message in your report so the head sees it.`

// For the agents that may run a drive (the builder and the fixer); the tester already writes under its own scratch directory.
const rescopeFacts =
  `When the work needs a path outside the claim scope, edit nothing there: finish what lies inside, and list the path, the change it needs and the reason in rescope. The head then runs aco rescope and resumes.`

const driveFacts = `Any drive you run keeps its pidfiles and evidence under ${A.scratch}.`

const BLOCKING_LINE =
  `A finding is **blocking** when the change introduces a defect against the item's contract, a repository specification, ` +
  `a repository rule, data safety, security, secrets, a public contract, or a failing check, except a gap outside the listed cases of a component whose spec declares it a tripwire by operator ruling, which is follow-up for its owning item. Everything else is a **follow-up**: polish, ` +
  `behaviour that already exists on origin/main unchanged (reproduce it there before calling it pre-existing), or work outside the lane's scope — ` +
  `each follow-up names its owning item (#n) or "distributor". Every blocking finding names the rule it breaks and the evidence you observed; ` +
  `a finding you cannot back with evidence is not blocking. Every blocking finding names its kind: **defect** when the code breaks a rule or ` +
  `does not do what the contract, its docs or its own text promise — a mismatch between promise and code is defect unless the contract says the code is right, ` +
  `and then it is **docs**, as is any finding where only documentation or a comment is wrong; **test-gap** when the code already does what the contract says ` +
  `and a behaviour has no test that pins it. Hygiene in test code (a needless monkeypatch, a test without a criterion ID) is a **defect** whose proof is the diff, not a mutation.`

// The reviewer stopgap of the fleet roadmap (#80, Q0): the reviewer is the only brake until a ratchet checks these.
const STOPGAP_LINE =
  `Refuse (blocking defect) a new file of 800 lines or more; a new test without a criterion ID or \`defect:#n\`; ` +
  `and a new patch or monkeypatch at an import location or on a private attribute where a fake on PATH or an injected port works.`

const CODEX_SCHEMA = JSON.stringify({
  type: 'object', additionalProperties: false,
  required: ['verdict', 'blocking', 'followups', 'checked_correct'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'architectural'] },
    blocking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'kind', 'text', 'rule', 'evidence'],
      properties: { where: { type: 'string' }, kind: { type: 'string', enum: FINDING_KINDS }, text: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' } } } },
    followups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'text', 'owner'],
      properties: { where: { type: 'string' }, text: { type: 'string' }, owner: { type: 'string' } } } },
    checked_correct: { type: 'string' },
  },
})

const findingKey = (f) => `${f.where}::${f.text}`
// A finding from a run that predates kinds (a resumed run) keeps the rule it was raised under.
const kindOf = (f) => f.kind || 'defect'
const listFindings = (list) => list.map((f, i) =>
  `${i + 1}. ${f.where} — ${f.text}\n   kind: ${kindOf(f)}\n   rule: ${f.rule}\n   evidence: ${f.evidence}` +
  (f.repro ? `\n   repro: ${f.repro}` : '') + (f.testDraft ? `\n   test draft: ${f.testDraft}` : '')).join('\n')

// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent agent);
// a fresh Sonnet reviewer is the default. The final gate on a material lane must come from another provider than the
// Claude builder, so it runs on Codex through a courier.
function reviewerBrief(role, range) {
  return `You are the ${role} for work item #${A.item}: a fresh, independent reviewer who did not write this change. ` +
    `Contract:\n${A.contract}\n\nReview ${range}.\n\n${BLOCKING_LINE}\n\n${STOPGAP_LINE}\n\n` +
    `verdict is APPROVE with no blocking findings, REVISE with at least one, or architectural when the cut itself is wrong.`
}

function claudeReview(label, role, range) {
  return safeAgent(
    `Work read-only in ${A.worktree} on branch ${A.branch}: read files and run read-only commands freely; do not run tests and do not edit anything.\n` +
    reviewerBrief(role, range),
    { label, phase: 'Review', schema: VERDICT, agentType: 'atelier:code-reviewer', ...claudeRole('review') })
}

const STRUCTURED_OUTPUT_ONLY_LINE = `Your only final action is the StructuredOutput call; never write a text answer first.`

// A courier that reports failed beside a clean Codex exit contradicts itself; one read-only courier reads the same files again.
function rereadContradictoryCourier(answer, label, base) {
  if (!(answer?.verdict === 'failed' && answer.codexExit === 0)) return answer
  return safeAgent(
    `You are a courier re-reading a finished Codex review. Do not start Codex, do not review anything yourself and do not edit anything.\n` +
    `Read ${base}-out.json.exit and ${base}-out.json. If the exit status is 0 and the file is valid JSON, copy its verdict, blocking and followups verbatim into the StructuredOutput call, with reportPath ${base}-out.json and codexExit 0. ` +
    `Otherwise return verdict failed with the exit status in codexExit (-1 when there is no marker) and the reason in note.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label: `${label}-reread`, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
}

function codexReview(label, routing, role, range) {
  const base = `${A.scratch}/${TAG}-${label}`
  const brief = `Read-only sandbox: read files and run read-only commands freely; do not run tests. The sandbox has no network and cannot write, /tmp included; report a command you cannot run as not verified, never as a blocking finding.\n` + reviewerBrief(role, range) +
    `\nGive every finding its file:line in "where".`
  return safeAgent(
    `You are a courier for one independent Codex review. Do not review anything yourself and do not edit the repository.\n` +
    `1. rm -f ${base}-out.json ${base}-out.json.exit ${base}-out.json.exit.tmp\n` +
    `2. Write this brief verbatim to ${base}-brief.md:\n-----\n${brief}\n-----\n` +
    `3. Write this JSON schema verbatim to ${base}-schema.json:\n${CODEX_SCHEMA}\n` +
    `4. Start Codex detached, recording its exit status in a marker file:\n` +
    `   cd ${A.worktree} && setsid nohup bash -c 'codex exec -s read-only -C ${A.worktree} -m ${routing.model} -c model_reasoning_effort=${routing.effort} --output-schema ${base}-schema.json -o ${base}-out.json - < ${base}-brief.md; echo $? > ${base}-out.json.exit.tmp && mv ${base}-out.json.exit.tmp ${base}-out.json.exit' > ${base}-run.log 2>&1 &\n` +
    `5. Wait in the foreground — you cannot be woken later, your task ends when you answer. Run this Bash command (timeout 600000 ms) and repeat it until the marker exists, at most 7 times:\n` +
    `   timeout 540 bash -c 'until [ -f ${base}-out.json.exit ]; do sleep 30; done'; ls ${base}-out.json.exit\n` +
    `   Never answer before the marker exists or the 7 waits are spent. Never return a placeholder or a pending result.\n` +
    `6. If ${base}-run.log says the model is at capacity, wait 5 minutes and start again from step 1, once, with the same model. Never switch models: a gate stays on its model.\n` +
    `7. Decide by the exit status first. If ${base}-out.json.exit holds 0 and ${base}-out.json is valid JSON, return its verdict, blocking and followups UNCHANGED, ` +
    `reportPath ${base}-out.json and codexExit 0: APPROVE, REVISE and architectural are all valid review results, and a REVISE with blocking findings is never failed — the lane sends those findings to a fixer. Copy them verbatim from the out.json into the StructuredOutput call.\n` +
    `   Return verdict failed only when the 7 waits are spent without a marker (codexExit -1), the exit status is not 0 (codexExit = that number), or the file is missing or not valid JSON. ` +
    `Then give the last 20 lines of ${base}-run.log in note.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
    .then(v => rereadContradictoryCourier(v, label, base))
    .then(v => (v && v.codexExit !== 0 && v.verdict !== 'failed') ? { ...v, verdict: 'failed', note: `courier returned a verdict without a clean Codex exit (${v.codexExit}): ${v.note || ''}` } : v)
}

const reviewBy = (r, label, range) => r.provider === 'codex' ? codexReview(label, ROUTING[r.key], r.role, range) : claudeReview(label, r.role, range)

// One classifier for every review round: every started review must return, and verdict and findings must agree.
function classify(results, expected) {
  const got = results.filter(Boolean)
  if (got.length !== expected) return { state: 'failed', reason: `${expected - got.length} review(s) returned nothing` }
  if (got.some(v => v.verdict === 'failed')) return { state: 'failed', reason: got.map(v => v.note || '').join(' | ') }
  if (got.some(v => v.verdict === 'architectural')) return { state: 'architectural' }
  // An evidenced blocking finding outranks its label (APPROVE with a finding counts as REVISE). A REVISE with nothing
  // to fix stays broken: that is how a courier's placeholder was caught.
  if (got.some(v => v.verdict === 'REVISE' && (v.blocking || []).length === 0)) return { state: 'failed', reason: 'a REVISE verdict came without any blocking finding' }
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
const folded = new Map()  // follow-up key -> the follow-up, with the tip of the accepted fix that folded it in
const REVIEW = { key: 'review', provider: REVIEWER_PROVIDER, role: 'independent reviewer' }
const GATE = { key: 'gate', provider: MODEL_PROVIDER[ROUTING.gate.model], role: 'final gate (architecture, data safety, public contract)' }
const ALL = MATERIAL ? [REVIEW, GATE] : [REVIEW]

function openFollowups() {
  const open = new Map()
  followups.forEach(f => { if (!folded.has(findingKey(f)) && !open.has(findingKey(f))) open.set(findingKey(f), f) })
  return [...open.values()]
}
const raisedBeforeTip = (open) => open.filter(f => f.tip && !sameCommit(f.tip, tip))
// A builder or fixer that needs a path outside the claim hands the head a rescope request; the scope stage stays the backstop.
const awaitRescope = (stage, rescope, reason = '', extra = {}) =>
  openResult('awaiting-head', stage, { reason: `the work needs paths outside the claim scope; run aco rescope for them and resume with fixFirst carrying the rescope entries as findings (path to where, change to text, reason to evidence, kind defect), so a fixer makes the change.${reason}`, rescope, ...extra })
const openResult = (status, stage, extra) =>
  ({ status, stage, pr, tip, spent, routing: ROUTING, history, followups: openFollowups(), raisedBeforeTip: raisedBeforeTip(openFollowups()), folded: [...folded.values()], disputed, ...extra })

// ---------------------------------------------------------------- build
if (A.build) {
  phase('Build')
  const built = await safeAgent(
    `${laneFacts} ${driveFacts} ${rescopeFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted, and if you run short of turns, commit what is green and report what is left instead of continuing. Merge origin/main into the lane before pushing (a merge commit). ` +
    `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip and summary.`,
    { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', ...claudeRole('build') })
  if (!built) return openResult('failed', 'build', { reason: `the builder returned no result; inspect ${A.worktree} for uncommitted work, checkpoint it, and hand it to a fresh finisher` })
  if (!(built.rescope || []).length && built.blocked) return openResult('escalated', 'build', { reason: built.blockedReason })
  if (!SHA.test(built.tip || '')) return openResult('failed', 'build', { reason: `the builder returned a tip that is not a sha: ${String(built.tip).slice(0, 80)}` })
  pr = built.pr; tip = built.tip
  if ((built.rescope || []).length) return awaitRescope('build', built.rescope, ` The returned tip is the whole build and no reviewer has seen it; resume with fixFirst and deltaFrom set to the output of \`git -C '${A.worktree}' merge-base origin/main ${tip}\` after \`git -C '${A.worktree}' fetch origin\`.`)
  log(`built PR #${pr} at ${tip}`)
} else {
  phase('Sync')
  const git = `git -C '${A.worktree}'`
  const synced = await safeAgent(
    `${laneFacts}\nBring the lane up to date with main and change nothing else. Run each command exactly as written, with its -C option. ${git} fetch origin; if ${git} merge-base --is-ancestor origin/main HEAD succeeds, change nothing. ` +
    `Otherwise ${git} merge origin/main; when it merges cleanly, ${git} push. ` +
    (LEDGERS.length ? `Conflicts only in the append-only ledgers: resolve them as the lane facts say, commit the merge, ${git} push. Any other conflict: ` : `Any conflict: `) +
    `run ${git} merge --abort, confirm \`${git} status --porcelain\` is empty, push nothing, and return stoppedOnConflict true with the conflicting paths in note. Return merged true only when you made and pushed a merge commit, and tip as the output of \`${git} rev-parse HEAD\` — a sha, no words.`,
    { label: 'sync', phase: 'Sync', schema: SYNC, ...MECHANICAL })
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
    history.push({ after: spent.total, by: which[i].key, verdict: v.verdict, blocking: (v.blocking || []).map(f => f.where), reportPath: v.reportPath || '' })
    followups.push(...(v.followups || []).map(f => ({ ...f, tip })))
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

// Why no further fix round may start, or null while the budgets allow one and the findings still move.
function fixRoundStop(blocking, budgetKey) {
  if (spent[budgetKey] >= B[budgetKey] || spent.total >= B.total) {
    const which = spent.total >= B.total ? 'total' : budgetKey
    return openResult(budgetKey === 'ci' ? 'ci-red' : 'unresolved', budgetKey, { reason: `${which} budget spent`, lastBlocking: blocking })
  }
  const repeated = noProgress(blocking)
  if (repeated.length) {
    const leftScope = repeated.filter(f => f.rule === CLAIM_SCOPE_RULE)
    const reason = leftScope.length ? `a fixer left the claim scope again at ${leftScope.map(f => f.where).join(', ')}` : 'a finding came back unchanged after its fix'
    return openResult('unresolved', budgetKey, { reason, lastBlocking: repeated })
  }
  return null
}

// The contract lets a fixer resolve a small follow-up in a file the lane already changed, when it cannot change behaviour.
// A fold-in counts as folded only once the fix that carries it is accepted; until then it stays open.
// The head named the items it passes as foldIn, so the wording filter does not second-guess them.
const namedByHead = new Set((A.foldIn || []).map(findingKey))
const inPlaceFollowups = () => openFollowups().filter(f => namedByHead.has(findingKey(f)) || /fix in place/i.test(`${f.owner} ${f.text}`))
const listFoldIns = (foldIn) => foldIn.map((f, i) => `${i + 1}. ${f.where} — ${f.text}`).join('\n')
function foldInBrief(foldIn) {
  if (!foldIn.length) return ''
  return `\n\nAlso fold in these follow-ups, only because each sits in a file this lane already changed and cannot change behaviour; one commit for all of them. ` +
    `One that is already done — left in the worktree by an earlier fixer, or already satisfied by the lane tip — you do not redo; list it in resolved with its evidence (the test, probe cell or line that satisfies it). ` +
    `When that leaves you nothing to change, change nothing:\n` +
    listFoldIns(foldIn)
}
// The reviewer sees which follow-ups the fixer was given, so it can tell a skipped one from a done one.
const foldInsInRange = (foldIn) => foldIn.length ? `\nThe fixer was also given these follow-ups to fold in; check each is done:\n${listFoldIns(foldIn)}` : ''

// The fixer's returned tip becomes the lane tip; it is unreviewed when the fixer committed anything. Returns whether it did.
function adoptFixerTip(fixed) {
  tip = fixed.tip
  const committed = !sameCommit(fixed.tip, fixed.oldTip)
  history.push({ after: spent.total, by: 'fix', tip: fixed.tip, reviewed: !committed })
  return committed
}

// A disputed finding is a disagreement between two fresh agents about evidence: the head decides it.
function awaitHeadOnDispute(fixed, blocking) {
  disputed.push(...fixed.disputed)
  const committed = adoptFixerTip(fixed)
  return openResult('awaiting-head', 'fix', { reason: committed ? 'the fixer disputes findings with counter-evidence; the returned tip carries fix commits no reviewer has seen' : 'the fixer disputes every finding with counter-evidence and committed nothing', lastBlocking: blocking })
}

// What a proof still has to show for the finding it names, or null when it shows it. A test-gap's code was already
// right, so its test passes after the fix and pins the behaviour when a mutation, or the pre-fix code, makes it fail.
// A test that pins nothing may be removed instead, with its diff as the proof.
function proofGap(proof, finding) {
  const kind = kindOf(finding)
  if (kind === 'docs') return null
  if (kind === 'test-gap') {
    if (proof.resolution === 'removed-vacuous') return (proof.diff || '').trim() ? null : `the removal of a vacuous test for ${finding.where} carried no diff`
    if (!proof.passesAfter) return `a test-gap test for ${finding.where} did not pass after the fix`
    return (proof.mutation || '').trim() || proof.failedBefore ? null : `a test-gap test for ${finding.where} named no mutation under which it fails and did not fail before the fix`
  }
  return (proof.failedBefore || !needsProof(finding)) && proof.passesAfter ? null : 'a regression test did not fail before and pass after its fix'
}

// Whether a fix must prove the finding with a test: a test-gap is nothing but a missing test, a defect's test draft
// asks for one, and a docs finding needs none even when a draft came with it.
const needsProof = (finding) => kindOf(finding) === 'test-gap' || (kindOf(finding) === 'defect' && Boolean(finding.testDraft))

// Why a fixer's answer does not count as a fix, or null when it does. A proof counts only for the blocking finding
// whose where and kind it names exactly; a proof for anything else (a fold-in, say) is not checked.
const proves = (proof, finding) => proof.finding === finding.where && proof.kind === kindOf(finding)
// The evidence the fixer gave for a fold-in it found already done, or undefined without any.
const satisfiedEvidence = (fixed, foldIn) => (fixed.resolved || []).find(r => r.where === foldIn.where && (r.evidence || '').trim())?.evidence
// An unchanged tip is a fix only when there are no blocking findings and every fold-in is proven already satisfied.
const everyFoldInSatisfied = (fixed, blocking, foldIn) => !blocking.length && foldIn.length > 0 && foldIn.every(f => satisfiedEvidence(fixed, f))
function fixRejection(fixed, blocking, foldIn) {
  const proofs = fixed.regression || []
  const gaps = proofs.flatMap(proof => blocking.filter(f => proves(proof, f)).map(finding => ({ proof, finding, gap: proofGap(proof, finding) })))
    .filter(checked => checked.gap)
  if (gaps.length) return { reason: [...new Set(gaps.map(checked => checked.gap))].join('; '), regression: gaps.map(checked => checked.proof), lastBlocking: gaps.map(checked => checked.finding) }
  const unproven = blocking.filter(f => needsProof(f) && !proofs.some(r => proves(r, f)))
  if (unproven.length) return { reason: 'a test-gap finding or a defect with a test draft got no regression test', lastBlocking: unproven }
  // Whether main moved or not, satisfied fold-ins leave the lane exactly at the merge: anything past it is unasked work.
  const nothingPastTheMerge = everyFoldInSatisfied(fixed, blocking, foldIn) && sameCommit(fixed.tip, fixed.mergedBase)
  if (sameCommit(fixed.tip, fixed.oldTip)) return nothingPastTheMerge ? null : { reason: 'the fixer changed nothing', lastBlocking: blocking }
  const mergeWasTheFinding = blocking.length === 1 && blocking[0].where === 'mergeable'
  if (sameCommit(fixed.tip, fixed.mergedBase) && !mergeWasTheFinding && !nothingPastTheMerge) return { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }
  return null
}

// A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
const worktreeRelative = (files) => files.map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))

// A removal answers a test-gap only if the reviewer agrees the removed test pinned nothing; a defect proof is judged by the defect bar.
const answersTestGap = (proof, blocking) => blocking.some(f => kindOf(f) === 'test-gap' && proves(proof, f))
const removalsInRange = (fixed, blocking) => (fixed.regression || []).filter(proof => proof.resolution === 'removed-vacuous' && answersTestGap(proof, blocking))
  .map(proof => `\nThe fixer answered ${proof.finding} by removing a vacuous test instead of adding one; judge whether the removed test pinned no behaviour:\n${proof.diff}`).join('')

// Takes the fixer's tip and names the delta the reviewers see next, or none when a clean merge of main was the whole fix.
function acceptFix(fixed, blocking, foldIn) {
  const from = fixed.mergeResolvedLaneConflict ? fixed.oldTip : fixed.mergedBase
  const relative = worktreeRelative(fixed.files || [])
  const outside = relative.filter(f => f.startsWith('/'))
  if (outside.length) return { stop: openResult('failed', 'fix', { reason: `the fixer reported paths outside the worktree: ${outside.join(', ')}` }) }
  const touchesProduction = fixed.mergeResolvedLaneConflict || relative.some(f => PRODUCTION.some(prefix => f.startsWith(prefix)))
  tip = fixed.tip
  if (touchesProduction) productionSinceTest = true
  if (sameCommit(from, fixed.tip)) {  // a clean merge of main answered the mergeable finding: nothing of the lane changed to review
    log(`fix ${spent.total}: merged main cleanly, no lane change to review`)
    return { range: null, gateAgain: false, touchesProduction: false }
  }
  const range = `only this delta: git diff ${from}..${fixed.tip}` +
    (fixed.mergeResolvedLaneConflict ? ' (it includes a merge of main whose conflicts in this lane\'s files were resolved by hand)' : ' (the merge of main before it is not this lane\'s work)') +
    `. It answers these findings:\n${listFindings(blocking)}${removalsInRange(fixed, blocking)}${foldInsInRange(foldIn)}`
  log(`fix ${spent.total}: ${from.slice(0, 7)}..${tip.slice(0, 7)}`)
  return { range, gateAgain: MATERIAL && touchesProduction, touchesProduction }
}

// Only a docs finding is provably behaviour-neutral; whether a defect changes behaviour needs judgement.
const fixerRole = (blocking, foldIn) => blocking.length > 0 && blocking.every(f => f.kind === 'docs') && !foldIn.length ? 'mechanical' : 'fix'

async function fixBatch(blocking, source, budgetKey) {
  const stop = fixRoundStop(blocking, budgetKey)
  if (stop) return { stop }
  spent[budgetKey]++; spent.total++
  const foldIn = inPlaceFollowups()
  const fixerTask = blocking.length
    ? `Then answer exactly these blocking findings from ${source}, and nothing else:\n${listFindings(blocking)}`
    : 'There are no blocking findings; your whole task is the follow-ups below:'
  phase('Fix')
  const fixed = await safeAgent(
    `${laneFacts} ${driveFacts} ${rescopeFacts}\nYou are a fresh fixer for PR #${pr} (lane tip ${tip}). Return that tip as oldTip. First merge origin/main if it moved (a merge commit; ` +
    `resolve other conflicts only when you can do so without changing behaviour, and set mergeResolvedLaneConflict true when files this lane changed needed resolution). ` +
    `Return the tip after that merge as mergedBase (oldTip when main had not moved). If the worktree already carries commits or uncommitted changes past that tip from an earlier fixer that ran out of turns, judge them, keep what is right, and continue from there. Commit each finding as soon as it is green; if you run short of turns, commit what is green and return what is left in blockedReason with blocked true. ${fixerTask}${foldInBrief(foldIn)}\n\n` +
    `Each finding names the rule it breaks and its evidence. Check the evidence yourself first. If it does not hold — the rule is not broken, or the evidence is wrong — ` +
    `do not change code for it: list it in disputed with your counter-evidence. Report every test you add for a finding in regression under that finding's exact where and its kind. ` +
    `A defect's test fails before your fix and passes after it; a defect with a test draft needs one. A defect in test code (hygiene) needs no regression test: the diff is its proof. A test-gap finding means a behaviour has no test, the code is already right, and it always needs a test: it passes before and after, ` +
    `so name in mutation the production change, made and reverted, under which the test fails; a test that fails on the pre-fix code counts as such a mutation (failedBefore true). When a test-gap's cell pins no behaviour at all, you may remove it instead: report resolution removed-vacuous with the removal diff in diff. A docs finding needs no test. When the only finding is that the pull request conflicts with main, the merge is the whole fix. ` +
    `Otherwise one commit per finding. Push, patch the PR body only where it became false (REST PATCH with --input, never gh pr edit --body-file), run \`aco check ${pr}\` from the worktree. ` +
    `Return the new tip and files: git diff --name-only from mergedBase (from oldTip when mergeResolvedLaneConflict) to the new tip.`,
    { label: `fix-${spent.total}`, phase: 'Fix', schema: FIX, agentType: 'atelier:code-fixer', ...claudeRole(fixerRole(blocking, foldIn)) })
  if (!fixed) return { stop: openResult('failed', 'fix', { reason: `the fixer returned no result; inspect ${A.worktree} for commits past ${tip} and uncommitted work, then resume this run`, lastBlocking: blocking }) }
  if (![fixed.oldTip, fixed.mergedBase, fixed.tip].every(t => SHA.test(t || ''))) return { stop: openResult('failed', 'fix', { reason: 'the fixer returned a tip that is not a sha' }) }
  // What the fixer says it found already done is only reported to the head: an unaccepted fix folds nothing in.
  const unaccepted = (result) => ({ stop: (fixed.resolved || []).length ? { ...result, resolved: fixed.resolved } : result })
  if ((fixed.rescope || []).length) {
    const committed = adoptFixerTip(fixed)
    return unaccepted(awaitRescope('fix', fixed.rescope, committed ? ' The returned tip carries fix commits no reviewer has seen; resume with deltaFrom.' : '', { lastBlocking: blocking }))
  }
  if (fixed.blocked) return unaccepted(openResult('escalated', 'fix', { reason: fixed.blockedReason }))
  if ((fixed.disputed || []).length) return unaccepted(awaitHeadOnDispute(fixed, blocking))
  const rejection = fixRejection(fixed, blocking, foldIn)
  if (rejection) return unaccepted(openResult('failed', 'fix', rejection))
  const accepted = acceptFix(fixed, blocking, foldIn)
  if (accepted.stop) return unaccepted(accepted.stop)
  // A clean merge of main alone carries no lane change, so it cannot carry a fold-in either; an unchanged tip carries
  // them only when the fixer proved each already satisfied.
  if (accepted.range || everyFoldInSatisfied(fixed, blocking, foldIn)) {
    foldIn.forEach(f => folded.set(findingKey(f), { ...f, tip: fixed.tip, ...(satisfiedEvidence(fixed, f) && { evidence: satisfiedEvidence(fixed, f) }) }))
  }
  const bounced = await pushAndCheckScope(`scope-${spent.total}`, budgetKey)
  if (bounced?.stop) return unaccepted(bounced.stop)
  if (!bounced?.range) return { ...accepted, foldIn }
  return {
    range: accepted.range ? `${accepted.range}\nA second fixer then answered the claim-scope check; this delta follows:\n${bounced.range}` : bounced.range,
    gateAgain: accepted.gateAgain || bounced.gateAgain, touchesProduction: accepted.touchesProduction || bounced.touchesProduction, foldIn,
  }
}

// The script, not the builder or fixer, makes sure the remote branch carries the lane tip, before the claim-scope check
// and every review. Never a force push: a rejected push stops the lane.
// aco decides what the claim covers; the lane only asks.
async function pushAndCheckScope(label, budgetKey) {
  phase('Scope')
  const pushLine = `cd '${A.worktree}' && git push origin '${A.branch}' && git rev-parse 'origin/${A.branch}'`
  const scopeLine = `cd '${A.worktree}' && aco brief ${A.item} --json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["outside_claim"]))'`
  const checked = await safeAgent(
    `${laneFacts}\nChange nothing in the files. Run these two command lines in this order, each exactly as written, without changing it or its directory. ` +
    `The first pushes the lane branch: return its last printed line unchanged as remote_tip; when it fails, return its error output as command_error, leave remote_tip and outside_claim out, and skip the second command line. ` +
    `Otherwise return the one line the second prints unchanged as outside_claim; when it prints nothing or fails, return its error output as command_error and leave outside_claim out:\n${pushLine}\n${scopeLine}`,
    { label, phase: 'Scope', schema: PUSH_AND_SCOPE_CHECK, ...MECHANICAL })
  if (!checked) return { stop: openResult('failed', 'scope', { reason: 'the push and claim-scope check returned no result' }) }
  if (!sameCommit((checked.remote_tip || '').trim(), tip)) {
    const printed = [checked.remote_tip, checked.command_error].filter(Boolean).join(' ')
    return { stop: openResult('failed', 'push', { reason: `the remote branch ${A.branch} does not carry the lane tip ${tip}; the push printed: ${printed}` }) }
  }
  if (checked.command_error) return { stop: openResult('failed', 'scope', { reason: `aco brief ${A.item} --json failed or printed nothing: ${checked.command_error}` }) }
  if (checked.outside_claim === undefined) return { stop: openResult('failed', 'scope', { reason: `the push succeeded but the scope agent returned no outside_claim and no command_error for aco brief ${A.item} --json` }) }
  let paths
  try { paths = JSON.parse(checked.outside_claim) } catch { paths = undefined }
  if (paths === null) return { stop: openResult('failed', 'scope', { reason: 'the lane holds no live claim (outside_claim is null); a lane without a claim does not reach review' }) }
  if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) return { stop: openResult('failed', 'scope', { reason: `the claim-scope check returned text that is not aco's outside_claim (null or a list of paths): ${checked.outside_claim}` }) }
  if (!paths.length) return null
  const outside = { where: paths.join(', '), kind: 'defect', text: 'These paths are outside the claim scope; move the change back inside the claim scope or revert it.', rule: CLAIM_SCOPE_RULE, evidence: `aco brief ${A.item} --json lists them in outside_claim` }
  return fixBatch([outside], 'the claim-scope check', budgetKey)
}

// Review until clean. After every fix the delta goes back to whoever raised a finding, and the gate returns on a
// material lane when the fix touched production or resolved lane conflicts. REVISE is handled one way everywhere.
async function reviewUntilClean(which, range) {
  phase('Review')
  return settleReview(await reviewRound(which, range))
}

// Each round judges the previous fix, so rounds run one after another; the fix budgets bound the recursion.
async function settleReview(rr) {
  if (rr.verdict.state === 'revise') {
    const blocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
    const raised = rr.which.filter((r, i) => rr.results[i] && (rr.results[i].blocking || []).length > 0)
    const f = await fixBatch(blocking, 'the review', 'review')
    if (f.stop) return f.stop
    if (!f.range) return openResult('failed', 'review', { reason: 'a review finding was answered by a merge alone', lastBlocking: blocking })
    const next = f.gateAgain && !raised.includes(GATE) ? raised.concat([GATE]) : raised
    phase('Review')
    return settleReview(await reviewRound(next, f.range))
  }
  if (rr.verdict.state === 'failed') return openResult('failed', 'review', { reason: rr.verdict.reason })
  if (rr.verdict.state === 'architectural') return openResult('escalated', 'review', { reason: 'architectural verdict' })
  return null
}

// A builder's work, and the commits a resumed run inherits, are checked against the claim before the first review, like every fixer's.
const inheritedFromEarlierRun = !A.build
const firstScopeCheck = await pushAndCheckScope(inheritedFromEarlierRun ? 'scope-resume' : `scope-${spent.total}`, 'review')
if (firstScopeCheck?.stop) return firstScopeCheck.stop

// Re-entry after the head settled an awaiting-head result: review only the fix commits no reviewer has seen yet.
if (A.deltaFrom && !SHA.test(A.deltaFrom)) return openResult('failed', 'input', { reason: 'deltaFrom is not a sha' })
const firstRange = A.deltaFrom
  ? `only this delta: git diff ${A.deltaFrom}..HEAD — fix commits made for earlier blocking findings that no reviewer has seen yet. They answer:\n${A.answers || '(see the commit messages in the range)'}`
  : 'the whole lane: git diff origin/main...HEAD'
// Re-entry at the fix: the head hands over blocking findings from an earlier run (for example the tester's), and
// in-place follow-ups to fold in. The delta the fixer makes is reviewed before the test and CI run again.
const carriedOver = A.fixFirst || []
if (carriedOver.length || A.foldIn?.length) {
  followups.push(...(A.foldIn || []))
  const f = await fixBatch(carriedOver, 'the head (carried over from the previous run)', 'test')
  if (f.stop) return f.stop
  // With deltaFrom, the head says a reviewer has not yet seen the commits since that sha: review all of them.
  const range = A.deltaFrom
    ? `only this delta: git diff ${A.deltaFrom}..HEAD — fixes no reviewer has seen yet. They answer:\n${A.answers || ''}\n${listFindings(carriedOver)}${foldInsInRange(f.foldIn)}`
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
    `Write only under ${A.scratch}/${TAG}-e2e-${n}/. Take /tmp/probe-stack.lock for any server or browser run so that no process you start inherits it: ` +
    `\`flock -o -w 1200 /tmp/probe-stack.lock <command>\`, or close fd 9 (\`9>&-\`) for every child. Run every server under \`timeout <cap>\` on a free port above 8790, ` +
    `write its pid to a file under ${A.scratch}/${TAG}-e2e-${n}/ and kill it before reporting; stop every other process you start (a container, a background browser) before reporting too; lsof in your report is evidence only, never a guard. Never touch another session's server. ` +
    `Right after you acquire the lock, read the 1-minute load average again; while it is above 1.5 × cores, release the lock and wait. ` +
    `If the lock stays held by someone else for those 1200 seconds, return verdict failed with lockBusy true instead of guessing. verdict is PASS with no blocking findings and FAIL with at least one. Return evidencePath.`
  return safeAgent(prompt, { label: `e2e-${n}`, phase: 'Test and CI', schema: E2E, agentType: 'atelier:explorative-tester', ...claudeRole('test') })
    .then(r => r || safeAgent(`Load the atelier:explorative-testing skill first.\n${prompt}`,
      { label: `e2e-${n}-fallback`, phase: 'Test and CI', schema: E2E, agentType: 'general-purpose', ...claudeRole('test') }))
}

function watchCi(n) {
  const inWorktree = A.repo ? '' : `cd '${A.worktree}' && `
  return safeAgent(
    `Report CI for pull request #${pr}${IN_REPO}; change nothing in the repository. Return the PR head sha as head (\`${inWorktree}gh pr view ${pr}${R} --json headRefOid --jq .headRefOid\`). ` +
    `If \`${inWorktree}gh pr view ${pr}${R} --json mergeable --jq .mergeable\` says CONFLICTING, return green false with one failing entry: where "mergeable", kind "defect", text "the pull request conflicts with main", ` +
    `rule "GitHub runs no CI on a conflicting pull request", evidence the mergeable value. Otherwise wait in the foreground — you cannot be woken later: run \`${inWorktree}timeout 540 gh pr checks ${pr}${R} --watch --interval 90\` (Bash timeout 600000 ms) and repeat it until it exits on its own rather than by the timeout, at most 7 times. If a check fails, ` +
    `rerun the failed jobs once (\`${inWorktree}gh run rerun <run-id>${R} --failed\`) and watch again, so a flaky check does not count. green is true only when at least one check ran on head ` +
    `and every check on head succeeded; no checks at all is one failing entry: where "checks", kind "defect", text "no CI checks ran on the head commit", rule "CI must run on head", evidence the gh pr checks output. For each check that still failed: where = its name, kind = "defect", text = what failed, ` +
    `rule = "CI check <name>". Take run-id and job-id from the check's link (\`${inWorktree}gh pr checks ${pr}${R} --json name,state,link\`; the link ends …/actions/runs/<run-id>/job/<job-id>). ` +
    `A check whose link is not an Actions job link has no job log: skip the log command and make one entry under its check name with its gh pr checks line and link as evidence. ` +
    `The evidence is the output that made the check red: run \`${inWorktree}gh run view <run-id>${R} --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200\` and quote what it prints, leaving out each line's \`<job>\\tUNKNOWN STEP\\t<timestamp>Z \` prefix. ` +
    `It reads that job's own log up to its first ##[error] line, because for a job of a called workflow \`--log-failed\` prints the whole log with every line unlabelled, so its tail is only cleanup. ` +
    `When those lines list findings as path:line plus a rule id (such as \`sonar tests/x.py:498 - python:S5778: text\`), return one failing entry per listed finding instead: where = path:line, kind = "defect", ` +
    `text = the finding's text, rule = its rule id, evidence = that line; a \`Fix:\` line belongs to the finding above it, and the list's header count (\`N open finding(s)\`) must equal your entries. A red check without such a list stays one entry under its check name with the quoted lines as evidence. ` +
    `If the last printed line is not an ##[error] line, the job did not fail in its own steps: make one entry under its check name with the check's state and link as evidence and say the log held no error line. ` +
    `A check whose log only reports that a job it needs failed (such as \`gate job "sonar" result failure\`) is derived: leave it out when another failing entry already covers that job. Never guess a cause such as flakiness; quote what the log shows.`,
    { label: `ci-${n}`, phase: 'Test and CI', schema: CI, ...WATCHER })
}

function testVerdict(e2e, testBlocking) {
  if (e2e.skipped) return 'SKIPPED'
  return testBlocking.length ? 'FAIL' : 'PASS'
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
  if (e2e?.verdict === 'failed' && e2e.lockBusy && !lockRetried) {
    lockRetried = true
    log('the shared probe lock was busy; trying the end-to-end test once more')
    continue
  }
  if (!e2e || e2e.verdict === 'failed') return openResult('failed', 'test', { reason: e2e?.lockBusy ? 'the shared probe lock stayed busy twice' : 'the tester returned no usable result' })
  if (!ci) return openResult('failed', 'ci')
  const testBlocking = e2e.blocking || []
  if (e2e.verdict === 'FAIL' && testBlocking.length === 0) return openResult('failed', 'test', { reason: 'a FAIL verdict came without any blocking finding' })
  // A blocking finding outranks a PASS label, as in the review classifier.
  if (!sameCommit(ci.head, tip)) return openResult('failed', 'ci', { reason: `the pull request head ${ci.head} is not the lane tip ${tip}` })
  history.push(
    { after: spent.total, by: `e2e-${n - 1}`, verdict: testVerdict(e2e, testBlocking), blocking: testBlocking.map(f => f.where), reportPath: e2e.evidencePath || '' },
    { after: spent.total, by: `ci-${n - 1}`, verdict: ci.green ? 'GREEN' : 'RED', blocking: (ci.failing || []).map(f => f.where) },
  )
  followups.push(...(e2e.followups || []).map(f => ({ ...f, tip })))
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

const stillOpen = openFollowups()
return {
  status: 'ready-to-land', pr, tip, spent, routing: ROUTING, history, followups: stillOpen, raisedBeforeTip: raisedBeforeTip(stillOpen), folded: [...folded.values()], disputed,
  requiredHeadActions: [
    `land with \`aco land ${pr}\` only while the pull request head is still ${tip}`,
    ...(raisedBeforeTip(stillOpen).length ? ['re-check the follow-ups in raisedBeforeTip against the returned tip before routing them'] : []),
    ...(stillOpen.length ? [`route ${stillOpen.length} follow-up(s) to their owning items before landing`] : []),
    `update the body of item #${A.item}'s parent and name what the landing freed`,
  ],
}
