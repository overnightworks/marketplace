export const meta = {
  name: 'lane',
  description: 'One claimed lane to ready-to-land: build, a fresh review (Sonnet at medium effort, Opus at high on material risk, plus a Codex gpt-6-astra gate on material risk), fresh fixers with evidence-bearing findings and a delta re-check by whoever raised them, then the explorative end-to-end test and CI in parallel on one tip.',
  whenToUse: 'In any repository that coordinates with aco, after the head ran `aco start <item>` (worktree, branch and claim exist). Landing stays with the head; the result lists requiredHeadActions. Required args: item (the GitHub issue number of the work item; the lane carries only issue items, an issue-less claim runs by hand), worktree (the lane\'s isolated worktree path), branch (the lane branch), contract (the item\'s ruled sentences every reviewer and the tester judge against), e2e (what the explorative tester drives through the real entry point), scratch (a directory for briefs, Codex output and test evidence). Start with build (a builder brief) for a new lane, or with pr and tip (an open pull request and its head sha) to continue one. Optional args and their defaults: risk "normal" (or "material": adds a Codex gpt-6-astra final gate); reviewer "claude" (a fresh Sonnet reviewer at medium effort, Opus at high on material risk; "codex" routes the review to Codex gpt-6-astra at medium effort, high on material risk); routing none (per-role overrides {role: {model, effort}} of the table at the top of the script, for build, fix, test, review, gate and mechanical; a fix batch whose blocking findings are all docs and that carries no fold-ins runs as mechanical; effort never above high, the gate always on another provider than the builder); repo none (every gh call then targets the worktree\'s own repository; pass owner/name when the head runs elsewhere); productionPaths ["src/", "pyproject.toml", "uv.lock"], a default that fits a src-layout Python repository (path prefixes whose change re-opens the gate on a material lane and re-runs the end-to-end test; passing it also lets a fresh reviewer stand in for a gate at its usage limit on a delta that touched none of them); ledgers [], a default that fits a repository without append-only ledgers (files whose merge conflicts keep both sides, main\'s lines first); generated {}, a map from a generated file\'s path to the command that regenerates it (a merge conflict confined to such files and ledgers is resolved by running the command on the merged tree, not escalated); budgets {review: 5, test: 2, ci: 3, total: 8} (fix rounds per phase and in total; partial objects override single keys); deltaFrom none (a sha: review only the commits since it, after the head settled an awaiting-head result; without it, a new run with pr and tip and fixFirst or foldIn reviews the whole lane, with the gate on a material lane); answers none (what those commits answer); fixFirst none (Finding[]: blocking findings a fresh fixer answers before anything else); foldIn none (Followup[]: follow-ups for that fixer, each handed over whatever its owner or wording; given alone it still starts the fixer).',
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
const missing = need.filter(k => !A[k]); if (missing.length) return { status: 'failed', stage: 'input', reason: `missing args: ${missing.join(', ')}` }
if (!/^[1-9]\d*$/.test(String(A.item))) return { status: 'failed', stage: 'input', reason: 'item must be a GitHub issue number: the lane carries only issue items, and an issue-less claim runs by hand' }
if (A.pr && !A.tip) return { status: 'failed', stage: 'input', reason: 'with pr, pass tip (the PR head sha) so the first delta range is right' }
if (A.build && (A.pr || A.tip)) return { status: 'failed', stage: 'input', reason: 'build starts a lane and pr + tip start a new run on an open pull request; pass one of them' }
if (!A.pr && !A.build) return { status: 'failed', stage: 'input', reason: 'pass build (a brief) or pr + tip' }
const isCommandMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([path, command]) => path.length > 0 && typeof command === 'string' && command.length > 0)
const isPathList = (value) => Array.isArray(value) && value.every(path => typeof path === 'string' && path.length > 0)
if (A.productionPaths !== undefined && !isPathList(A.productionPaths)) return { status: 'failed', stage: 'input', reason: 'productionPaths must be a list of path prefixes' }
if (A.ledgers !== undefined && !isPathList(A.ledgers)) return { status: 'failed', stage: 'input', reason: 'ledgers must be a list of file paths' }
if (A.generated !== undefined && !isCommandMap(A.generated)) return { status: 'failed', stage: 'input', reason: 'generated must map file paths to regenerate commands' }
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
const GENERATED = Object.entries(A.generated || {})
// The one table of every role's model and effort (instructions/HEAD.md, "Model routing"). Effort is medium unless the
// row says otherwise; high is the ceiling. Nothing else in this script names a model.
const MODEL_PROVIDER = { haiku: 'claude', sonnet: 'claude', opus: 'claude', fable: 'claude', 'gpt-6-astra': 'codex' }
const EFFORT_CEILING = new Set(['low', 'medium', 'high'])
const REVIEWER_PROVIDER = A.reviewer || 'claude'
function defaultReviewRouting() {
  if (REVIEWER_PROVIDER === 'codex') return { model: 'gpt-6-astra', effort: MATERIAL ? 'high' : 'medium' }
  if (MATERIAL) return { model: 'opus', effort: 'high' }
  return { model: 'sonnet', effort: 'medium' }
}
const DEFAULT_ROUTING = {
  mechanical: { model: 'haiku', effort: 'low' },
  build: { model: 'sonnet', effort: 'medium' },
  fix: { model: 'sonnet', effort: 'medium' },
  test: { model: 'sonnet', effort: 'medium' },
  review: defaultReviewRouting(),
  gate: { model: 'gpt-6-astra', effort: 'high' },
}
// The provider each role must run on: reviews on the chosen reviewer provider, the gate on any provider but the builder's.
const providerAllowed = {
  mechanical: (provider) => provider === 'claude',
  build: (provider) => provider === 'claude',
  fix: (provider) => provider === 'claude',
  test: (provider) => provider === 'claude',
  review: (provider) => provider === REVIEWER_PROVIDER,
  gate: (provider) => provider !== 'claude',
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

// agent() with a schema THROWS when a subagent ends without a result: every call goes
// through this wrapper, so such an end is a null the lane reports. Every prompt opens with the delegated line, as do the children's.
const DELEGATED_LINE = 'This is a delegated step started by a head, not a main session: skip the session-start routine and do only this brief.'
async function safeAgent(prompt, opts) {
  try {
    return await agent(`${DELEGATED_LINE}\n${prompt}`, opts)
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
// A child's refusal or crash is a problem naming the child, which its caller stops on at the stage of its own step.
async function startChild(name, childArgs) {
  try {
    const answer = await workflow(`atelier:${name}`, childArgs)
    return answer?.refused ? { problem: `was refused by ${name}: ${answer.refused}` } : answer
  } catch (error) {
    return { problem: `ended in ${name} with ${String(error).slice(0, 300)}` }
  }
}
// A value a command prints reaches a decision only through the line the lane-relay child reads back and checks.
const LANE_RELAY_PROTOCOL = 7
const SYNC_ANSWER = { properties: { note: { type: 'string', description: 'what stopped the merge: the conflicting paths, or the failed command and its output' } } }
const relay = (request) => startChild('lane-relay', { protocol: LANE_RELAY_PROTOCOL, delegatedLine: DELEGATED_LINE, worktree: A.worktree, agentOptions: MECHANICAL, mechanical: MECHANICAL, ...request })
// The failure reasons name the printed line only when the command printed one.
const printedLine = (relayed) => relayed.printed === undefined ? '' : `; the printed line: ${relayed.printed}`
// Language models copy a 40-character hash unreliably (a sync step once dropped one character). A commit is
// accepted as 7 to 40 hex characters — git resolves an unambiguous prefix, and fixers often answer with the short form.
const SHA = /^[0-9a-f]{7,40}$/
// Two spellings name the same commit when the shorter is a prefix of the longer (git's own abbreviation rule).
const sameCommit = (a, b) => SHA.test(a || '') && SHA.test(b || '') && (a.startsWith(b) || b.startsWith(a))
// Whether the relayed HEAD is a merge whose first parent is base, and whether the relayed git commands failed.
function mergedOnto(values, base) {
  const [firstParent, mergedIn] = values.parents.out.split('\n')
  return Boolean(mergedIn) && sameCommit(firstParent, base)
}
const failedCommand = (values) => values.head.code !== 0 || ![0, 1].includes(values.main.code)
const FIX = {
  type: 'object',
  required: ['mergeResolvedLaneConflict', 'files', 'disputed', 'blocked'],
  properties: {
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
    outside: { type: 'array', description: 'blocking findings you answered by editing the pull request body or posting an item comment, with no commit: the number in the blocking list and the body section or comment URL', items: { type: 'object', required: ['finding', 'where'], properties: { finding: { type: 'integer', minimum: 1 }, where: { type: 'string' } } } },
    regression: {
      type: 'array',
      description: "every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, under that finding's number in the blocking list you were given",
      items: { type: 'object', required: ['finding', 'test', 'failedBefore', 'passesAfter'], properties: { finding: { type: 'integer', minimum: 1, description: 'the number of the blocking finding in the list you were given' }, resolution: { type: 'string', enum: ['removed-vacuous'], description: 'for a test-gap finding whose test pins no behaviour: the fix removed that test instead of adding one' }, diff: { type: 'string', description: 'for removed-vacuous: the removal diff' }, test: { type: 'string' }, failedBefore: { type: 'boolean' }, passesAfter: { type: 'boolean' }, mutation: { type: 'string', description: 'for a test-gap finding: the production change, made and reverted, under which the test fails' } } },
    },
    summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' }, rescope: RESCOPE,
  },
}

// ------------------------------------------------------ shared sentences
const generatedCommands = GENERATED.map(([path, command]) => `${path}: ${command}`).join('; ')
const laneFacts =
  `Work item #${A.item}${IN_REPO}. Worktree ${A.worktree}, branch ${A.branch}; run every command from inside that worktree (cd there first). The head holds the claim: never claim, release, rescope, merge a pull request or land. ` +
  `Never use git stash and never touch the main checkout. Read the item body first (gh issue view ${A.item}${R} --json body --jq .body), and where the worktree tracks \`.aco/brief.toml\`, run ` +
  `\`aco brief ${A.item} --step <step>\` for the repository's RULES and CHECKS; elsewhere its AGENTS.md and README name them. Local runs stay targeted under PYTEST_XDIST_AUTO_NUM_WORKERS=4; ` +
  `read the 1-minute load average before any test run and wait while it is above 1.5 × cores. CI is the gate. ` +
  (LEDGERS.length ? `When you merge origin/main, a conflict in the append-only ledgers (${LEDGERS.join(' and ')}) keeps both sides, main's lines first. ` : '') +
  (GENERATED.length ? `A conflict in a generated file is not resolved by hand: take either side, resolve the other conflicts, then run its command from the worktree on the merged tree, \`git add\` its path, and commit the merge once. Generated files and commands: ${generatedCommands}. ` : '') +
  `You are one step of a workflow the head session runs: a message from the operator that reaches you and is not about this step is addressed to the head — ` +
  `finish this step, and quote the message in your report so the head sees it.`

// For the agents that may run a drive (the builder and the fixer); the tester already writes under its own scratch directory.
const rescopeFacts =
  `When the work needs a path outside the claim scope, edit nothing there: finish what lies inside, and list the path, the change it needs and the reason in rescope. A file that \`aco brief\` lists as lane-shared counts as inside the scope and needs no rescope: \`aco brief <item>\` prints it on its \`lane-shared:\` line, which you read before you call a path outside the scope (a stale \`quality/baseline.toml\` entry is lowered in place). The head then runs aco rescope and resumes.`

// For the builder and the fixer: the deterministic checks CI repeats run before the push, not after it.
const localCheckFacts =
  `After your last merge of origin/main and before you push, run the static checks those RULES and CHECKS or your brief name and, where quality/config.toml exists, \`quality hygiene .\` at the release the gate pins; fix what they report.`

const driveFacts = `Any drive you run keeps its pidfiles and evidence under ${A.scratch}.`

const BLOCKING_LINE =
  `A finding is **blocking** when the change introduces a defect against the item's contract, a repository specification, ` +
  `a repository rule, data safety, security, secrets, a public contract, or a failing check, except a gap outside the listed cases of a component whose spec declares it a tripwire by operator ruling, which is follow-up for its owning item. Everything else is a **follow-up**: polish, ` +
  `behaviour that already exists on origin/main unchanged (reproduce it there before calling it pre-existing), or work outside the lane's scope — ` +
  `each follow-up names its owning item (#n) or "distributor". Every blocking finding names the rule it breaks and the evidence you observed; ` +
  `a finding you cannot back with evidence is not blocking. Every blocking finding names its kind: **defect** when the code breaks a rule or ` +
  `does not do what the contract, its docs or its own text promise — a mismatch between promise and code is defect unless the contract says the code is right, ` +
  `and then it is **docs**, as is any finding where only documentation or a comment is wrong; **test-gap** when the code already does what the contract says ` +
  `and a behaviour has no test that pins it. Hygiene in test code (a needless monkeypatch, a new test whose name does not state the behaviour it pins) is a **defect** whose proof is the diff, not a mutation.`

const findingKey = (f) => `${f.where}::${f.text}`
// A finding from a run that predates kinds (a resumed run) keeps the rule it was raised under.
const kindOf = (f) => f.kind || 'defect'
const listFindings = (list) => list.map((f, i) =>
  `${i + 1}. ${f.where} — ${f.text}\n   kind: ${kindOf(f)}\n   rule: ${f.rule}\n   evidence: ${f.evidence}` +
  (f.repro ? `\n   repro: ${f.repro}` : '') + (f.testDraft ? `\n   test draft: ${f.testDraft}` : '')).join('\n')

// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent
// agent); a fresh Claude reviewer is the default, Sonnet at medium effort and Opus at high on material risk. The
// final gate on a material lane must come from another provider than the Claude builder, so it runs on Codex
// through a courier. The lane-review child runs one round and classifies it.
const LANE_REVIEW_PROTOCOL = 2
const ROUND_STATES = new Set(['approve', 'revise', 'failed', 'architectural', 'limited'])

// ------------------------------------------------------------ state
const history = []
const followups = []
const disputed = []
let pr = A.pr || null
let tip = A.tip || null
const spent = { review: 0, test: 0, ci: 0, total: 0 }
const seen = new Map()  // finding key -> how often it came back after a fix
let productionSinceTest = false  // any fix since the last end-to-end test touched production
let productionSinceGate = false  // any fix since the last unlimited gate result touched production
let gateUnseen = null  // the range a stand-in reviewer re-checked for a gate at its usage limit: {seenTip, findings, limit}, and every result adds tip
const folded = new Map()  // follow-up key -> the follow-up, with the tip of the accepted fix that folded it in
const REVIEW = { key: 'review', provider: REVIEWER_PROVIDER, role: 'independent reviewer' }
const GATE = { key: 'gate', provider: MODEL_PROVIDER[ROUTING.gate.model], role: 'final gate (architecture, data safety, public contract)' }
const STANDIN = { key: 'standin', provider: 'claude', role: "stand-in reviewer (the final gate's provider is at its usage limit)" }
const ALL = MATERIAL ? [REVIEW, GATE] : [REVIEW]

function openFollowups() {
  const open = new Map()
  followups.forEach(f => { if (!folded.has(findingKey(f)) && !open.has(findingKey(f))) open.set(findingKey(f), f) })
  return [...open.values()]
}
const raisedBeforeTip = (open) => open.filter(f => f.tip && !sameCommit(f.tip, tip))
// A builder or fixer that needs a path outside the claim hands the head a rescope request; the scope stage stays the backstop.
const awaitRescope = (stage, rescope, reason = '', extra = {}, newRun = 'with pr and tip and fixFirst carrying the rescope entries as findings (an entry path becomes where, its change becomes text, its reason becomes evidence, rule the item sentence the change serves, kind defect), so a fixer makes the change') =>
  openResult('awaiting-head', stage, { reason: `the work needs paths outside the claim scope; run aco rescope for them and start a new run ${newRun}.${reason}`, rescope, ...extra })
const gateUnseenView = () => gateUnseen ? { gateUnseen: { ...gateUnseen, tip } } : {}
const openResult = (status, stage, extra) =>
  ({ status, stage, pr, tip, spent, routing: ROUTING, history, followups: openFollowups(), raisedBeforeTip: raisedBeforeTip(openFollowups()), folded: [...folded.values()], disputed, ...gateUnseenView(), ...extra })

// ---------------------------------------------------------------- build
if (A.build) {
  phase('Build')
  const built = await safeAgent(
    `${laneFacts} ${driveFacts} ${rescopeFacts} ${localCheckFacts}\nYou are the builder. ${A.build}\nCommit each goal as soon as its targeted tests pass — never hold more than one goal uncommitted, and if you run short of turns, commit what is green and report what is left instead of continuing. Merge origin/main into the lane before pushing (a merge commit). ` +
    `Open the pull request as the build RULES say, run \`aco check <pr>\`, and return pr, tip and summary.`,
    { label: 'build', phase: 'Build', schema: BUILD, agentType: 'atelier:code-worker', ...claudeRole('build') })
  if (!built) return openResult('failed', 'build', { reason: `the builder returned no result; inspect ${A.worktree} for uncommitted work, checkpoint it, and hand it to a fresh finisher` })
  if (!(built.rescope || []).length && built.blocked) return openResult('escalated', 'build', { reason: built.blockedReason })
  if (!SHA.test(built.tip || '')) return openResult('failed', 'build', { reason: `the builder returned a tip that is not a sha: ${String(built.tip).slice(0, 80)}` })
  pr = built.pr; tip = built.tip
  if ((built.rescope || []).length && !pr) return awaitRescope('build', built.rescope, ' No reviewer has seen the build.', {}, 'with build: the original brief plus your decision, since the worktree keeps the uncommitted edits')
  if ((built.rescope || []).length) return awaitRescope('build', built.rescope, ` The returned tip is the whole build and no reviewer has seen it; the new run takes no deltaFrom, so its first review covers the whole lane.`)
  log(`built PR #${pr} at ${tip}`)
} else {
  phase('Sync')
  const git = `git -C '${A.worktree}'`
  const andGeneratedFiles = GENERATED.length ? ' and the generated files' : ''
  const nonce = `sync-${tip}`
  const quotedNonce = `'${nonce}'`
  const synced = await relay({ label: 'sync', phase: 'Sync', step: 'sync', relayArgs: [quotedNonce], nonce, requiredKeys: ['head', 'parents', 'main'], answerSchema: SYNC_ANSWER, brief:
    `${laneFacts}\nBring the lane up to date with main and change nothing else. Run each command exactly as written, with its -C option. Run \`${git} fetch origin && ${git} merge-base --is-ancestor origin/main HEAD\`; when it exits 0, the lane already contains main: change nothing. ` +
    `Otherwise run \`${git} merge origin/main\`; when it merges cleanly, run \`${git} push\`. ` +
    (LEDGERS.length || GENERATED.length ? `Conflicts only in the append-only ledgers${andGeneratedFiles}: resolve them as the lane facts say, commit the merge, run \`${git} push\`. ` : '') +
    (GENERATED.length ? `When a generated file's command fails or leaves its path dirty or unmerged, run \`${git} merge --abort\` and put the command and its output in note. ` : '') +
    (LEDGERS.length || GENERATED.length ? `Any other conflict: ` : `Any conflict: `) +
    `run \`${git} merge --abort\`, confirm \`${git} status --porcelain\` is empty, push nothing, and put the conflicting paths in note. Last, whatever happened,`
  })
  if (!synced) return openResult('failed', 'sync')
  const { values, problem } = synced
  if (problem || failedCommand(values)) return openResult('failed', 'sync', { reason: `the sync's relay line ${problem || 'reports a failed git command'}${printedLine(synced)}` })
  if (values.main.code === 1) return openResult('escalated', 'sync', { reason: synced.note || `the lane tip ${values.head.out} does not contain origin/main, and the sync named no cause` })
  if (!sameCommit(values.head.out, tip) && !mergedOnto(values, tip)) history.push({ after: 0, by: 'sync', from: tip, tip: values.head.out })
  tip = values.head.out
}

// ------------------------------------------------------- review / fix
const gateRounds = []
function unfitRoundAnswer(answer, expectedResults) {
  if (answer?.problem) return `the review round ${answer.problem}`
  if (!Array.isArray(answer?.results) || answer.results.length !== expectedResults) return `lane-review answered without a valid result: ${JSON.stringify(answer ?? null).slice(0, 200)}`
  if (!ROUND_STATES.has(answer.verdict?.state)) return `lane-review answered with an unknown round state: ${JSON.stringify(answer.verdict ?? null).slice(0, 200)}`
  return null
}
// from is the tip where the round's delta starts (none for a whole-lane round); a limited round hands it back for the resume.
async function reviewRound(which, range, from) {
  const reviewers = which.map(r => ({ key: r.key, provider: r.provider, role: r.role, routing: r.provider === 'codex' ? ROUTING[r.key] : claudeRole('review') }))
  const answer = await startChild('lane-review', { protocol: LANE_REVIEW_PROTOCOL, item: A.item, pr, repo: A.repo, delegatedLine: DELEGATED_LINE, worktree: A.worktree, branch: A.branch, scratch: A.scratch, tag: TAG, label: `r${spent.total}`, range, contract: A.contract, blockingLine: BLOCKING_LINE, reviewers, findingKinds: FINDING_KINDS, finding: FINDING, followup: FOLLOWUP, mechanical: MECHANICAL })
  const unfit = unfitRoundAnswer(answer, which.length)
  if (unfit) return { which, results: [], verdict: { state: 'failed', reason: unfit } }
  const { results, verdict } = answer
  results.forEach((v, i) => {
    if (!v) return
    history.push({ after: spent.total, by: which[i].key, verdict: v.verdict, blocking: (v.blocking || []).map(f => f.where), reportPath: v.reportPath || '' })
    if (which[i] === GATE && !v.limit) {
      gateRounds.push({ after: spent.total, verdict: v.verdict, blocking: v.blocking || [], reportPath: v.reportPath || '', tip })
      productionSinceGate = false
    }
    followups.push(...(v.followups || []).map(f => ({ ...f, tip })))
  })
  return { which, results, verdict, range, from }
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
  return repeated.length ? openResult('unresolved', budgetKey, { reason: 'a finding came back unchanged after its fix', lastBlocking: repeated }) : null
}

// The contract lets a fixer resolve a small follow-up in a file the lane already changed, when it cannot change behaviour.
// A fold-in counts as folded only once the fix that carries it is accepted; until then it stays open.
// The head named the items it passes as foldIn, so the wording filter does not second-guess them.
const namedByHead = new Set((A.foldIn || []).map(findingKey))
const inPlaceFollowups = () => openFollowups().filter(f => namedByHead.has(findingKey(f)) || /fix in place/i.test(`${f.owner} ${f.text}`))
const listFoldIns = (foldIn) => foldIn.map(f => `- ${f.where} — ${f.text}`).join('\n')
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
  const committed = !fixed.unchanged
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
// whose list number it names; any other number (a fold-in's, say) is not checked.
const proves = (proof, index) => Number.isInteger(proof.finding) && proof.finding === index + 1
// The evidence the fixer gave for a fold-in it found already done, or undefined without any.
const satisfiedEvidence = (fixed, foldIn) => (fixed.resolved || []).find(r => r.where === foldIn.where && (r.evidence || '').trim())?.evidence
// An unchanged tip is a fix only when there are no blocking findings and every fold-in is proven already satisfied.
const everyFoldInSatisfied = (fixed, blocking, foldIn) => !blocking.length && foldIn.length > 0 && foldIn.every(f => satisfiedEvidence(fixed, f))
// An unchanged tip is a fix too when each blocking finding is answered in the pull request body or an item comment.
const answeredOutside = (fixed, blocking) => blocking.length > 0 && blocking.every((_, index) => (fixed.outside || []).some(o => o.finding === index + 1 && (o.where || '').trim()))
// Each proof paired with the blocking finding it names and what it still lacks. A finding another proof covers
// without a gap counts as proven, so a proof with a gap beside it is only supporting evidence.
function judgedProofs(fixed, blocking) {
  const judged = (fixed.regression || []).flatMap(proof => blocking.map((finding, index) => ({ proof, finding, index })).filter(({ index }) => proves(proof, index)).map(({ finding, index }) => ({ proof, finding, index, gap: proofGap(proof, finding) })))
  const provenIndexes = new Set(judged.filter(({ gap }) => !gap).map(({ index }) => index))
  return judged.map(entry => ({ ...entry, proven: provenIndexes.has(entry.index) }))
}
function fixRejection(fixed, blocking, foldIn, ciOnly) {
  const proofs = fixed.regression || []
  // A proof red after the fix is evidence against the fix, even beside a valid proof.
  const gaps = judgedProofs(fixed, blocking).filter(checked => checked.gap && (!checked.proven || !checked.proof.passesAfter))
  if (gaps.length) return { reason: [...new Set(gaps.map(checked => checked.gap))].join('; '), regression: gaps.map(checked => checked.proof), lastBlocking: gaps.map(checked => checked.finding) }
  const unproven = blocking.map((finding, index) => ({ finding, index })).filter(({ finding, index }) => needsProof(finding) && !proofs.some(r => proves(r, index)))
  const unprovenList = unproven.map(({ finding, index }) => (index + 1) + '. ' + finding.where).join(', ')
  if (unproven.length) return { reason: 'a test-gap finding or a defect with a test draft got no regression test: ' + unprovenList, lastBlocking: unproven.map(({ finding }) => finding) }
  // Satisfied fold-ins leave the lane at the held tip, or at a merge of main onto it: anything past that is unasked work.
  const foldInsOnly = everyFoldInSatisfied(fixed, blocking, foldIn)
  if (fixed.unchanged) return (foldInsOnly && fixed.containsMain) || answeredOutside(fixed, blocking) ? null : { reason: 'the fixer changed nothing', lastBlocking: blocking }
  const mergeWasTheFinding = ciOnly || (blocking.length === 1 && blocking[0].where === 'mergeable')
  if (fixed.mergeOnly && !mergeWasTheFinding && !foldInsOnly) return { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }
  return null
}

// A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
const worktreeRelative = (files) => files.map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))

// A removal answers a test-gap only if the reviewer agrees the removed test pinned nothing; a defect proof is judged by the defect bar.
// A proof with a gap beside a valid proof for its finding reaches the raiser as a note, so it can judge whether the proof misleads.
const removalNote = ({ proof, finding }) => `\nThe fixer answered ${finding.where} by removing a vacuous test instead of adding one; judge whether the removed test pinned no behaviour:\n${proof.diff}`
const supportingNote = ({ proof, finding, gap }) => `\nThe fixer also offered the test ${proof.test} for ${finding.where}, though it shows less than the bar: ${gap}; judge whether it misleads.`
const proofNotes = (fixed, blocking) => judgedProofs(fixed, blocking).map(entry => {
  if (entry.proof.resolution === 'removed-vacuous' && kindOf(entry.finding) === 'test-gap' && !entry.gap) return removalNote(entry)
  return entry.gap && entry.proven ? supportingNote(entry) : ''
}).join('')

// Takes the fixer's tip and names the delta the reviewers see next, or none when a clean merge of main was the whole fix.
function acceptFix(fixed, blocking, foldIn) {
  const relative = worktreeRelative(fixed.files || [])
  const outside = relative.filter(f => f.startsWith('/'))
  if (outside.length) return { stop: openResult('failed', 'fix', { reason: `the fixer reported paths outside the worktree: ${outside.join(', ')}` }) }
  const touchesProduction = fixed.mergeResolvedLaneConflict || relative.some(f => PRODUCTION.some(prefix => f.startsWith(prefix)))
  tip = fixed.tip
  if (touchesProduction) productionSinceTest = productionSinceGate = true
  const outsideRange = fixed.unchanged && answeredOutside(fixed, blocking)
  if ((fixed.unchanged && !outsideRange) || (fixed.mergeOnly && !fixed.mergeResolvedLaneConflict)) {  // nothing of the lane changed to review: a clean merge of main answered the mergeable finding
    log(`fix ${spent.total}: no lane change to review`)
    return { range: null, proofNotes: '', gateAgain: false, touchesProduction: false }
  }
  const edited = outsideRange ? fixed.outside.map(o => 'finding ' + o.finding + ': ' + o.where).join('; ') : ''
  let delta = `only this delta, the fixer's own commits: git log -p --first-parent --remerge-diff ${fixed.heldTip}..${fixed.tip} (main's clean changes are not shown; a lane edit inside a merge of main is)`
  if (outsideRange) delta = `no commit changed: read live what the fixer edited outside the tree (${edited}), the pull request body with gh pr view ${pr}${R} --json body and an item comment with gh issue view ${A.item}${R} --comments`
  else if (fixed.mergeResolvedLaneConflict) delta = `only this delta: git diff ${fixed.heldTip}..${fixed.tip} (it includes a merge of main whose conflicts in this lane's files were resolved by hand)`
  const notes = proofNotes(fixed, blocking)
  const range = `${delta}. It answers these findings:\n${listFindings(blocking)}${notes}${foldInsInRange(foldIn)}`
  log(`fix ${spent.total}: ${fixed.heldTip.slice(0, 7)}..${tip.slice(0, 7)}`)
  return { range, proofNotes: notes, gateAgain: MATERIAL && touchesProduction, touchesProduction }
}

// Only a docs finding is provably behaviour-neutral; whether a defect changes behaviour needs judgement.
const fixerRole = (blocking, foldIn) => blocking.length > 0 && blocking.every(f => f.kind === 'docs') && !foldIn.length ? 'mechanical' : 'fix'

// A carried batch starts from the head's deltaFrom; any other batch from the tip before its fixer ran.
function scopeOrigin(carried, tipBeforeFix) {
  if (carried) return { deltaFrom: A.deltaFrom, note: 'The batch was carried over from an earlier run, so the paths may come from earlier commits rather than its fixer; the git log shows which.' }
  return { deltaFrom: tipBeforeFix, note: 'The tip carries fix commits no reviewer has seen.' }
}

async function fixBatch(blocking, source, budgetKey, carried = false) {
  const tipBeforeFix = tip
  const stop = fixRoundStop(blocking, budgetKey)
  if (stop) return { stop }
  spent[budgetKey]++; spent.total++
  const foldIn = inPlaceFollowups()
  const fixerTask = blocking.length
    ? `Then answer exactly these blocking findings from ${source}, and nothing else:\n${listFindings(blocking)}`
    : 'There are no blocking findings; your whole task is the follow-ups below:'
  phase('Fix')
  const git = `git -C '${A.worktree}'`
  const nonce = `fix-${spent.total}-${tipBeforeFix}`
  const answered = await relay({ label: `fix-${spent.total}`, phase: 'Fix', step: 'sync', relayArgs: [`'${nonce}'`], nonce, requiredKeys: ['head', 'parents', 'main'], answerSchema: FIX, agentOptions: { agentType: 'atelier:code-fixer', ...claudeRole(fixerRole(blocking, foldIn)) }, brief:
    `${laneFacts} ${driveFacts} ${rescopeFacts} ${localCheckFacts}\nYou are a fresh fixer for PR #${pr} (lane tip ${tip}). Merge origin/main if it moved, before or after your fixes (a merge commit; ` +
    `resolve other conflicts only when you can do so without changing behaviour, and set mergeResolvedLaneConflict true when files this lane changed needed resolution). If the worktree already carries commits or uncommitted changes past that tip from an earlier fixer that ran out of turns, judge them, keep what is right, and continue from there. Commit each finding as soon as it is green; if you run short of turns, commit what is green and return what is left in blockedReason with blocked true. ${fixerTask}${foldInBrief(foldIn)}\n\n` +
    `Each finding names the rule it breaks and its evidence. A scanner finding whose message covers the whole file (for example "in this file") is fixed at every occurrence in that file, not only at the reported line. Check the evidence yourself first. If it does not hold — the rule is not broken, or the evidence is wrong — ` +
    `do not change code for it: list it in disputed with your counter-evidence. Report every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, in regression under that finding's number in the list above; the number counts only for the blocking list, a follow-up needs no regression entry. Run the mutation you name, do not reason about it. ` +
    `A defect's test fails before your fix and passes after it; a defect with a test draft needs one. A defect in test code (hygiene) needs no regression test: the diff is its proof. A test-gap finding means a behaviour has no test, the code is already right, and it always needs a test: it passes before and after, ` +
    `so name in mutation the production change, made and reverted, under which the test fails; a test that fails on the pre-fix code counts as such a mutation (failedBefore true). When a test-gap's cell pins no behaviour at all, you may remove it instead: report resolution removed-vacuous with the removal diff in diff. A docs finding needs no test. When the only finding is that the pull request conflicts with main, the merge is the whole fix. ` +
    `Otherwise one commit per finding. Push, patch the PR body where it became false or where a finding is about it (REST PATCH with --input, never gh pr edit --body-file); a finding the body or an item comment answers goes in outside, and commit nothing for it; run \`aco check ${pr}\` from the worktree. ` +
    `Return files: the output of \`${git} log --name-only --format= --first-parent --remerge-diff ${tipBeforeFix}..HEAD\` (of \`${git} diff --name-only ${tipBeforeFix}..HEAD\` when mergeResolvedLaneConflict is true). Last, whatever happened,` })
  if (!answered) return { stop: openResult('failed', 'fix', { reason: `the fixer returned no result; inspect ${A.worktree} for commits past ${tip} and uncommitted work, then start a new run with pr and tip (and fixFirst for what is left)`, lastBlocking: blocking }) }
  // What the fixer says it found already done is only reported to the head: an unaccepted fix folds nothing in.
  const unaccepted = (result) => ({ stop: (answered.resolved || []).length ? { ...result, resolved: answered.resolved } : result })
  // A blocked fixer may have run out of turns before the relay line, and the blocked answer reads no tip.
  if (!(answered.rescope || []).length && answered.blocked) return unaccepted(openResult('escalated', 'fix', { reason: answered.blockedReason }))
  if (answered.problem || failedCommand(answered.values)) return { stop: openResult('failed', 'fix', { reason: `the fixer's relay line ${answered.problem || 'reports a failed git command'}${printedLine(answered)}` }) }
  const { values } = answered
  const fixed = { ...answered, tip: values.head.out, heldTip: tipBeforeFix, unchanged: sameCommit(values.head.out, tipBeforeFix), mergeOnly: mergedOnto(values, tipBeforeFix), containsMain: values.main.code === 0 }
  if ((fixed.rescope || []).length) {
    const committed = adoptFixerTip(fixed)
    return unaccepted(awaitRescope('fix', fixed.rescope, committed ? ' The returned tip carries fix commits no reviewer has seen; the new run takes deltaFrom.' : '', { lastBlocking: blocking }))
  }
  if ((fixed.disputed || []).length) return unaccepted(awaitHeadOnDispute(fixed, blocking))
  const rejection = fixRejection(fixed, blocking, foldIn, source === 'CI')
  if (rejection) return unaccepted(openResult('failed', 'fix', rejection))
  const accepted = acceptFix(fixed, blocking, foldIn)
  if (accepted.stop) return unaccepted(accepted.stop)
  const { deltaFrom, note } = scopeOrigin(carried, tipBeforeFix)
  const scopeStop = await pushAndCheckScope(`scope-${spent.total}`, { note, deltaFrom })
  if (scopeStop) return unaccepted(scopeStop.stop)
  // A clean merge of main alone carries no lane change, so it cannot carry a fold-in either; an unchanged tip carries
  // them only when the fixer proved each already satisfied. A scope stop folds nothing in.
  if (accepted.range || everyFoldInSatisfied(fixed, blocking, foldIn)) {
    foldIn.forEach(f => folded.set(findingKey(f), { ...f, tip: fixed.tip, ...(satisfiedEvidence(fixed, f) && { evidence: satisfiedEvidence(fixed, f) }) }))
  }
  return { ...accepted, foldIn, deltaFrom }
}

// The script, not the builder or fixer, makes sure the remote branch carries the lane tip, before the claim-scope check
// and every review. Never a force push: a rejected push stops the lane.
// aco decides what the claim covers; the lane only asks.
// A stray path is the head's choice, never a fixer's: a fixer can only revert it, and the change may be needed.
// origin says where the hit came from: a note, and the tip the new run reviews from, when the lane knows one.
function scopeStop(paths, origin, total) {
  const listed = paths.join(', ')
  const omitted = total > paths.length ? ` and ${total - paths.length} more` : ''
  const deltaClause = origin.deltaFrom ? ` and deltaFrom ${origin.deltaFrom}` : ''
  const newRun = `a new run with pr and tip${deltaClause}`
  history.push({ by: 'scope', outside: paths, tip })
  return { stop: openResult('awaiting-head', 'scope', { outside: paths, reason:
    `Outside the claim scope: ${listed}${omitted}. No fixer was launched. ${origin.note} Either run aco rescope for them and start ${newRun}, ` +
    `or start ${newRun} and fixFirst asking a fixer to revert them. Find the commits with git log origin/main..${tip} -- ${listed}.` }) }
}

async function pushAndCheckScope(label, origin) {
  phase('Scope')
  const nonce = `${label}-${tip}`
  const quotedArguments = [A.item, `'${A.branch}'`, `'${nonce}'`]
  const checked = await relay({ label, phase: 'Scope', step: 'scope', relayArgs: quotedArguments, nonce, requiredKeys: ['push', 'remote', 'head', 'parents', 'second_parent_in_main', 'brief'], brief: `${laneFacts}\nChange nothing in the files;` })
  if (!checked) return { stop: openResult('failed', 'scope', { reason: 'the push and claim-scope check returned no result' }) }
  const fail = (stage, reason) => ({ stop: openResult('failed', stage, { reason: `${reason}${printedLine(checked)}` }) })
  const { values, problem } = checked
  if (problem) return fail('scope', `the push and claim-scope check ${problem}`)
  const { push, remote, head, brief } = values
  // A fix batch may leave a clean merge of origin/main on top of the tip; the lane goes on from that merge, never from any other difference.
  const adoptedMerge = push.code === 0 && !sameCommit(remote.out, tip) && sameCommit(remote.out, head.out) && mergedOnto(values, tip) &&
    values.parents.out.split('\n').length === 2 && values.second_parent_in_main.code === 0
  if (push.code !== 0 || !(adoptedMerge || sameCommit(remote.out, tip))) {
    return fail('push', `the remote branch ${A.branch} does not carry the lane tip ${tip}: git push exited ${push.code} (${push.err}), origin/${A.branch} is ${remote.out}, HEAD is ${head.out}`)
  }
  if (adoptedMerge) {
    history.push({ by: 'scope', adoptedMerge: head.out, from: tip })
    tip = head.out
  }
  if (brief.code !== 0) return fail('scope', `aco brief ${A.item} --json exited ${brief.code}: ${brief.err}`)
  const paths = values.outside_claim
  if (paths === null) return fail('scope', 'the lane holds no live claim (outside_claim is null); a lane without a claim does not reach review')
  if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) return fail('scope', `aco's outside_claim is neither null nor a list of paths: ${JSON.stringify(paths)}`)
  if (!paths.length) return null
  return scopeStop(paths, origin, values.count)
}

// Review until clean. After every fix the delta goes back to whoever raised a finding, and the gate returns on a
// material lane when the fix touched production or resolved lane conflicts. REVISE is handled one way everywhere.
async function reviewUntilClean(which, range, from) {
  phase('Review')
  return settleReview(await reviewRound(which, range, from))
}

// A Codex reviewer out of usage waits for its reset; the resume repeats the limited round's range, so the review never moves to another provider.
function awaitLimit(rr) {
  const limits = rr.results.filter(v => v?.limit).map(v => v.limit)
  const lastBlocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
  const named = limits.filter(l => l.resetsAt).map(l => `${l.role} (${l.model}) at ${l.resetsAt}`)
  const reset = named.length ? `Codex named the reset time: ${named.join('; ')}.` : 'Codex named no reset time.'
  const resume = `After the reset start a new run with pr and tip${rr.from ? ', deltaFrom and answers as returned' : ''}${lastBlocking.length ? ' and fixFirst carrying lastBlocking' : ''}.`
  return openResult('awaiting-head', 'review', { limits, lastBlocking, ...(rr.from && { deltaFrom: rr.from, answers: rr.range }), reason: `a Codex reviewer hit its usage limit; the review never moves to another provider. ${reset} ${resume}` })
}

// A fresh Claude reviewer stands in for a gate at its usage limit only on a delta that touched no productionPaths prefix,
// and only when every other result of the round is clean; anything else waits for the gate.
function standInAllowed(rr) {
  const gateResult = rr.results[rr.which.indexOf(GATE)]
  const othersClean = rr.results.every(v => v === gateResult || (v && !v.limit && !(v.blocking || []).length))
  return MATERIAL && REVIEWER_PROVIDER === 'claude' && A.productionPaths !== undefined && gateRounds.at(-1)?.verdict === 'REVISE' && !productionSinceGate && Boolean(gateResult?.limit) && othersClean
}

async function standIn(rr) {
  const last = gateRounds.at(-1)
  gateUnseen ||= { seenTip: last.tip, findings: last.blocking, limit: rr.results[rr.which.indexOf(GATE)].limit }
  const range = `only this delta: git diff ${last.tip}..HEAD — commits the final gate has not seen. They answer the gate's findings:\n${listFindings(last.blocking)}` +
    (rr.range ? `\nThe limited round the gate would have re-checked was given this range, with the fixer's proof notes and fold-ins to judge:\n${rr.range}` : '')
  phase('Review')
  return settleReview(await reviewRound([STANDIN], range, last.tip))
}

const settleLimit = rr => standInAllowed(rr) ? standIn(rr) : awaitLimit(rr)

// Each round judges the previous fix, so rounds run one after another; the fix budgets bound the recursion.
async function settleReview(rr) {
  if (rr.verdict.state === 'limited') return settleLimit(rr)
  if (rr.verdict.state === 'revise') {
    const blocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
    const raised = rr.which.filter((r, i) => rr.results[i] && (rr.results[i].blocking || []).length > 0)
    const gateStreak = gateRounds.slice(-3)
    if (gateStreak.length === 3 && gateStreak.every(round => round.verdict === 'REVISE')) {
      return openResult('awaiting-head', 'review', { gateRevisions: gateStreak, lastBlocking: blocking, reason:
        'The final gate returned REVISE three times in a row; no fixer was started. Re-ask the pull question against gateRevisions first, ' +
        'then start a new run with pr and tip and fixFirst, or re-cut the item.' })
    }
    const f = await fixBatch(blocking, 'the review', 'review')
    if (f.stop) return f.stop
    if (!f.range) return openResult('failed', 'review', { reason: 'a review finding was answered by a merge alone', lastBlocking: blocking })
    const next = f.gateAgain && !raised.includes(GATE) ? raised.concat([GATE]) : raised
    phase('Review')
    return settleReview(await reviewRound(next, f.range, f.deltaFrom))
  }
  if (rr.verdict.state === 'failed') return openResult('failed', 'review', { reason: rr.verdict.reason })
  if (rr.verdict.state === 'architectural') return openResult('escalated', 'review', { reason: 'architectural verdict' })
  return null
}

// A builder's work, and the commits a resumed run inherits, are checked against the claim before the first review, like every fixer's.
// A carried batch is checked after it instead: that check is branch-wide, and a fixer must be able to revert what the head names.
const carriedOver = A.fixFirst || []
const carriesBatch = carriedOver.length || A.foldIn?.length
let firstScopeCheck = null
if (!carriesBatch && A.build) {
  firstScopeCheck = await pushAndCheckScope(`scope-${spent.total}`, { note: 'No reviewer has seen the build, so the new run reviews the whole lane.' })
} else if (!carriesBatch) {
  firstScopeCheck = await pushAndCheckScope('scope-resume', { note: 'The commits came from an earlier run.' })
}
if (firstScopeCheck?.stop) return firstScopeCheck.stop

// Re-entry after the head settled an awaiting-head result: review only the fix commits no reviewer has seen yet.
if (A.deltaFrom && !SHA.test(A.deltaFrom)) return openResult('failed', 'input', { reason: 'deltaFrom is not a sha' })
const firstRange = A.deltaFrom
  ? `only this delta: git diff ${A.deltaFrom}..HEAD — fix commits made for earlier blocking findings that no reviewer has seen yet. They answer:\n${A.answers || '(see the commit messages in the range)'}`
  : 'the whole lane: git diff origin/main...HEAD'
// Re-entry at the fix: the head hands over blocking findings from an earlier run (for example the tester's), and
// in-place follow-ups to fold in. The delta the fixer makes is reviewed before the test and CI run again.
if (carriesBatch) {
  followups.push(...(A.foldIn || []))
  const f = await fixBatch(carriedOver, 'the head (carried over from the previous run)', 'test', true)
  if (f.stop) return f.stop
  // Without deltaFrom the head has not said what reviewers saw, so the round covers the whole lane.
  const wholeLane = f.range
    ? `${firstRange}. It includes the fixer's commits for the head's carried-over findings, described next as a delta to look at closely; review the whole lane, not only that delta:\n${f.range}`
    : `${firstRange}${foldInsInRange(f.foldIn)}`
  const range = A.deltaFrom
    ? `only this delta: git diff ${A.deltaFrom}..HEAD — fixes no reviewer has seen yet. They answer:\n${A.answers || ''}\n${listFindings(carriedOver)}${f.proofNotes}${foldInsInRange(f.foldIn)}`
    : wholeLane
  const stop = await reviewUntilClean(ALL, range, f.deltaFrom)
  if (stop) return stop
} else {
  const first = await reviewUntilClean(ALL, firstRange, A.deltaFrom)
  if (first) return first
}

// ---------------------------- end-to-end test and CI, in parallel, on one tip
// The lane-test child returns the tester's answer, null when both agents ended without a result, or a problem the lane stops on.
const LANE_TEST_PROTOCOL = 1
function explore(n) {
  return startChild('lane-test', { protocol: LANE_TEST_PROTOCOL, delegatedLine: DELEGATED_LINE, n, pr, tip, worktree: A.worktree, scratch: A.scratch, tag: TAG, e2e: A.e2e, contract: A.contract, laneFacts, blockingLine: BLOCKING_LINE, finding: FINDING, followup: FOLLOWUP, routing: claudeRole('test') })
}

// A throw inside parallel() would reach the loop as a bare null, so the lane-ci child's failure returns as {problem}.
const LANE_CI_PROTOCOL = 4
// The printed listing, not the watcher's word, decides whether CI counts as green; null means the listing proves it.
function unprovenGreen({ checks, rules }) {
  if (checks.code !== 0 || !checks.list.length) return `no checks are listed for the pull request head (gh pr checks exited ${checks.code}: ${checks.err})`
  const bucketOf = new Map(checks.list.map(c => [c.name, c.bucket]))
  return [
    ...checks.list.filter(c => !['pass', 'skipping'].includes(c.bucket)).map(c => `check "${c.name}" is ${c.bucket}, not pass or skipping`),
    ...(rules.contexts || []).filter(name => bucketOf.get(name) !== 'pass').map(name => bucketOf.has(name) ? `required check "${name}" is ${bucketOf.get(name)}, not pass` : `required check "${name}" is missing from the listing`),
  ].join('; ') || null
}

async function watchCi(n) {
  const watched = await startChild('lane-ci', { protocol: LANE_CI_PROTOCOL, delegatedLine: DELEGATED_LINE, pr, n, repo: A.repo, worktree: A.worktree, finding: FINDING, watcher: WATCHER })
  if (!watched || watched.problem) return watched
  const nonce = `ci-${n}-${tip}`
  const read = await relay({ label: `ci-read-${n}`, phase: 'Test and CI', step: 'ci', relayArgs: [pr, `'${A.repo || ''}'`, `'${nonce}'`], nonce, requiredKeys: ['view'], brief: `${laneFacts}\nChange nothing in the files;` })
  if (!read) return { problem: 'ended without reading the CI values' }
  if (read.problem) return { problem: `read the CI values, but their relay line ${read.problem}${printedLine(read)}` }
  const { view, checks, rules, head, shared } = read.values
  if (view.code !== 0) return { problem: `could not read the pull request: gh pr view exited ${view.code}: ${view.err}` }
  return { ...watched, head, shared, rulesError: rules.code === 0 ? null : `gh api exited ${rules.code}: ${rules.err}`, unproven: watched.green ? unprovenGreen({ checks, rules }) : null }
}

function lockQueueCiState(ci) {
  if (!ci || ci.problem) return 'not readable'
  if (ci.green && !ci.unproven && !ci.rulesError) return 'green'
  const names = (ci.failing || []).map(f => `"${f.where}"`).join(', ')
  return names ? `red (${names})` : 'not green'
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
  if (e2e?.problem) return openResult('failed', 'test', { reason: `the tester ${e2e.problem}` })
  if (e2e && typeof e2e.verdict !== 'string') return openResult('failed', 'test', { reason: `lane-test answered without a verdict: ${JSON.stringify(e2e).slice(0, 200)}` })
  if (e2e?.verdict === 'failed' && e2e.lockBusy && !lockRetried) {
    lockRetried = true
    log('the probe lock or the load was busy; trying the end-to-end test once more')
    continue
  }
  if (e2e?.verdict === 'failed' && e2e.lockBusy) {
    return openResult('awaiting-head', 'test', { reason: `lock queue: the shared probe lock stayed busy or the load stayed above the limit for both tries, so the end-to-end test did not run; CI of this round: ${lockQueueCiState(ci)}. Start a new run with pr and tip once the queue clears.` })
  }
  if (!e2e || e2e.verdict === 'failed') return openResult('failed', 'test', { reason: 'the tester returned no usable result' })
  if (!ci || ci.problem) return openResult('failed', 'ci', ci ? { reason: `the CI watcher ${ci.problem}` } : undefined)
  const testBlocking = e2e.blocking || []
  if (e2e.verdict === 'PASS' && !e2e.skipped && !(e2e.cells || []).some(c => c.result === 'held')) return openResult('failed', 'test', { reason: 'a PASS without driven cells: the tester named no held cell' })
  if (e2e.verdict === 'FAIL' && testBlocking.length === 0) return openResult('failed', 'test', { reason: 'a FAIL verdict came without any blocking finding' })
  // A blocking finding outranks a PASS label, as in the classifier of lane-review.js.
  if (!sameCommit(ci.head, tip)) return openResult('failed', 'ci', { reason: `the pull request head ${ci.head} is not the lane tip ${tip}` })
  const { unproven } = ci
  history.push(
    { after: spent.total, by: `e2e-${n - 1}`, verdict: testVerdict(e2e, testBlocking), blocking: testBlocking.map(f => f.where), cells: e2e.cells || [], reportPath: e2e.evidencePath || '' },
    { after: spent.total, by: `ci-${n - 1}`, verdict: ci.green && !unproven && !ci.rulesError ? 'GREEN' : 'RED', blocking: (ci.failing || []).map(f => f.where) },
  )
  followups.push(...(e2e.followups || []).map(f => ({ ...f, tip })))
  if (ci.rulesError) return openResult('failed', 'ci', { reason: `the required checks of the base branch could not be read: ${ci.rulesError}` })
  if (unproven) return openResult('failed', 'ci', { reason: `CI reported green, but the check listing does not prove it: ${unproven}` })
  if (testBlocking.length === 0 && ci.green) break

  const { shared } = ci
  if (shared.length && testBlocking.length === 0) {
    const checkList = shared.map(name => `"${name}"`).join(', ')
    return openResult('awaiting-head', 'ci', { reason: `the CI check(s) ${checkList} are red on the base branch tip too: the red is shared with main and is fixed there, so no fixer was launched. If this lane's item is that repair, start a new run with pr and tip and fixFirst.` })
  }
  const ciBlocking = ci.green || shared.length ? [] : (ci.failing || [])
  const budgetKey = testBlocking.length ? 'test' : 'ci'
  const f = await fixBatch(testBlocking.concat(ciBlocking), testBlocking.length ? 'the end-to-end test and CI' : 'CI', budgetKey)
  if (f.stop) return f.stop
  if (f.range) {
    const stop = await reviewUntilClean(f.gateAgain ? ALL : [REVIEW], f.range, f.deltaFrom)
    if (stop) return stop
  }
  // The tester runs again when it had failed or when any fix since its last run (a review fix included) touched production.
  // A clean merge of main alone does not re-run it: the integrated tree is then proven by CI, not by the tester. CI always runs again.
  needTest = testBlocking.length > 0 || productionSinceTest
}

const stillOpen = openFollowups()
return {
  status: 'ready-to-land', pr, tip, spent, routing: ROUTING, history, followups: stillOpen, raisedBeforeTip: raisedBeforeTip(stillOpen), folded: [...folded.values()], disputed,
  ...gateUnseenView(),
  requiredHeadActions: [
    `land with \`aco land ${pr}\` only while the pull request head is still ${tip}`,
    ...(gateUnseen ? [`name ${gateUnseen.seenTip}..${tip} in the body of pull request #${pr}: the final gate, at its usage limit, did not see that range`] : []),
    ...(raisedBeforeTip(stillOpen).length ? ['re-check the follow-ups in raisedBeforeTip against the returned tip before routing them'] : []),
    ...(stillOpen.length ? [`route ${stillOpen.length} follow-up(s) to their owning items before landing`] : []),
    `update the body of item #${A.item}'s parent and name what the landing freed`,
  ],
}
