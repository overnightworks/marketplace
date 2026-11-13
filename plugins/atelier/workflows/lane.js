export const meta = {
  name: 'lane',
  description: 'One claimed lane to ready-to-land: build, a fresh review (Sonnet at high effort, Opus at medium on material risk, plus a Codex gpt-6-astra gate on material risk, or an Opus gate at high effort through routing.gate; a Claude reviewer that fails is started once more), fresh fixers with evidence-bearing findings and a delta re-check by whoever raised them, then the explorative end-to-end test and CI side by side, a red CI fixed at once while the tester runs on.',
  whenToUse: 'In any repository that coordinates with aco, after the head ran `aco start <item>` (worktree, branch and claim exist). Landing stays with the head; the result lists requiredHeadActions. Required args: item (the GitHub issue number of the work item; the lane carries only issue items, an issue-less claim runs by hand), worktree (the lane\'s isolated worktree path), branch (the lane branch), contract (the item\'s ruled sentences every reviewer and the tester judge against), e2e (what the explorative tester drives through the real entry point), scratch (a directory for briefs, Codex output and test evidence). Start with build (a builder brief) for a new lane, or with pr and tip (an open pull request and its head sha) to continue one. The builder and every fixer run the targeted tests of their change and the fast static checks the repository names after the last merge of the default branch; the quality gate and the end-to-end tests run in CI. Before anything starts the lane asks each of its children for its protocol and ends at stage input, naming the child, both numbers and `/reload-plugins`, when one differs, and a child that refuses for a protocol mismatch later in the run (atelier installed while the lane ran) ends the lane awaiting-head at that stage with /reload-plugins and the resume arguments (pr, tip) instead of failed; a Claude reviewer that fails is started once more and only a second failure ends the round, with both texts in the reason; a Codex courier that wrote a different brief than the script composed is started once more, and a second mismatch returns awaiting-head at stage review with the resume arguments of the usage limit (pr, tip, and on a delta round deltaFrom and answers) instead of failed; a courier that cuts its brief out of its own workflow transcript and finds none, twice, returns awaiting-head at stage review with requiredHeadActions (report the defect to marketplace, run the gate through routing.gate) and no resume; a fixer that answers its whole batch in the pull request body or an item comment and commits nothing is no failure. Optional args and their defaults: risk "normal" (or "material": adds a Codex gpt-6-astra final gate); reviewer "claude" (a fresh Sonnet reviewer at high effort, Opus at medium on material risk; "codex" routes the review to Codex gpt-6-astra at medium effort, high on material risk); routing none (per-role overrides {role: {model, effort}} of the table at the top of the script, for build, fix, rework, test, review, gate, mechanical and copy (the agent that reads a relay line again after an unreadable copy). Defaults on a normal lane: mechanical haiku/low, copy sonnet/low, build and fix sonnet/medium, test sonnet/medium, review sonnet/high; on a material lane: build and fix sonnet/high, test sonnet/high, review opus/medium, gate gpt-6-astra/high. The fixer runs as rework (sonnet/high) from the third fix round of a run on, counted over review, test and ci rounds together, and a continued run counts its rounds anew, so pass routing.fix for a lane already past its second round; a fix batch whose blocking findings are all docs and that carries no fold-ins runs as mechanical in every round. Effort is capped per model, opus at medium (except that stand-in gate) and every other model at high, and an override above its cap is refused; the gate on another provider than the builder, except the one Claude gate opus/high, which routing.gate may name while Codex is at its usage limit and which runs as a fresh Claude reviewer; any other Claude gate is refused at input); repo none (every gh call then targets the worktree\'s own repository; pass owner/name when the head runs elsewhere); productionPaths ["src/", "pyproject.toml", "uv.lock"], a default that fits a src-layout Python repository (path prefixes whose change re-opens the gate on a material lane and re-runs the end-to-end test; passing it also lets a fresh reviewer stand in for a gate at its usage limit on a delta that touched none of them); ledgers [], a default that fits a repository without append-only ledgers (files whose merge conflicts keep both sides, main\'s lines first); generated {}, a map from a generated file\'s path to the command that regenerates it (a merge conflict confined to such files and ledgers is resolved by running the command on the merged tree, not escalated); budgets {review: 5, test: 2, ci: 3, total: 8} (fix rounds per phase and in total; partial objects override single keys); deltaFrom none (a sha: review only the commits since it, after the head settled an awaiting-head result; without it, a new run with pr and tip and fixFirst or foldIn reviews the whole lane, with the gate on a material lane); answers none (what those commits answer); fixFirst none (Finding[]: blocking findings a fresh fixer answers before anything else); foldIn none (Followup[]: follow-ups for that fixer, each handed over whatever its owner or wording; given alone it still starts the fixer); experiment none (a tag of 1 to 40 lowercase letters, digits or hyphens; appended to the Routing line as Experiment: <tag>). The result carries routingLine, the one Routing line the head pastes as is.',
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
// The tag is a token of the routing line (aco's specs/lane-record.spec.md owns the grammar), so a malformed one fails here.
if (A.experiment !== undefined && !/^[a-z0-9-]{1,40}$/.test(A.experiment)) return { status: 'failed', stage: 'input', reason: 'experiment must be 1 to 40 lowercase letters, digits or hyphens' }
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
// Paths outside the claim do not stop the lane; the head adds them to the claim before landing.
// Only the newest scope check counts: a path a later fixer reverted is no longer outside.
let passedOutsidePaths = []
const GENERATED = Object.entries(A.generated || {})
// The one table of every role's model and effort (instructions/HEAD.md, "Model routing"), by the lane's risk; effort is capped per model (opus medium, others high).
const MODEL_PROVIDER = { haiku: 'claude', sonnet: 'claude', opus: 'claude', 'gpt-6-astra': 'codex' }
const EFFORTS = ['low', 'medium', 'high']
const EFFORT_CAP = { opus: 'medium' }
// The one Claude gate: opus at high stands in while Codex is at its usage limit (instructions/AGENTS.md, Reviews); it is the one effort above medium opus may have.
const isGateStandIn = (role, model, effort) => role === 'gate' && model === 'opus' && effort === 'high'
const REVIEWER_PROVIDER = A.reviewer || 'claude'
const HARD_ROW = { model: 'sonnet', effort: 'high' }
const WRITER = MATERIAL ? HARD_ROW : { model: 'sonnet', effort: 'medium' }
const CLAUDE_REVIEW = MATERIAL ? { model: 'opus', effort: 'medium' } : { model: 'sonnet', effort: 'high' }
const CODEX_REVIEW = { model: 'gpt-6-astra', effort: MATERIAL ? 'high' : 'medium' }
const DEFAULT_ROUTING = {
  mechanical: { model: 'haiku', effort: 'low' },
  copy: { model: 'sonnet', effort: 'low' },
  build: WRITER, fix: WRITER,
  rework: HARD_ROW,
  test: { model: 'sonnet', effort: MATERIAL ? 'high' : 'medium' },
  review: REVIEWER_PROVIDER === 'codex' ? CODEX_REVIEW : CLAUDE_REVIEW,
  gate: { model: 'gpt-6-astra', effort: 'high' },
}
// The provider each role must run on: reviews on the reviewer provider, the gate on any provider but the builder's or the Opus stand-in, every other role on Claude.
function providerAllowed(role, model, effort) {
  const provider = MODEL_PROVIDER[model]
  if (role === 'gate') return provider !== 'claude' || isGateStandIn(role, model, effort)
  return provider === (role === 'review' ? REVIEWER_PROVIDER : 'claude')
}

// Why one role's override is refused, or null.
function roleChoiceRefusal(role, choice) {
  if (!Object.hasOwn(DEFAULT_ROUTING, role)) return `routing names an unknown role "${role}"`
  if (typeof choice !== 'object' || choice === null) return `routing for ${role} must be {model, effort}`
  const knownModel = typeof choice.model === 'string' && Object.hasOwn(MODEL_PROVIDER, choice.model)
  if (choice.model !== undefined && !knownModel) return `routing for ${role} names an unknown model "${choice.model}"`
  if (choice.effort !== undefined && !EFFORTS.includes(choice.effort)) return `routing for ${role} sets effort "${choice.effort}"; the efforts are ${EFFORTS.join(', ')}`
  const model = choice.model || DEFAULT_ROUTING[role].model
  const effort = choice.effort || DEFAULT_ROUTING[role].effort
  if (EFFORTS.indexOf(effort) > EFFORTS.indexOf(EFFORT_CAP[model] || 'high') && !isGateStandIn(role, model, effort)) return `routing for ${role} sets ${model} to effort "${effort}"; ${model} is capped at ${EFFORT_CAP[model] || 'high'}`
  if (providerAllowed(role, model, effort)) return null
  return `routing for ${role} puts it on ${MODEL_PROVIDER[model]}, which breaks ${role === 'gate' ? 'gate provider separation from the builder; the one Claude gate is the stand-in opus at high effort' : 'the role\'s provider'}`
}

// Why a routing override is refused, or null. An override never bypasses reviewer independence, gate provider separation beyond the Opus stand-in, or the per-model effort caps.
function routingRefusal(overrides) {
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return 'routing must be an object of roles'
  return Object.entries(overrides).map(([role, choice]) => roleChoiceRefusal(role, choice)).find(Boolean) ?? null
}
const routingProblem = A.routing === undefined ? null : routingRefusal(A.routing)
if (routingProblem) return { status: 'failed', stage: 'input', reason: routingProblem }
const ROUTING = Object.fromEntries(Object.entries(DEFAULT_ROUTING).map(([role, chosen]) => [role, { ...chosen, ...A.routing?.[role] }]))
const MECHANICAL = { agentType: 'general-purpose', ...ROUTING.mechanical }
// The relay re-read copies a line of about 500 characters, which the mechanical tier garbles.
const COPY = { agentType: 'general-purpose', ...ROUTING.copy }
const claudeRole = (role) => ({ model: ROUTING[role].model, effort: ROUTING[role].effort })

// Every prompt opens with the delegated line, as do the children's.
const DELEGATED_LINE = 'This is a delegated step started by a head, not a main session: skip the session-start routine and do only this brief.'

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
// An entry of the wrong shape (a bare string, a missing field) would reach the fixer as "undefined" fields, so the input check names it first.
// A finding of a run that predates kinds lacks kind, which kindOf defaults.
const requiredFields = (schema) => schema.required.filter(field => field !== 'kind')
const missingFields = (entry, schema) => entry === null || typeof entry !== 'object' || Array.isArray(entry)
  ? 'is not an object'
  : `lacks ${requiredFields(schema).filter(field => typeof entry[field] !== 'string' || !entry[field].trim()).join(', ')}`
const badEntry = (name, entries, schema) => {
  if (entries === undefined) return null
  if (!Array.isArray(entries)) return `${name} must be a list`
  const index = entries.findIndex(entry => missingFields(entry, schema) !== 'lacks ')
  return index < 0 ? null : `${name}[${index}] ${missingFields(entries[index], schema)}: each entry needs ${requiredFields(schema).join(', ')} as non-empty strings`
}
const entryProblem = badEntry('fixFirst', A.fixFirst, FINDING) || badEntry('foldIn', A.foldIn, FOLLOWUP)
if (entryProblem) return { status: 'failed', stage: 'input', reason: entryProblem }
// A child's refusal or crash is a problem naming the child, which its caller stops on at the stage of its own step.
// An install between two stages can swap a child for a version of another protocol; the refusal that follows the passed start-of-run check
// is remembered, and openResult then returns awaiting-head instead of failed, until a later answer of the same child supersedes it.
let lateProtocolRefusal = null
const PROTOCOL_REFUSAL = /speaks protocol \S+, but the lane that started it speaks protocol/
function rememberLateRefusal(name, childArgs, answer) {
  if (childArgs.protocolQuery) return
  if (answer?.refused && PROTOCOL_REFUSAL.test(answer.refused)) lateProtocolRefusal = `${name}: ${answer.refused}`
  else if (lateProtocolRefusal?.startsWith(`${name}:`)) lateProtocolRefusal = null
}
async function startChild(name, childArgs) {
  try {
    const answer = await workflow(`atelier:${name}`, childArgs)
    rememberLateRefusal(name, childArgs, answer)
    return answer?.refused ? { problem: `was refused by ${name}: ${answer.refused}` } : answer
  } catch (error) {
    return { problem: `ended in ${name} with ${String(error).slice(0, 300)}` }
  }
}
// A value a command prints reaches a decision only through the line the lane-relay child reads back and checks.
const LANE_RELAY_PROTOCOL = 19
const relay = (request) => startChild('lane-relay', { protocol: LANE_RELAY_PROTOCOL, delegatedLine: DELEGATED_LINE, worktree: A.worktree, agentOptions: MECHANICAL, reread: COPY, ...request })
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
  `When the work needs a path outside the claim scope, edit it and list it with the reason in your summary: the head adds it to the claim with aco rescope before landing, and a review still judges whether the change belongs in the lane. A file that \`aco brief\` lists as lane-shared counts as inside the scope: \`aco brief <item>\` prints it on its \`lane-shared:\` line (a stale \`quality/baseline.toml\` entry is lowered in place). Never touch a value another lane holds exclusively.`

// For the builder and the fixer: the fast static checks run before the push; the quality gate and the end-to-end tests run in CI.
const localCheckFacts =
  `After your last merge of the default branch, run the targeted tests of your change and the fast static checks the repository names, and fix what they report; the quality gate and the end-to-end tests run in CI.`

// The turn budget of each agent definition's maxTurns (plugins/atelier/agents), which a test keeps equal; an agent cannot read its own definition.
const TURN_BUDGET = { build: 150, fix: 150 }
const turnFacts = (role) => `You have ${TURN_BUDGET[role]} turns; do not stop earlier on a guess of how many are left, stop where your agent definition says.`

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
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent agent); a fresh Claude reviewer is the
// default, Sonnet at high effort and Opus at medium on material risk. The final gate on a material lane runs on Codex through a courier, because the
// Claude builder needs another provider; routing.gate may name the Opus stand-in, which runs as a fresh Claude reviewer. The lane-review child runs one round and classifies it.
const LANE_REVIEW_PROTOCOL = 6
const ROUND_STATES = new Set(['approve', 'revise', 'failed', 'architectural', 'limited', 'brief-mismatch', 'no-brief-record'])

// ------------------------------------------------------------ state
const history = []
const followups = []
const disputed = []
let pr = A.pr || null
let tip = A.tip || null
const spent = { review: 0, test: 0, ci: 0, total: 0 }
const fixRolesRun = []  // the role of each fixer that ran, in order
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
const gateUnseenView = () => gateUnseen ? { gateUnseen: { ...gateUnseen, tip } } : {}
// The Routing line comes from lane-routing (aco's specs/lane-record.spec.md owns the grammar); the head pastes it as is.
async function routingLine() {
  const line = await startChild('lane-routing', { protocol: LANE_ROUTING_PROTOCOL, routing: ROUTING, history, fixRole: fixRolesRun.at(-1) ?? null, rounds: spent.total, experiment: A.experiment })
  if (lateProtocolRefusal?.startsWith('lane-routing:') && typeof line !== 'string') return null  // the caller turns the late refusal into awaiting-head
  // The lane's own result stays; the placeholder names why the line is missing.
  return typeof line === 'string' ? line : `Routing: not printed (${String(line?.problem ?? JSON.stringify(line)).replace(/\s+/g, ' ').slice(0, 200)})`
}
const lateProtocolStop = (extra) => {
  const deltaFrom = extra.deltaFrom ?? A.deltaFrom
  const answers = extra.answers ? ' and answers as returned' : ''
  const delta = deltaFrom ? ` and deltaFrom ${deltaFrom}${answers}` : ''
  const resume = pr
    ? `run /reload-plugins, then start a new run with pr ${pr} and tip ${tip}${delta} to continue on the installed version`
    : 'run /reload-plugins, then start a new run with the same build brief; the builder did not start'
  return {
    status: 'awaiting-head',
    reason: `a child refused after the start-of-run check because atelier was installed while this lane ran (${lateProtocolRefusal})`,
    requiredHeadActions: [resume],
  }
}
const openResult = async (status, stage, extra = {}) => {
  const line = await routingLine()
  const turnedAwaitingHead = (status === 'failed' || line === null) && lateProtocolRefusal && lateProtocolStop(extra)
  const open = openFollowups()
  return {
    status, stage, pr, tip, spent, routing: ROUTING, ...(line !== null && { routingLine: line }), history,
    followups: open, raisedBeforeTip: raisedBeforeTip(open), folded: [...folded.values()], disputed, ...gateUnseenView(), ...extra, ...turnedAwaitingHead,
  }
}

// ---------------------------------------------------------------- children
// Every child answers { protocolQuery: true } with its protocol before it checks anything else and starts no agent, so a session that
// resolved a child from another release (plugin snapshot or script read fresh, either one the older) ends the lane before any agent runs.
const LANE_BUILD_PROTOCOL = 6
const LANE_TEST_PROTOCOL = 3
const LANE_CI_PROTOCOL = 7
const LANE_ROUTING_PROTOCOL = 1
const CHILD_PROTOCOLS = { 'lane-build': LANE_BUILD_PROTOCOL, 'lane-relay': LANE_RELAY_PROTOCOL, 'lane-review': LANE_REVIEW_PROTOCOL, 'lane-test': LANE_TEST_PROTOCOL, 'lane-ci': LANE_CI_PROTOCOL, 'lane-routing': LANE_ROUTING_PROTOCOL }
// A child that predates the query refuses the call and names its protocol in the refusal.
const protocolMismatch = async ([name, expected]) => {
  const answer = await startChild(name, { protocolQuery: true })
  const installed = answer?.protocol ?? /speaks protocol (\d+)/.exec(answer?.problem ?? '')?.[1]
  if (Number(installed) === expected) return null
  const unknownReason = answer?.problem ?? JSON.stringify(answer ?? null).slice(0, 200)
  const spoken = installed ?? `unknown (${unknownReason})`
  return `${name} speaks protocol ${spoken}, this lane speaks protocol ${expected}`
}
const mismatches = (await Promise.all(Object.entries(CHILD_PROTOCOLS).map(protocolMismatch))).filter(Boolean)
if (mismatches.length) return { status: 'failed', stage: 'input', reason: `${mismatches.join('; ')}: the installed atelier differs from the running lane; run /reload-plugins and start a new run` }

// ---------------------------------------------------------------- build
if (A.build) {
  phase('Build')
  const built = await startChild('lane-build', { protocol: LANE_BUILD_PROTOCOL, delegatedLine: DELEGATED_LINE, laneFacts, driveFacts, rescopeFacts, localCheckFacts: `${localCheckFacts} ${turnFacts('build')}`, build: A.build, routing: claudeRole('build') })
  if (built?.problem) return await openResult('failed', 'build', { reason: `the builder step ${built.problem}` })
  if (!built) return await openResult('failed', 'build', { reason: `the builder returned no result; inspect ${A.worktree} for uncommitted work, checkpoint it, and hand it to a fresh finisher` })
  if (built.blocked) return await openResult('escalated', 'build', { reason: built.blockedReason })
  if (!SHA.test(built.tip || '')) return await openResult('failed', 'build', { reason: `the builder returned a tip that is not a sha: ${String(built.tip).slice(0, 80)}` })
  pr = built.pr; tip = built.tip
  log(`built PR #${pr} at ${tip}`)
} else {
  phase('Sync')
  const nonce = `sync-${tip}`
  const synced = await relay({ label: 'sync', phase: 'Sync', step: 'sync', relayArgs: [`'${nonce}'`], nonce, requiredKeys: ['head', 'parents', 'main'], answerKind: 'sync', facts: laneFacts, hasLedgers: LEDGERS.length > 0, hasGenerated: GENERATED.length > 0 })
  if (!synced) return await openResult('failed', 'sync')
  const { values, problem } = synced
  if (problem || failedCommand(values)) return await openResult('failed', 'sync', { reason: `the sync's relay line ${problem || 'reports a failed git command'}${printedLine(synced)}` })
  if (values.main.code === 1) return await openResult('escalated', 'sync', { reason: synced.note || `the lane tip ${values.head.out} does not contain origin/main, and the sync named no cause` })
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
  const reviewers = which.map(r => ({ key: r.key, provider: r.provider, role: r.role, isGate: r === GATE, routing: claudeRole(r === GATE ? 'gate' : 'review') }))
  const answer = await startChild('lane-review', { protocol: LANE_REVIEW_PROTOCOL, item: A.item, pr, repo: A.repo, after: spent.total, tip, delegatedLine: DELEGATED_LINE, worktree: A.worktree, branch: A.branch, scratch: A.scratch, tag: TAG, label: `r${spent.total}`, range, contract: A.contract, blockingLine: BLOCKING_LINE, reviewers, findingKinds: FINDING_KINDS, finding: FINDING, followup: FOLLOWUP, mechanical: MECHANICAL })
  const unfit = unfitRoundAnswer(answer, which.length)
  if (unfit) return { which, results: [], verdict: { state: 'failed', reason: unfit }, range, from }
  const { results, verdict } = answer
  history.push(...answer.history)
  followups.push(...answer.followups)
  if (answer.gateRounds.length) productionSinceGate = false
  gateRounds.push(...answer.gateRounds)
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
async function fixRoundStop(blocking, budgetKey) {
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
async function awaitHeadOnDispute(fixed, blocking) {
  disputed.push(...fixed.disputed)
  const committed = adoptFixerTip(fixed)
  return openResult('awaiting-head', 'fix', { reason: committed ? 'the fixer disputes findings with counter-evidence; the returned tip carries fix commits no reviewer has seen' : 'the fixer disputes every finding with counter-evidence and committed nothing', lastBlocking: blocking })
}

// A batch of CI findings only, every one disputed with counter-evidence and nothing committed, is a flake the lane re-runs once before the head sees it.
let flakeRerunUsed = false
function isFlakeDispute(fixed, blocking, source) {
  if (flakeRerunUsed || source !== 'CI' || !fixed.unchanged) return false
  return blocking.every(f => fixed.disputed.some(d => d.where === f.where && (d.counterEvidence || '').trim()))
}
const disputeFlakes = (fixed, blocking) => fixed.disputed.filter(d => blocking.some(f => f.where === d.where)).map(d => ({ where: d.where, text: `${d.text} (a flake; the fixer's counter-evidence: ${d.counterEvidence})`, owner: 'distributor' }))
// The evidence the fixer gave for a fold-in it found already done, or undefined without any.
const satisfiedEvidence = (fixed, foldIn) => (fixed.resolved || []).find(r => r.where === foldIn.where && (r.evidence || '').trim())?.evidence
// An unchanged tip is a fix only when there are no blocking findings and every fold-in is proven already satisfied.
const everyFoldInSatisfied = (fixed, blocking, foldIn) => !blocking.length && foldIn.length > 0 && foldIn.every(f => satisfiedEvidence(fixed, f))
// An unchanged tip is a fix too when every blocking finding is answered in the pull request body or an item comment and every fold-in
// is answered there or proven already satisfied; at least one answer outside the tree is what the re-check then reads.
const answeredOutside = (fixed, blocking, foldIn) => {
  const answers = (fixed.outside || []).filter(o => (o.where || '').trim())
  const blockingAnswered = blocking.every((_, index) => answers.some(o => o.finding === index + 1))
  const foldInAnswered = foldIn.every(f => answers.some(o => o.foldIn === f.where) || satisfiedEvidence(fixed, f))
  const anyAnswer = blocking.length > 0 || foldIn.some(f => answers.some(o => o.foldIn === f.where))
  return anyAnswer && blockingAnswered && foldInAnswered
}
// Why a fixer's answer does not count as a fix, or null when it does.
function fixRejection(fixed, blocking, foldIn, ciOnly) {
  const { findingNumbers, ...rejection } = fixed.proofRejection ?? {}
  if (findingNumbers) return { ...rejection, lastBlocking: findingNumbers.map(number => blocking[number - 1]) }
  // Satisfied fold-ins leave the lane at the held tip, or at a merge of main onto it: anything past that is unasked work.
  const foldInsOnly = everyFoldInSatisfied(fixed, blocking, foldIn)
  if (fixed.unchanged) return (foldInsOnly && fixed.containsMain) || answeredOutside(fixed, blocking, foldIn) ? null : { reason: 'the fixer changed nothing', lastBlocking: blocking }
  const mergeWasTheFinding = ciOnly || (blocking.length === 1 && blocking[0].where === 'mergeable')
  if (fixed.mergeOnly && !mergeWasTheFinding && !foldInsOnly) return { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }
  return null
}
// A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
const worktreeRelative = (files) => files.map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))

// Takes the fixer's tip and names the delta the reviewers see next, or none when a clean merge of main was the whole fix.
async function acceptFix(fixed, blocking, foldIn) {
  const relative = worktreeRelative(fixed.files || [])
  const outside = relative.filter(f => f.startsWith('/'))
  if (outside.length) return { stop: await openResult('failed', 'fix', { reason: `the fixer reported paths outside the worktree: ${outside.join(', ')}` }) }
  const touchesProduction = fixed.mergeResolvedLaneConflict || relative.some(f => PRODUCTION.some(prefix => f.startsWith(prefix)))
  tip = fixed.tip
  if (touchesProduction) productionSinceTest = productionSinceGate = true
  const outsideRange = fixed.unchanged && answeredOutside(fixed, blocking, foldIn)
  if ((fixed.unchanged && !outsideRange) || (fixed.mergeOnly && !fixed.mergeResolvedLaneConflict)) {  // nothing of the lane changed to review: a clean merge of main answered the mergeable finding
    log(`fix ${spent.total}: no lane change to review`)
    return { range: null, proofNotes: '', gateAgain: false, touchesProduction: false }
  }
  const edited = outsideRange ? fixed.outside.map(o => (o.foldIn ? 'fold-in ' + o.foldIn : 'finding ' + o.finding) + ': ' + o.where).join('; ') : ''
  let delta = `only this delta, the fixer's own commits: git log -p --first-parent --remerge-diff ${fixed.heldTip}..${fixed.tip} (main's clean changes are not shown; a lane edit inside a merge of main is)`
  if (outsideRange) delta = `no commit changed: read live what the fixer edited outside the tree (${edited}), the pull request body with gh pr view ${pr}${R} --json body and an item comment with gh issue view ${A.item}${R} --comments`
  else if (fixed.mergeResolvedLaneConflict) delta = `only this delta: git diff ${fixed.heldTip}..${fixed.tip} (it includes a merge of main whose conflicts in this lane's files were resolved by hand)`
  const range = `${delta}. It answers these findings:\n${listFindings(blocking)}${fixed.proofNotes}${foldInsInRange(foldIn)}`
  log(`fix ${spent.total}: ${fixed.heldTip.slice(0, 7)}..${tip.slice(0, 7)}`)
  return { range, proofNotes: fixed.proofNotes, gateAgain: MATERIAL && touchesProduction, touchesProduction }
}

// Only a docs finding is provably behaviour-neutral; the third fix round on is rework (fixRound counts the running round in spent.total before it asks).
function fixerRole(blocking, foldIn) {
  if (blocking.length > 0 && blocking.every(f => f.kind === 'docs') && !foldIn.length) return 'mechanical'
  return spent.total >= 3 ? 'rework' : 'fix'
}

// A carried batch starts from the head's deltaFrom; any other batch from the tip before its fixer ran.
function scopeOrigin(carried, tipBeforeFix) {
  if (carried) return { deltaFrom: A.deltaFrom, note: 'The batch was carried over from an earlier run, so the paths may come from earlier commits rather than its fixer; the git log shows which.' }
  return { deltaFrom: tipBeforeFix, note: 'The tip carries fix commits no reviewer has seen.' }
}

async function fixRound(blocking, source, budgetKey, carried) {
  const tipBeforeFix = tip
  const stop = await fixRoundStop(blocking, budgetKey)
  if (stop) return { stop }
  spent[budgetKey]++; spent.total++
  const foldIn = inPlaceFollowups()
  phase('Fix')
  const role = fixerRole(blocking, foldIn)
  fixRolesRun.push(role)
  const nonce = `fix-${spent.total}-${tipBeforeFix}`
  const answered = await relay({ label: `fix-${spent.total}`, phase: 'Fix', step: 'sync', relayArgs: [`'${nonce}'`], nonce, requiredKeys: ['head', 'parents', 'main'], answerKind: 'fix', agentOptions: { agentType: 'atelier:code-fixer', ...claudeRole(role) },
    facts: `${laneFacts} ${driveFacts} ${rescopeFacts} ${localCheckFacts} ${turnFacts('fix')}`, pr, tip, source, blocking: listFindings(blocking), findings: blocking.map(f => ({ ...f, kind: kindOf(f) })), foldIns: listFoldIns(foldIn) })
  if (!answered) return { stop: await openResult('failed', 'fix', { reason: `the fixer returned no result; inspect ${A.worktree} for commits past ${tip} and uncommitted work, then start a new run with pr and tip (and fixFirst for what is left)`, lastBlocking: blocking }) }
  // What the fixer says it found already done is only reported to the head: an unaccepted fix folds nothing in.
  const unaccepted = (result) => ({ stop: (answered.resolved || []).length ? { ...result, resolved: answered.resolved } : result })
  // A blocked fixer may have run out of turns before the relay line, and the blocked answer reads no tip.
  if (answered.blocked) return unaccepted(await openResult('escalated', 'fix', { reason: answered.blockedReason }))
  if (answered.problem || failedCommand(answered.values)) return { stop: await openResult('failed', 'fix', { reason: `the fixer's relay line ${answered.problem || 'reports a failed git command'}${printedLine(answered)}` }) }
  const { values } = answered
  const fixed = { ...answered, tip: values.head.out, heldTip: tipBeforeFix, unchanged: sameCommit(values.head.out, tipBeforeFix), mergeOnly: mergedOnto(values, tipBeforeFix), containsMain: values.main.code === 0 }
  if ((fixed.disputed || []).length) return isFlakeDispute(fixed, blocking, source) ? { flakes: disputeFlakes(fixed, blocking), fixed } : unaccepted(await awaitHeadOnDispute(fixed, blocking))
  const rejection = fixRejection(fixed, blocking, foldIn, source === 'CI')
  if (rejection) return unaccepted(await openResult('failed', 'fix', rejection))
  const accepted = await acceptFix(fixed, blocking, foldIn)
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
// Reached only when aco's outside list is truncated, so the lane cannot judge the unlisted paths: the head chooses between a rescope and a revert.
// origin says where the hit came from: a note, and the tip the new run reviews from, when the lane knows one.
async function scopeStop(paths, origin, total) {
  const listed = paths.join(', ')
  const omitted = total > paths.length ? ` and ${total - paths.length} more` : ''
  const newRun = ['a new run with pr and tip', origin.deltaFrom && ` and deltaFrom ${origin.deltaFrom}`].filter(Boolean).join('')
  history.push({ by: 'scope', outside: paths, tip })
  return { stop: await openResult('awaiting-head', 'scope', { outside: paths, reason:
    `Outside the claim scope: ${listed}${omitted}. No fixer was launched. ${origin.note} Either run aco rescope for them and start ${newRun}, ` +
    `or start ${newRun} and fixFirst asking a fixer to revert them. Find the commits with git log origin/main..${tip} -- ${listed}.` }) }
}

async function pushAndCheckScope(label, origin) {
  phase('Scope')
  const nonce = `${label}-${tip}`
  const quotedArguments = [A.item, `'${A.branch}'`, `'${nonce}'`]
  const checked = await relay({ label, phase: 'Scope', step: 'scope', relayArgs: quotedArguments, nonce, requiredKeys: ['push', 'remote', 'head', 'parents', 'second_parent_in_main', 'brief'], brief: `${laneFacts}\nChange nothing in the files;` })
  // Only a late refusal turns the stop into a resume, which needs the delta no reviewer has seen.
  const unseenDelta = lateProtocolRefusal && origin.deltaFrom && { deltaFrom: origin.deltaFrom }
  if (!checked) return { stop: await openResult('failed', 'scope', { reason: 'the push and claim-scope check returned no result', ...unseenDelta }) }
  const fail = async (stage, reason) => ({ stop: await openResult('failed', stage, { reason: `${reason}${printedLine(checked)}`, ...unseenDelta }) })
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
  passedOutsidePaths = []
  if (!paths.length) return null
  // The relay lists at most 50 paths; the unlisted ones cannot be judged.
  if (values.count === paths.length) {
    history.push({ by: 'scope', outside: paths, tip, passedOutside: true })
    passedOutsidePaths = [...new Set(paths)]
    return null
  }
  return scopeStop(paths, origin, values.count)
}

// Review until clean. After every fix the delta goes back to whoever raised a finding, and the gate returns on a
// material lane when the fix touched production or resolved lane conflicts. REVISE is handled one way everywhere.
async function reviewUntilClean(which, range, from) {
  phase('Review')
  return settleReview(await reviewRound(which, range, from))
}

// A round the head resumes (a Codex reviewer out of usage, a courier whose brief never matched) repeats its range, so the review never moves to another provider.
async function awaitHead(rr, reason, extra = {}) {
  const lastBlocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
  const resume = `start a new run with pr and tip${rr.from ? ', deltaFrom and answers as returned' : ''}${lastBlocking.length ? ' and fixFirst carrying lastBlocking' : ''}.`
  return openResult('awaiting-head', 'review', { ...extra, lastBlocking, ...(rr.from && { deltaFrom: rr.from, answers: rr.range }), reason: `${reason} ${resume}` })
}
async function awaitLimit(rr) {
  const limits = rr.results.filter(v => v?.limit).map(v => v.limit)
  const named = limits.filter(l => l.resetsAt).map(l => `${l.role} (${l.model}) at ${l.resetsAt}`).join('; ')
  const resetText = named ? `Codex named the reset time: ${named}.` : 'Codex named no reset time.'
  return awaitHead(rr, `a Codex reviewer hit its usage limit; the review never moves to another provider. ${resetText} After the reset`, { limits })
}

// A courier twice found no brief in its transcript: a defect of the plugin on this host that a resume would meet again, so none is offered.
const reportNoBriefRecord = rr => openResult('awaiting-head', 'review', {
  lastBlocking: rr.results.filter(Boolean).flatMap(v => v.blocking || []), reason: `a Codex courier found no brief in its own transcript, twice, and started no Codex: ${rr.verdict.reason}.`,
  requiredHeadActions: ['report the defect to the marketplace repository: the courier of lane-review cannot read its brief from the workflow agent transcript', 'until it is repaired, run the gate through routing.gate (the Opus stand-in)'],
})
const awaitBrief = rr => awaitHead(rr, `a Codex courier wrote a different brief than the script composed, twice, and started no Codex: ${rr.verdict.reason}. Then`)

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

const unseenDeltaOf = rr => rr.from ? { deltaFrom: rr.from, answers: rr.range } : {}

// Each round judges the previous fix, so rounds run one after another; the fix budgets bound the recursion.
async function settleReview(rr) {
  if (rr.verdict.state === 'limited') return settleLimit(rr)
  if (rr.verdict.state === 'brief-mismatch') return awaitBrief(rr)
  if (rr.verdict.state === 'no-brief-record') return reportNoBriefRecord(rr)
  if (rr.verdict.state === 'revise') {
    const blocking = rr.results.filter(Boolean).flatMap(v => v.blocking || [])
    const raised = rr.which.filter((r, i) => rr.results[i] && (rr.results[i].blocking || []).length > 0)
    const gateStreak = gateRounds.slice(-3)
    if (gateStreak.filter(round => round.verdict === 'REVISE').length === 3) {
      return openResult('awaiting-head', 'review', { gateRevisions: gateStreak, lastBlocking: blocking, reason:
        'The final gate returned REVISE three times in a row; no fixer was started. Re-ask the pull question against gateRevisions first, ' +
        'then start a new run with pr and tip and fixFirst, or re-cut the item.' })
    }
    const f = await fixRound(blocking, 'the review', 'review')
    if (f.stop) return f.stop
    if (!f.range) return openResult('failed', 'review', { reason: 'a review finding was answered by a merge alone', lastBlocking: blocking })
    const next = f.gateAgain && !raised.includes(GATE) ? raised.concat([GATE]) : raised
    phase('Review')
    return settleReview(await reviewRound(next, f.range, f.deltaFrom))
  }
  if (rr.verdict.state === 'failed') return openResult('failed', 'review', { reason: rr.verdict.reason, ...unseenDeltaOf(rr) })
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
if (A.deltaFrom && !SHA.test(A.deltaFrom)) return await openResult('failed', 'input', { reason: 'deltaFrom is not a sha' })
const firstRange = A.deltaFrom
  ? `only this delta: git diff ${A.deltaFrom}..HEAD — fix commits made for earlier blocking findings that no reviewer has seen yet. They answer:\n${A.answers || '(see the commit messages in the range)'}`
  : 'the whole lane: git diff origin/main...HEAD'
// Re-entry at the fix: the head hands over blocking findings from an earlier run (for example the tester's), and
// in-place follow-ups to fold in. The delta the fixer makes is reviewed before the test and CI run again.
if (carriesBatch) {
  followups.push(...(A.foldIn || []))
  const f = await fixRound(carriedOver, 'the head (carried over from the previous run)', 'test', true)
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

// ---------------------------- end-to-end test and CI side by side
// The lane-test child returns the tester's answer, null when both agents ended without a result, or a problem the lane stops on.
function explore(n) {
  return startChild('lane-test', { protocol: LANE_TEST_PROTOCOL, delegatedLine: DELEGATED_LINE, n, pr, tip, worktree: A.worktree, scratch: A.scratch, tag: TAG, e2e: A.e2e, contract: A.contract, laneFacts, blockingLine: BLOCKING_LINE, finding: FINDING, followup: FOLLOWUP, routing: claudeRole('test') })
}

async function watchCi(n, rerun) {
  const watched = await startChild('lane-ci', { protocol: LANE_CI_PROTOCOL, delegatedLine: DELEGATED_LINE, pr, n, rerun, repo: A.repo, worktree: A.worktree, finding: FINDING, mechanical: MECHANICAL })
  if (!watched || watched.problem) return watched
  const nonce = `ci-${n}-${tip}`
  const read = await relay({ label: `ci-read-${n}`, phase: 'Test and CI', step: 'ci', relayArgs: [pr, `'${A.repo || ''}'`, `'${nonce}'`], nonce, requiredKeys: ['view'], brief: `${laneFacts}\nChange nothing in the files;` })
  if (!read) return { problem: 'ended without reading the CI values' }
  if (read.problem) return { problem: `read the CI values, but their relay line ${read.problem}${printedLine(read)}` }
  const { view } = read.values
  if (view.code !== 0) return { problem: `could not read the pull request: gh pr view exited ${view.code}: ${view.err ?? ''}` }
  const failing = watched.green || watched.failing?.length ? watched.failing : failedCheckFindings(read.values.checks?.open)
  return { ...watched, failing, ...read.ci, unproven: watched.green ? read.ci.unproven : null }
}

// A watcher that answers red without quoting a log leaves the fixer nothing to act on; the printed listing still names the red checks.
function failedCheckFindings(openChecks = []) {
  return openChecks.filter(c => c.bucket === 'fail').map(c => ({
    where: c.name, kind: 'defect', rule: `CI check ${c.name}`,
    text: `The check "${c.name}" is red, and the CI watcher quoted no log for it.`,
    evidence: `The relay's ci line lists "${c.name}" in the fail bucket; read its log with gh run view.`,
  }))
}

function loadWaitCiState(ci) {
  if (!ci || ci.problem) return 'not readable'
  if (ci.green && !ci.unproven && !ci.rulesError) return 'green'
  const names = (ci.failing || []).map(f => `"${f.where}"`).join(', ')
  return names ? `red (${names})` : 'not green'
}

// A red CI starts the fixer at once; the tester's answer joins the next batch, and the round awaits the tester only when CI
// has nothing of its own to fix. The tester judges the tip it started on, which later fixes may move. One tester runs at a time.
let n = 0, testCalls = 0, needTest = true, lockRetried = false, testSettled = false
let pendingTest = null  // the tester started and not yet judged
let rerunRed  // the red jobs a flake dispute hands to the next watch for one re-run
let testBlocking = []  // the tester's findings, held until a fix batch takes them
function startTest() {
  needTest = productionSinceTest = testSettled = false
  pendingTest = explore(testCalls++).then(e2e => { testSettled = true; return e2e })
}
const takePendingTest = () => pendingTest.then(e2e => { pendingTest = null; return e2e })
// Judges the pending tester's answer; returns the result that stops the lane, or undefined. A lock-busy answer is retried once:
// awaited here when CI has nothing of its own to fix, else left pending while the fixer starts.
async function settleTest(ci, awaitRetry = true) {
  let e2e = await takePendingTest()
  if (e2e?.verdict === 'failed' && e2e.lockBusy && !lockRetried) {
    lockRetried = true
    log('the load stayed above the limit; trying the end-to-end test once more')
    startTest()
    if (!awaitRetry) return
    e2e = await takePendingTest()
  }
  if (e2e?.problem) return openResult('failed', 'test', { reason: `the tester ${e2e.problem}` })
  if (e2e && typeof e2e.verdict !== 'string') return openResult('failed', 'test', { reason: `lane-test answered without a verdict: ${JSON.stringify(e2e).slice(0, 200)}` })
  if (e2e?.verdict === 'failed' && e2e.lockBusy) {
    return openResult('awaiting-head', 'test', { reason: `load wait: the load stayed above the limit for both tries, so the end-to-end test did not run; CI of this round: ${loadWaitCiState(ci)}. Start a new run with pr and tip once the load falls.` })
  }
  if (!e2e || e2e.verdict === 'failed') return openResult('failed', 'test', { reason: 'the tester returned no usable result' })
  testBlocking = e2e.blocking || []
  if (e2e.emptyVerdictReason) return openResult('failed', 'test', { reason: e2e.emptyVerdictReason })
  history.push({ after: spent.total, ...e2e.historyEntry })
  followups.push(...e2e.followups)
  // A PASS on a tip a fix has since changed in production is stale: a new tester runs on the current tip.
  if (productionSinceTest) needTest = true
}
while (true) {
  phase('Test and CI')
  if (needTest && !pendingTest) startTest()
  const rerunBatch = rerunRed
  const ci = await watchCi(n, rerunBatch?.red)
  rerunRed = undefined
  n++
  if (!ci || ci.problem) {
    const stop = pendingTest && await settleTest(ci)
    return stop || await openResult('failed', 'ci', ci ? { reason: `the CI watcher ${ci.problem}` } : undefined)
  }
  if (!sameCommit(ci.head, tip)) return await openResult('failed', 'ci', { reason: `the pull request head ${ci.head} is not the lane tip ${tip}` })
  const { shared, unproven } = ci
  if (pendingTest && (testSettled || ci.green || shared.length || ci.operatorDoor)) {
    const stop = await settleTest(ci, ci.green || shared.length > 0 || Boolean(ci.operatorDoor))
    if (stop) return stop
  }
  history.push({ after: spent.total, by: `ci-${n - 1}`, verdict: ci.green && !unproven && !ci.rulesError ? 'GREEN' : 'RED', blocking: (ci.failing || []).map(f => f.where) })
  if (ci.rulesError) return await openResult('failed', 'ci', { reason: `the required checks of the base branch could not be read: ${ci.rulesError}` })
  if (unproven) return await openResult('failed', 'ci', { reason: `CI reported green, but the check listing does not prove it: ${unproven}` })
  // The one re-run of a disputed flake came back red: the disagreement between the fixer and CI is the head's.
  if (rerunBatch && !ci.green) return await awaitHeadOnDispute(rerunBatch.fixed, rerunBatch.blocking)
  if (testBlocking.length === 0 && ci.green) {
    if (!needTest) break
    continue
  }
  if (shared.length && testBlocking.length === 0) {
    const checkList = shared.map(name => `"${name}"`).join(', ')
    return await openResult('awaiting-head', 'ci', { reason: `the CI check(s) ${checkList} are red on the base branch tip too: the red is shared with main and is fixed there, so no fixer was launched. If this lane's item is that repair, start a new run with pr and tip and fixFirst.` })
  }
  if (ci.operatorDoor && testBlocking.length === 0) {
    if (needTest) continue
    return await openResult('awaiting-head', 'ci', { reason: `the only red check is the quality verdict, red because the diff holds only declared loosenings, which only the operator merges, so no fixer was launched. It waits at the operator's merge door: run \`${ci.operatorDoor}\`.` })
  }
  const taken = testBlocking
  testBlocking = []
  const ciBlocking = ci.green || shared.length ? [] : (ci.failing || [])
  const f = await fixRound(taken.concat(ciBlocking), taken.length ? 'the end-to-end test and CI' : 'CI', ci.green || shared.length ? 'test' : 'ci')
  if (f.stop) return f.stop
  if (f.flakes) {
    if (!(ci.red?.length && ci.red.every(job => job.runId && job.jobId))) return await awaitHeadOnDispute(f.fixed, ciBlocking)
    flakeRerunUsed = true
    followups.push(...f.flakes)
    adoptFixerTip(f.fixed)
    rerunRed = { red: ci.red, fixed: f.fixed, blocking: ciBlocking }
    continue
  }
  const stop = f.range && await reviewUntilClean(f.gateAgain ? ALL : [REVIEW], f.range, f.deltaFrom)
  if (stop) return stop
  // The tester runs again when it had failed or when any fix since its last run (a review fix included) touched production.
  // A clean merge of main alone does not re-run it: the integrated tree is then proven by CI, not by the tester. CI always runs again.
  needTest ||= taken.length > 0 || productionSinceTest
}

const escapedQuote = String.raw`'\''`
const shellQuoted = path => "'" + path.replaceAll("'", escapedQuote) + "'"
const rescopeAdds = passedOutsidePaths.map(path => '--add ' + shellQuoted(path)).join(' ')
const rescopeCommand = 'aco rescope ' + A.item + ' ' + rescopeAdds
const stillOpen = openFollowups()
const finalRoutingLine = await routingLine()
if (finalRoutingLine === null) return await openResult('awaiting-head', 'routing')
return {
  status: 'ready-to-land', pr, tip, spent, routing: ROUTING, routingLine: finalRoutingLine, history, followups: stillOpen, raisedBeforeTip: raisedBeforeTip(stillOpen), folded: [...folded.values()], disputed,
  ...gateUnseenView(), pathsOutsideClaim: passedOutsidePaths,
  requiredHeadActions: [
    ...(passedOutsidePaths.length ? [`write these paths into the scope of item #${A.item}'s body (and a one-sentence whole there when the combined scope is wide), then run \`${rescopeCommand}\` from ${A.worktree} before landing: these paths are outside the claim and passed the scope check`] : []),
    `land with \`aco land ${pr}\` only while the pull request head is still ${tip}`,
    ...(MATERIAL && isGateStandIn('gate', ROUTING.gate.model, ROUTING.gate.effort) ? [`name the Opus 5.5 stand-in as the final gate in the body of pull request #${pr}: the lane ran no Codex gate`] : []),
    ...(gateUnseen ? [`name ${gateUnseen.seenTip}..${tip} in the body of pull request #${pr}: the final gate, at its usage limit, did not see that range`] : []),
    ...(raisedBeforeTip(stillOpen).length ? ['re-check the follow-ups in raisedBeforeTip against the returned tip before routing them'] : []),
    ...(stillOpen.length ? [`route ${stillOpen.length} follow-up(s) to their owning items before landing`] : []),
    `update the body of item #${A.item}'s parent and name what the landing freed`,
  ],
}
