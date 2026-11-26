// ---------------------------------------------------------------- inputs
const A = args || {}
const need = ['item', 'worktree', 'branch', 'contract', 'e2e', 'scratch']
const missing = need.filter(k => !A[k])
if (missing.length) return { status: 'failed', stage: 'input', reason: `missing args: ${missing.join(', ')}` }
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
// The operator's words, as the item quotes them; the lane's one entry to routing above the effort cap and to models the table lacks.
if (A.operatorWord !== undefined && !(typeof A.operatorWord === 'string' && /\S/.test(A.operatorWord))) return { status: 'failed', stage: 'input', reason: 'operatorWord must be a non-empty string: the operator\'s words as the item quotes them' }
const OPERATOR_WORD = A.operatorWord
const MATERIAL = A.risk === 'material'
// Every gh call names the repository explicitly: agents start in the head's own checkout, which may be another repository.
if (A.repo && !/^[\w.-]+\/[\w.-]+$/.test(A.repo)) return { status: 'failed', stage: 'input', reason: 'repo must be owner/name' }
const R = A.repo ? ` -R ${A.repo}` : ''
const IN_REPO = A.repo ? ` in ${A.repo}` : ''
const REPO_API = `repos/${A.repo || '{owner}/{repo}'}`  // the REST path of the repository; the printer derives its own
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
// The one table of every role's model and effort (instructions/HEAD.md, "Model routing"), by the lane's risk: the models and the efforts each provider accepts,
// with what the operator's word adds, and the effort cap per model that the word lifts (opus medium, others high).
const LANE_MODEL_PROVIDER = { haiku: 'claude', sonnet: 'claude', opus: 'claude', 'gpt-6-astra': 'codex' }
const OPERATOR_WORD_MODEL_PROVIDER = { fable: 'claude' }
const LANE_PROVIDER_EFFORTS = { claude: ['low', 'medium', 'high'], codex: ['low', 'medium', 'high'] }
const OPERATOR_WORD_PROVIDER_EFFORTS = { claude: ['low', 'medium', 'high', 'xhigh', 'max'] }
const MODEL_PROVIDER = OPERATOR_WORD ? { ...LANE_MODEL_PROVIDER, ...OPERATOR_WORD_MODEL_PROVIDER } : LANE_MODEL_PROVIDER
const PROVIDER_EFFORTS = OPERATOR_WORD ? { ...LANE_PROVIDER_EFFORTS, ...OPERATOR_WORD_PROVIDER_EFFORTS } : LANE_PROVIDER_EFFORTS
const EFFORT_CAP = { opus: 'medium' }
const WORD_HINT = OPERATOR_WORD ? '' : '; more needs the operator\'s word, passed as operatorWord and quoted in the item'
// The one Claude gate: opus at high stands in while Codex is at its usage limit or refuses the gate model (instructions/HEAD.md, Reviews and gates); it is the one effort above medium opus may have.
const GATE_STAND_IN = { model: 'opus', effort: 'high' }
const isGateStandIn = (role, model, effort) => role === 'gate' && model === GATE_STAND_IN.model && effort === GATE_STAND_IN.effort
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
const routingProblem = A.routing === undefined ? null : routingRefusal(A.routing)
if (routingProblem) return { status: 'failed', stage: 'input', reason: routingProblem }
const ROUTING = Object.fromEntries(Object.entries(DEFAULT_ROUTING).map(([role, chosen]) => [role, { ...chosen, ...A.routing?.[role] }]))
const MECHANICAL = { agentType: 'general-purpose', ...ROUTING.mechanical }
// The relay re-read copies a line of about 500 characters, which the mechanical tier garbles.
const COPY = { agentType: 'general-purpose', ...ROUTING.copy }
const claudeRole = (role) => ({ model: ROUTING[role].model, effort: ROUTING[role].effort })

// Every prompt opens with the delegated line, as do the parts'.
const DELEGATED_LINE = 'This is a delegated step started by a head, not a main session: skip the session-start routine and do only this brief.'

const entryProblem = badEntry('fixFirst', A.fixFirst, FINDING) || badEntry('foldIn', A.foldIn, FOLLOWUP)
if (entryProblem) return { status: 'failed', stage: 'input', reason: entryProblem }
// A part that throws is a problem naming it, which its caller stops on at the stage of its own step.
// A Claude agent at its usage limit also sets claudeLimit, which turns every failure the lane reports afterwards into awaiting-head (openResult).
let claudeLimit = null
async function runPart(name, part, partArgs) {
  try {
    return await part(partArgs)
  } catch (error) {
    claudeLimit ||= claudeUsageLimitOf(error)
    return { problem: `ended in ${name} with ${String(error).slice(0, 300)}`, ...(error?.finished && { finished: error.finished }) }
  }
}
// The path of a finding is the first word of its `where` when that word is a path (it holds a slash or an extension), cut at a comma, a parenthetical label or its first colon (a line number or a symbol follows); a `where` that starts with free text, such as a CI check name, has none and gives ''. The one rule the printer's match, the lane's own-finding match and the printer's input digest share.
const findingPath = (where) => {
  const text = String(where).trim()
  const word = /^[^\s,(]*/.exec(text)[0]
  const isPath = word.includes('/') || /\.\w+(?=:|$)/.test(word)
  return isPath ? word.split(':', 1)[0].toWellFormed() : ''
}
// A value a command prints reaches a decision only through the line laneRelay reads back and checks.
const relay = (request) => runPart('lane-relay', laneRelay, { delegatedLine: DELEGATED_LINE, worktree: A.worktree, agentOptions: MECHANICAL, reread: COPY, findingPath, ...request })
// The failure reasons name the printed line only when the command printed one.
const printedLine = (relayed) => relayed.printed === undefined ? '' : `; the printed line: ${relayed.printed}`
// ------------------------------------------------------ shared sentences
const generatedCommands = GENERATED.map(([path, command]) => `${path}: ${command}`).join('; ')
const laneFacts =
  `Work item #${A.item}${IN_REPO}. Worktree ${A.worktree}, branch ${A.branch}; run every command from inside that worktree (cd there first). The head holds the claim: never claim, release, rescope, merge a pull request or land. ` +
  `Never use git stash and never touch the main checkout. Read the item body first (gh issue view ${A.item}${R} --json body --jq .body), and where the worktree tracks \`.aco/brief.toml\`, run ` +
  `\`aco brief ${A.item} --step <step>\` for the repository's RULES and CHECKS; elsewhere its AGENTS.md and README name them. Local runs stay targeted under the worker count the contract names; ` +
  `run \`probe-run --wait-only\` before any test run; it returns once the machine has room. CI is the gate. ` +
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
  `Mark every finding **blocking** or **follow-up** as the contract's section "Reviews" defines them, the tripwire exception included. ` +
  `Reproduce a behaviour on origin/main before calling it pre-existing; each follow-up names its owning item (#n) or "distributor" and sets inPlace true only when ${IN_PLACE_RULE}. ` +
  `Every blocking finding names the rule it breaks and the evidence you observed; a finding you cannot back with evidence is not blocking. ` +
  `Every blocking finding names its kind: **defect** when the code breaks a rule or ` +
  `does not do what the contract, its docs or its own text promise — a mismatch between promise and code is defect unless the contract says the code is right, ` +
  `and then it is **docs**, as is any finding where only documentation or a comment is wrong; **test-gap** when the code already does what the contract says ` +
  `and a behaviour has no test that pins it, a test beside its real entry point (a private reader or helper instead of the surface the contract names) included, because that behaviour has no test at its boundary; its proof is a mutation, as for any test-gap. Hygiene in test code (a needless monkeypatch, a new test whose name does not state the behaviour it pins) is a **defect** whose proof is the diff, not a mutation; it carries no test draft.`

const findingKey = (f) => `${f.where}::${f.text}`
// A finding from a run that predates kinds (a resumed run) keeps the rule it was raised under.
const kindOf = (f) => f.kind || 'defect'
const listFindings = (list) => list.map((f, i) =>
  `${i + 1}. ${f.where} — ${f.text}\n   kind: ${kindOf(f)}\n   rule: ${f.rule}\n   evidence: ${f.evidence}` +
  (f.repro ? `\n   repro: ${f.repro}` : '') + (f.testDraft ? `\n   test draft: ${f.testDraft}` : '')).join('\n')

// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent agent); a fresh Claude reviewer is the
// default, Sonnet at high effort and Opus at medium on material risk. The final gate on a material lane runs on Codex through a courier, because the
// Claude builder needs another provider; routing.gate may name the Opus stand-in, which runs as a fresh Claude reviewer, and a gate Codex refuses for its model is replaced by it in the lane's own round. laneReview runs one round and classifies it.
const ROUND_STATES = new Set(['approve', 'revise', 'failed', 'architectural', 'limited', 'brief-mismatch', 'no-brief-record', 'hung'])

// ------------------------------------------------------------ state
const history = []
const followups = []
const disputed = []
let pr = A.pr || null
let tip = A.tip || null
let buildReuse = null
const spent = { review: 0, test: 0, ci: 0, total: 0 }
const fixRolesRun = []  // the role of each fixer that ran, in order
let syncedTip = null  // the head the sync read: the start tip of a pr/tip run's begin
let runId = null  // minted by the branch relay step: the id this run has on the claim in aco lane-record begin and add
const fixRoundsByStage = zeroCounts()  // the stage whose findings each fix round answered
const seen = new Map()  // finding key -> how often it came back after a fix
let productionSinceTest = false  // any fix since the last end-to-end test touched production
let productionSinceGate = false  // any fix since the last unlimited gate result touched production
let gateRefused = false  // a Codex gate refused its model in this run, so the stand-in ran for that reason
let gateUnseen = null  // the range a stand-in reviewer re-checked for a gate at its usage limit: {seenTip, findings, limit}, and every result adds tip
const folded = new Map()  // follow-up key -> the follow-up, with the tip of the accepted fix that folded it in
const declined = new Map()  // follow-up key -> the reason the fixer gave for leaving it; it stays open and no fixer is handed it again
const REVIEW = { key: 'review', provider: REVIEWER_PROVIDER, role: 'independent reviewer' }
// The provider follows the routed gate, which a refused Codex gate changes to the stand-in for the rest of the run.
const GATE = { key: 'gate', get provider() { return MODEL_PROVIDER[ROUTING.gate.model] }, role: 'final gate (architecture, data safety, public contract)' }
const STANDIN = { key: 'standin', provider: 'claude', role: "stand-in reviewer (the final gate's provider is at its usage limit)" }
const ALL = MATERIAL ? [REVIEW, GATE] : [REVIEW]
function openFollowups() {
  const open = new Map()
  followups.forEach(f => { if (!folded.has(findingKey(f)) && !open.has(findingKey(f))) open.set(findingKey(f), declined.has(findingKey(f)) ? { ...f, declined: declined.get(findingKey(f)) } : f) })
  return [...open.values()]
}
const raisedBeforeTip = (open) => open.filter(f => f.tip && !sameCommit(f.tip, tip))
const gateUnseenView = () => gateUnseen ? { gateUnseen: { ...gateUnseen, tip } } : {}
// The Routing line comes from laneRouting (aco's specs/lane-record.spec.md owns the grammar); the head pastes it as is.
async function routingLine() {
  const line = await runPart('lane-routing', laneRouting, { routing: ROUTING, history, fixRole: fixRolesRun.at(-1) ?? null, rounds: spent.total, experiment: A.experiment })
  // The lane's own result stays; the placeholder names why the line is missing.
  return typeof line === 'string' ? line : `Routing: not printed (${String(line?.problem ?? JSON.stringify(line)).replace(/\s+/g, ' ').slice(0, 200)})`
}
// The head resumes after the reset with the arguments the stage's other awaiting-head stops use; the role never moves to another model or provider.
// A blocked fixer's resume carries no tip: its answer reads none, so the head passes the branch's current head.
const claudeLimitResume = (stage, extra) => stage === 'build' && !pr
  ? { build: A.build }
  : { pr, ...(!extra.withoutTip && { tip }), ...(extra.lastBlocking?.length && { fixFirst: extra.lastBlocking }), ...(extra.foldIn?.length && { foldIn: extra.foldIn }) }
const claudeLimitResetText = () => claudeLimit.resetsAt ? 'The account resets ' + claudeLimit.resetsAt + '.' : 'The error names no reset time.'
const claudeLimitReason = (stage) =>
  `a Claude agent hit its usage limit at stage ${stage}; the lane never moves a role to another model or provider. ${claudeLimitResetText()} After the reset`
const claudeLimitOwnReason = (extra) => extra.reason ? ' The stage\'s own reason: ' + extra.reason : ''
const openResult = async (status, stage, extra = {}) => {
  if (status === 'failed' && claudeLimit) return openResult('awaiting-head', stage, { ...extra, claudeLimit, resume: claudeLimitResume(stage, extra), reason: `${claudeLimitReason(stage)} start a new run with the arguments in resume.${claudeLimitOwnReason(extra)}` })
  const { unusable, ...tester } = await settleTesterAtStop()
  const line = await routingLine()
  const written = claudeLimit || stage === 'input' ? null : await writeRecord()
  const refusedAdd = await addRecord(written)
  const { status: endStatus, stage: endStage, extra: endExtra } = openEnd({ status, stage, extra, refusedAdd, abandon: abandonActions(A.item, written, began) })
  const open = openFollowups()
  return {
    status: endStatus, stage: endStage, pr, tip, spent, routing: ROUTING, ...(OPERATOR_WORD && { operatorWord: OPERATOR_WORD }), routingLine: line, ...recordView(written, began), history,
    followups: open, raisedBeforeTip: raisedBeforeTip(open), folded: [...folded.values()], disputed, ...gateUnseenView(), ...sampledView(), ...tester, ...endExtra,
    ...(unusable && { reason: [endExtra.reason, unusable].filter(Boolean).join('; ') }),
  }
}

let carriedOver = A.fixFirst || []
let carriesBatch = carriedOver.length || A.foldIn?.length
let syncRaisedConflict = false  // the sync's conflict is the first finding of the carried batch
if (A.deltaFrom && !SHA.test(A.deltaFrom)) return await openResult('failed', 'input', { reason: 'deltaFrom is not a sha' })
// Without fixFirst or foldIn an empty delta has no reviewer to satisfy, and the lane cannot verify an earlier approval; the head names the honest resume. With either, the fixer's commits are the delta.
if (sameCommit(A.deltaFrom, A.tip) && !carriesBatch) return await openResult('failed', 'input', { reason: 'deltaFrom is the tip, so the delta is empty and nothing is reviewed. Start the run again without deltaFrom for a full review, name the commit before the commits no reviewer has seen as deltaFrom, or pass fixFirst or foldIn for a run that starts at the fixer.' })

// A builder or fixer that ends without a result may leave commits or uncommitted work in the worktree. The lane saves
// it (commit, push, and for the build a draft pull request) and hands the head a resumable awaiting-head result; a worktree with nothing new keeps the failed result.
async function checkpointOrFail(stage, startRef, failure, fixer) {
  const failed = () => openResult('failed', stage, failure)
  phase('Checkpoint')
  const nonce = `checkpoint-${stage}-${spent.total}`
  const saved = await relay({ label: `checkpoint-${stage}`, phase: 'Checkpoint', step: 'sync', relayArgs: [`'${nonce}'`], nonce, requiredKeys: ['head', 'parents', 'main'], answerKind: 'checkpoint', agentOptions: COPY, facts: laneFacts, stage, startRef, branch: A.branch, item: A.item, repo: R })
  if (!saved || saved.problem || saved.commandFailed || !saved.work) return await failed()
  const checkpointTip = saved.values.head.out
  const checkpointPr = stage === 'build' ? saved.pr : pr
  if (!SHA.test(checkpointTip) || !Number.isInteger(checkpointPr) || checkpointPr < 1 || (stage === 'fix' && sameCommit(checkpointTip, tip))) return await failed()
  tip = checkpointTip
  pr = checkpointPr
  history.push({ after: spent.total, by: 'checkpoint', stage, tip })
  const origin = fixer ? scopeOrigin(fixer.carried, fixer.tipBeforeFix) : { note: '' }
  const unreviewed = { ...origin, note: `The tip is an unfinished checkpoint no reviewer has seen. ${origin.note}`.trim() }
  const pushStop = await pushAndCheckScope(`scope-checkpoint-${stage}-${spent.total}`, unreviewed)
  const fixerResume = fixer?.blocking.length ? { fixFirst: fixer.blocking } : { foldIn: fixer?.foldIn, ...(origin.deltaFrom && { deltaFrom: origin.deltaFrom }) }
  const resumeFix = fixer
    ? fixerResume
    : { fixFirst: [{ where: CHECKPOINT_FINDING_WHERE, kind: 'defect', text: 'The builder ended without a result, so the checkpoint is unfinished: complete the build brief against it; when it already meets the brief with its checks green, change nothing and report briefMet. The brief follows.', rule: CHECKPOINT_FINDING_WHERE, evidence: `the builder's work is committed on ${A.branch} at ${tip} and the brief is not yet met:\n${A.build}` }] }
  const resume = { pr, tip, ...resumeFix }
  if (pushStop) return { ...pushStop.stop, resume }
  const openedDraft = fixer ? '' : ' and opened draft pull request #' + pr
  return await openResult('awaiting-head', stage, {
    reason: `the ${fixer ? 'fixer' : 'builder'} returned no result; the lane committed its work as an unfinished checkpoint at ${tip}, pushed ${A.branch}${openedDraft}. Start a new run with pr ${pr}, tip ${tip} and the fixFirst in resume.`,
    ...(fixer && { lastBlocking: fixer.blocking }), resume,
  })
}

// ------------------------------------------------------- worktree and branch
// A worktree that is missing or holds another branch costs a whole builder run before the scope step notices, so the relay reads it first.
phase('Worktree')
// With the operator's word the same printer run reads the item body, so a forgotten or mistyped quote stops the lane before any builder or reviewer starts.
const wordRelay = OPERATOR_WORD ? { relayArgs: [A.item, `'${A.repo || ''}'`, `'${wordArgument(OPERATOR_WORD)}'`, "'branch'"], sentWord: OPERATOR_WORD, requiredKeys: ['branch', 'run', 'item'] } : { relayArgs: ["'branch'"], requiredKeys: ['branch', 'run'] }
const checkedBranch = await relay({ label: 'branch', phase: 'Worktree', step: 'branch', nonce: 'branch', ...wordRelay, brief: `${laneFacts}\nChange nothing in the files;` })
const branchRead = checkedBranch?.values?.branch
let foundBranch = branchRead?.out
if (!checkedBranch) foundBranch = 'no answer from the check'
else if (checkedBranch.problem) foundBranch = `no readable line (the check ${checkedBranch.problem}${printedLine(checkedBranch)})`
else if (branchRead.code !== 0) foundBranch = `git exited ${branchRead.code}: ${branchRead.err}`
else if (!RUN_ID.test(checkedBranch.values.run.out ?? '')) foundBranch = 'no run id in the check'
if (foundBranch !== A.branch) return await openResult('failed', 'input', { reason: `worktree ${A.worktree} must exist with branch ${A.branch} checked out; found ${foundBranch}` })
runId = checkedBranch.values.run.out
if (OPERATOR_WORD) {
  const itemRead = checkedBranch.values.item
  if (checkedBranch.unreachable) return await openResult('awaiting-head', 'input', { reason: `${checkedBranch.unreachable} The lane could not read item #${A.item} for the operator's word. Start the lane again once it answers.` })
  if (itemRead.code !== 0) return await openResult('failed', 'input', { reason: `reading item #${A.item} for the operatorWord failed: gh exited ${itemRead.code}: ${itemRead.err}` })
  if (checkedBranch.values.quoted !== true) return await openResult('failed', 'input', { reason: `the body of item #${A.item} does not quote the operatorWord between quotation marks ("…", „…“ or “…”); quote the operator's words there, then start the lane again` })
}

// ---------------------------------------------------------------- build
if (A.build) {
  const beginStop = await beginRun()
  if (beginStop) return beginStop
  phase('Build')
  startedStages.build = true
  const built = await runPart('lane-build', laneBuild, { delegatedLine: DELEGATED_LINE, laneFacts, driveFacts, rescopeFacts, localCheckFacts: `${localCheckFacts} ${turnFacts('build')}${surfaceFacts()}`, build: A.build, routing: claudeRole('build') })
  if (built?.problem && !claudeLimit) return await openResult('failed', 'build', { reason: `the builder step ${built.problem}` })
  if (!built || built.problem) return await checkpointOrFail('build', 'origin/main', { reason: `the builder returned no result; inspect ${A.worktree} for uncommitted work, checkpoint it, and hand it to a fresh finisher` })
  if (built.blocked) return await openResult('escalated', 'build', { reason: built.blockedReason })
  if (!SHA.test(built.tip || '')) return await openResult('failed', 'build', { reason: `the builder returned a tip that is not a sha: ${String(built.tip).slice(0, 80)}` })
  pr = built.pr; tip = built.tip; buildReuse = built.reuse
  log(`built PR #${pr} at ${tip}`)
} else {
  phase('Sync')
  const nonce = `sync-${tip}`
  const synced = await relay({ label: 'sync', phase: 'Sync', step: 'sync', relayArgs: [`'${nonce}'`], nonce, requiredKeys: ['head', 'parents', 'main'], answerKind: 'sync', facts: laneFacts, branch: A.branch, hasLedgers: LEDGERS.length > 0, hasGenerated: GENERATED.length > 0 })
  if (!synced) return await openResult('failed', 'sync')
  const { values, problem } = synced
  if (problem || synced.commandFailed) return await openResult('failed', 'sync', { reason: `the sync's relay line ${problem || 'reports a failed git command'}${printedLine(synced)}` })
  if (values.main.code === 1) {
    const conflict = syncConflictOf(values, [...LEDGERS, ...GENERATED.map(([path]) => path)])
    if (!conflict) return await openResult('escalated', 'sync', { reason: synced.note || `the lane tip ${values.head.out} does not contain origin/main, and the sync named no cause` })
    syncRaisedConflict = true
    carriedOver = [syncConflictFinding(conflict), ...carriedOver.filter(f => f.where !== MERGEABLE_WHERE)]
    carriesBatch = true
    history.push({ after: 0, by: 'sync', conflict: conflict.paths, tip: values.head.out })
  }
  if (!sameCommit(values.head.out, tip) && !mergedOnto(values, tip)) history.push({ after: 0, by: 'sync', from: tip, tip: values.head.out })
  tip = values.head.out
  syncedTip = tip
  // A run that starts at a fixer has no scope check before its work, so it begins here; every other run begins after the scope check below.
  if (carriesBatch) {
    const beginStop = await beginRun(syncedTip)
    if (beginStop) return beginStop
  }
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
async function reviewRound(which, range, from, sampledLook) {
  const beginStop = await beginRun()
  if (beginStop) return { which, results: [], verdict: { state: 'stopped', stop: beginStop }, range, from }
  // The sampled look is the gate alone and may be skipped, so it never marks the review stage as started.
  if (!sampledLook) startedStages.review = true
  const after = sampledLook?.after ?? spent.total
  const reviewers = which.map(r => ({ key: r.key, provider: r.provider, role: r.role, isGate: r === GATE, routing: claudeRole(REVIEWER_ROUTING_ROWS[r.key]) }))
  const answer = await runPart('lane-review', laneReview, { item: A.item, pr, repo: A.repo, repoFlag: R, after, tip, delegatedLine: DELEGATED_LINE, worktree: A.worktree, branch: A.branch, scratch: A.scratch, tag: TAG, label: `r${after}`, range, reuse: buildReuse, e2e: A.e2e, contract: A.contract, blockingLine: BLOCKING_LINE, reviewers, findingKinds: FINDING_KINDS, finding: FINDING, followup: REPORTED_FOLLOWUP, mechanical: MECHANICAL, gateStandIn: MATERIAL && !sampledLook ? GATE_STAND_IN : null })
  // A Codex gate that refused its model was replaced in its round by the stand-in; the run keeps it, so a re-check has the gate's row and the record names the one gate that ran.
  if ((answer?.results ?? answer?.finished?.results ?? []).some(result => result?.gateRefusal)) { gateRefused = true; ROUTING.gate = { ...GATE_STAND_IN } }
  const unfit = unfitRoundAnswer(answer, which.length)
  if (unfit) {
    // The reviewers that finished before a usage limit keep their records, so the resume carries their findings.
    const finished = answer?.finished
    if (finished) { history.push(...finished.history); followups.push(...finished.followups); gateRounds.push(...finished.gateRounds) }
    return { which, results: finished?.results ?? [], verdict: { state: 'failed', reason: unfit }, range, from }
  }
  const { results, verdict } = answer
  if (sampledLook && LOOK_WITHOUT_VERDICT.has(verdict.state)) return { which, results, verdict, range, from, unrecorded: true }
  history.push(...answer.history)
  followups.push(...answer.followups)
  if (answer.gateRounds.length) productionSinceGate = false
  gateRounds.push(...answer.gateRounds)
  return { which, results, verdict, range, from, history: answer.history }
}

// A finding that comes back unchanged after a fix meant for it is no progress; the second return stops the lane.
// A conflict with main or a missing CI run is a new event each time, never the same finding; a CI failure is the same
// only when its evidence (the failing log tail) repeats, because a courier's text for two different failures can match.
// Log tails often carry timestamps, so this rarely fires for CI; the ci budget is the real stop there.
const progressKey = (f) => isCiCheckFinding(f) ? `${f.where}::${f.evidence}` : findingKey(f)
function noProgress(blocking) {
  const counted = blocking.filter(f => f.where !== MERGEABLE_WHERE && f.where !== CHECKS_WHERE)
  const repeated = counted.filter(f => (seen.get(progressKey(f)) || 0) >= 1)
  counted.forEach(f => seen.set(progressKey(f), (seen.get(progressKey(f)) || 0) + 1))
  return repeated
}

// Why no further fix round may start, or null while the budgets allow one and the findings still move.
async function fixRoundStop(blocking, budgetKey) {
  if (spent[budgetKey] >= B[budgetKey] || spent.total >= B.total) {
    const which = spent.total >= B.total ? 'total' : budgetKey
    return openResult(budgetKey === 'ci' ? 'ci-red' : 'unresolved', budgetKey, { reason: `${which} budget spent; a new run with the arguments in resume starts at the fixer and reviews only its commits`, lastBlocking: blocking, resume: { ...claudeLimitResume('fix', { lastBlocking: blocking }), deltaFrom: tip } })
  }
  const repeated = noProgress(blocking)
  return repeated.length ? openResult('unresolved', budgetKey, { reason: 'a finding came back unchanged after its fix', lastBlocking: repeated }) : null
}

// A batch of CI findings only, every one disputed with counter-evidence and nothing committed, is a flake the lane re-runs once before the head sees it.
let flakeRerunUsed = false

// The fixer's returned tip becomes the lane tip; it is unreviewed when the fixer committed anything. Returns whether it did.
function adoptFixerTip(fixed) {
  tip = fixed.tip
  const committed = !fixed.unchanged
  history.push({ after: spent.total, by: 'fix', tip: fixed.tip, reviewed: !committed })
  return committed
}

// An answer given outside the tree commits nothing, and its re-check judges a new round, so it is not read as the same round's split verdict.
function takeFixerTip(fixed) {
  if (fixed.answeredOutside && fixed.unchanged) adoptFixerTip(fixed)
  else tip = fixed.tip
}

// Takes the fixer's tip and names the delta the reviewers see next, or none when a clean merge of main was the whole fix.
async function acceptFix(fixed, blocking, foldIn) {
  const declinedBy = fixed.foldInDeclined
  if (fixed.outsidePaths.length) return { stop: await openResult('failed', 'fix', { reason: `the fixer reported paths outside the worktree: ${fixed.outsidePaths.join(', ')}` }) }
  takeFixerTip(fixed)
  if (fixed.touchesProduction) {
    productionSinceTest = true
    productionSinceGate = true
  }
  if ((fixed.unchanged && !fixed.answeredOutside) || (fixed.mergeOnly && !fixed.mergeResolvedLaneConflict)) {  // nothing of the lane changed to review: a clean merge of main answered the mergeable finding
    log(`fix ${spent.total}: no lane change to review`)
    return { range: null, proofNotes: '', gateAgain: false, touchesProduction: false }
  }
  const edited = fixed.answeredOutside ? fixed.outside.map(o => (o.foldIn ? 'fold-in ' + (foldIn[o.foldIn - 1]?.where ?? o.foldIn) : 'finding ' + o.finding) + ': ' + o.where).join('; ') : ''
  const conflicted = conflictedPathsOf(blocking)
  const mergeLines = mergeReading({ conflicted, merged: fixed.mergedPaths, mergedCut: fixed.mergedCut, generatedPaths: GENERATED.map(([path]) => path) })
  let delta = `only this delta, the fixer's own commits: git log -p --first-parent --remerge-diff ${fixed.heldTip}..${fixed.tip} (main's clean changes are not shown; a lane edit inside a merge of main is)`
  if (fixed.answeredOutside) delta = `no commit changed: read live what the fixer edited outside the tree (${edited}), the item body with gh issue view ${A.item}${R} --json body --jq .body, the pull request body with gh pr view ${pr}${R} --json body and an item comment with gh issue view ${A.item}${R} --comments`
  else if (fixed.mergeResolvedLaneConflict && !conflicted.length) delta = `only this delta: git diff ${fixed.heldTip}..${fixed.tip} (it includes a merge of main whose conflicts in this lane's files were resolved by hand)`
  const range = blocking.length ? `${delta}.${mergeLines} It answers these findings:\n${listFindings(blocking)}${fixed.proofNotes}${foldInsInRange(foldIn, declinedBy)}`
    : `${delta}.${mergeLines} It answers these follow-ups:${fixed.proofNotes}${foldInsInRange(foldIn, declinedBy, '')}`
  log(`fix ${spent.total}: ${fixed.heldTip.slice(0, 7)}..${tip.slice(0, 7)}`)
  return { range, mergeLines, answeredOutside: fixed.answeredOutside, proofNotes: fixed.proofNotes, gateAgain: MATERIAL && fixed.touchesProduction, touchesProduction: fixed.touchesProduction }
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

function recordFoldIns(foldIn, answered) {
  for (const f of foldIn) {
    if (Object.hasOwn(answered.foldInDeclined, f.where)) declined.set(findingKey(f), answered.foldInDeclined[f.where])
    else folded.set(findingKey(f), { ...f, tip: answered.tip, ...(answered.foldInEvidence[f.where] && { evidence: answered.foldInEvidence[f.where] }) })
  }
}

async function fixRound(blocking, source, round, budgetKey, carried, stage = budgetKey) {
  const tipBeforeFix = tip
  const stop = await fixRoundStop(blocking, budgetKey)
  if (stop) return { stop }
  const beginStop = await beginRun()
  if (beginStop) return { stop: beginStop }
  spent[budgetKey]++
  spent.total++
  const foldIn = inPlaceFollowups()
  fixRoundsByStage[blocking.length ? stage : foldInStage(foldIn) ?? stage]++
  phase('Fix')
  const role = fixerRole(blocking, foldIn)
  fixRolesRun.push(role)
  const nonce = `fix-${spent.total}-${tipBeforeFix}`
  const answeredPaths = [...new Set(blocking.map(f => findingPath(f.where)).filter(Boolean))]
  const answered = await relay({ label: `fix-${spent.total}`, phase: 'Fix', step: 'fix', relayArgs: [`'${tipBeforeFix}'`, `'${pathsArgument(answeredPaths)}'`, `'${nonce}'`], sentPaths: answeredPaths, nonce, requiredKeys: ['head', 'parents', 'main'], answerKind: 'fix', agentOptions: { agentType: 'atelier:code-fixer', ...claudeRole(role) },
    facts: `${laneFacts} ${driveFacts} ${rescopeFacts} ${localCheckFacts} ${turnFacts('fix')}${surfaceFacts()}`, pr, tip, source, round, branch: A.branch, blocking: listFindings(blocking), findings: blocking.map(f => ({ ...f, kind: kindOf(f) })), foldIns: numberFoldIns(foldIn), foldInEntries: foldIn, productionPaths: PRODUCTION, flakeRerunUsed, carried: Boolean(carried), answers: A.answers })
  if (!answered || (claudeLimit && answered.problem)) return { stop: await checkpointOrFail('fix', tipBeforeFix, { reason: `the fixer returned no result; inspect ${A.worktree} for commits past ${tip} and uncommitted work, then start a new run with pr and tip (and fixFirst for what is left)`, lastBlocking: blocking }, { blocking, carried, tipBeforeFix, foldIn }) }
  const early = await fixAnswerStop(answered, blocking, foldIn, tipBeforeFix)
  if (early) return early
  const accepted = await acceptFix(answered, blocking, foldIn)
  if (accepted.stop) return unaccepted(answered, accepted.stop)
  history.push(...fixProofEntries(answered, blocking, spent.total))
  const { deltaFrom, note } = scopeOrigin(carried, tipBeforeFix)
  const scopeStop = await pushAndCheckScope(`scope-${spent.total}`, { note, deltaFrom })
  if (scopeStop) return unaccepted(answered, scopeStop.stop)
  // A clean merge of main alone carries no lane change, so it cannot carry a fold-in either; an unchanged tip carries
  // them only when the fixer proved each already satisfied. A scope stop folds nothing in.
  if (accepted.range || answered.settled) recordFoldIns(foldIn, answered)
  return { ...accepted, foldIn, deltaFrom, checkpointMet: answered.checkpointMet, declinedBy: answered.foldInDeclined }
}

function newRunOf(origin) { return ['a new run with pr and tip', origin.deltaFrom && ` and deltaFrom ${origin.deltaFrom}`].filter(Boolean).join('') }
// The script, not the builder or fixer, makes sure the remote branch carries the lane tip, before the claim-scope check
// and every review. Never a force push: a rejected push stops the lane.
// aco decides what the claim covers; the lane only asks.
// Reached only when aco's outside list is truncated, so the lane cannot judge the unlisted paths: the head chooses between a rescope and a revert.
// origin says where the hit came from: a note, and the tip the new run reviews from, when the lane knows one.
async function scopeStop(paths, origin, total) {
  const listed = paths.join(', ')
  const omitted = total > paths.length ? ` and ${total - paths.length} more` : ''
  history.push({ by: 'scope', outside: paths, tip })
  return { stop: await openResult('awaiting-head', 'scope', { outside: paths, reason:
    `Outside the claim scope: ${listed}${omitted}. No fixer was launched. ${origin.note} Either run aco rescope for them and start ${newRunOf(origin)}, ` +
    `or start ${newRunOf(origin)} and fixFirst asking a fixer to revert them. Find the commits with git log origin/main..${tip} -- ${listed}.` }) }
}

async function pushAndCheckScope(label, origin) {
  phase('Scope')
  const nonce = `${label}-${tip}`
  const checked = await relay({ label, phase: 'Scope', step: 'scope', relayArgs: [A.item, `'${A.branch}'`, `'${nonce}'`], nonce, requiredKeys: ['push', 'remote', 'head', 'parents', 'second_parent_in_main', 'brief'], brief: `${laneFacts}\nChange nothing in the files;` })
  if (!checked) return { stop: await openResult('failed', 'scope', { reason: 'the push and claim-scope check returned no result' }) }
  const fail = async (stage, reason) => ({ stop: await openResult('failed', stage, { reason: `${reason}${printedLine(checked)}` }) })
  const { values, problem } = checked
  if (problem) return fail('scope', `the push and claim-scope check ${problem}`)
  if (checked.unreachable) return { stop: await openResult('awaiting-head', 'scope', { reason: `${checked.unreachable} Start ${newRunOf(origin)} once it answers.` }) }
  const { push, remote, head, brief } = values
  // A fix batch may leave a clean merge of origin/main on top of the tip; the lane goes on from that merge, never from any other difference.
  const adoptedMerge = push.code === 0 && !sameCommit(remote.out, tip) && sameCommit(remote.out, head.out) && mergedOnto(values, tip) &&
    values.parents.out.split('\n').length === 2 && values.second_parent_in_main.code === 0
  if (push.code !== 0 || !(adoptedMerge || sameCommit(remote.out, tip))) {
    return fail('push', `the remote branch ${A.branch} does not carry the lane tip ${tip}: git push exited ${push.code} (${push.err}), origin/${A.branch} is ${remote.out}, HEAD is ${head.out}`)
  }
  if (adoptedMerge) history.push({ by: 'scope', adoptedMerge: head.out, from: tip })
  // A builder may report a short sha; the verdicts and the record keep full ones, so the tip becomes git's full form once, here.
  tip = adoptedMerge ? head.out : remote.out
  if (brief.code !== 0) return fail('scope', `aco brief ${A.item} --json exited ${brief.code}: ${brief.err}`)
  noteSurfaces(values.surfaces)
  const paths = values.outside_claim
  if (paths === null) return fail('scope', 'the lane holds no live claim (outside_claim is null); a lane without a claim does not reach review')
  if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) return fail('scope', `aco's outside_claim is neither null nor a list of paths: ${JSON.stringify(paths)}`)
  passedOutsidePaths = []
  if (!paths.length) return null
  // The relay lists at most PRINTED_PATH_LIMIT paths; the unlisted ones cannot be judged.
  if (values.count === paths.length) {
    history.push({ by: 'scope', outside: paths, tip, passedOutside: true })
    passedOutsidePaths = [...new Set(paths)]
    return null
  }
  return scopeStop(paths, origin, values.count)
}

// Review until clean. After every fix the delta goes back to whoever raised a finding, and the gate returns on a
// material lane when the fix touched production or resolved lane conflicts. REVISE is handled one way everywhere.
// A sampled look passes its own round settings and is skipped when the round gave no verdict.
async function reviewUntilClean(which, range, from, sampledLook) {
  phase('Review')
  const round = await reviewRound(which, range, from, sampledLook)
  if (round.unrecorded) return skipSampledLook(round)
  return await settleReview(round) ?? await storeProvenPoint() ?? await followUpBatch()
}

// A round the head resumes (a Codex reviewer out of usage, a courier whose brief never matched) repeats its range, so the review never moves to another provider.
const blockingOf = rr => rr.results.filter(Boolean).flatMap(v => v.blocking || [])
async function awaitHead(rr, reason, extra = {}) {
  const lastBlocking = blockingOf(rr)
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
  lastBlocking: blockingOf(rr), reason: `a Codex courier found no brief in its own transcript, twice, and started no Codex: ${rr.verdict.reason}.`,
  requiredHeadActions: ['report the defect to the marketplace repository: the courier of lane-review cannot read its brief from the workflow agent transcript', 'until it is repaired, run the gate through routing.gate (the Opus stand-in)'],
})
const awaitBrief = rr => awaitHead(rr, `a Codex courier wrote a different brief than the script composed, twice, and started no Codex: ${rr.verdict.reason}. Then`)

const awaitHung = rr => awaitHead(rr, `a Codex gate hung twice, its run log silent past the threshold and the run killed each time; the gate never falls back to another model: ${rr.verdict.reason}. Then`)

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
async function reviseAfter(rr) {
  const blocking = blockingOf(rr)
  const raised = rr.which.filter((r, i) => rr.results[i] && (rr.results[i].blocking || []).length > 0)
  const gateStreak = gateRounds.slice(-3)
  if (gateStreak.filter(round => round.verdict === 'REVISE').length === 3) {
    return openResult('awaiting-head', 'review', { gateRevisions: gateStreak, lastBlocking: blocking, reason:
      'The final gate returned REVISE three times in a row; no fixer was started. Re-ask the pull question against gateRevisions first, ' +
      'then start a new run with pr and tip and fixFirst, or re-cut the item.' })
  }
  // A reviewer that approved the tip has proven it, whichever other reviewer revises it; its verdict goes to the claim before the fixer can die.
  // Not when the approval follows a revision of the same tip: aco lands the last stored verdict, so that segment stays unstored until the fixer's commits are judged.
  if (rr.history.some(entry => entry.verdict === 'APPROVE') && !approvesRevisedTip(history)) {
    const stored = await storeProvenPoint()
    if (stored) return stored
  }
  const f = await fixRound(blocking, 'the review', ROUND.review, 'review', false, raised.some(r => VERDICT_STAGES[r.key] === 'gate') ? 'gate' : 'review')
  if (f.stop) return f.stop
  if (!f.range) return openResult('failed', 'review', { reason: 'a review finding was answered by a merge alone', lastBlocking: blocking })
  const next = f.gateAgain && !raised.includes(GATE) ? raised.concat([GATE]) : raised
  phase('Review')
  return settleReview(await reviewRound(next, f.range, f.deltaFrom))
}

async function settleReview(rr) {
  const settleSlip = { stopped: (stoppedRound) => stoppedRound.verdict.stop, limited: settleLimit, 'brief-mismatch': awaitBrief, 'no-brief-record': reportNoBriefRecord, hung: awaitHung, revise: reviseAfter }[rr.verdict.state]
  if (settleSlip) return settleSlip(rr)
  if (rr.verdict.state === 'failed') return claudeLimit ? awaitHead(rr, claudeLimitReason('review'), { claudeLimit, resume: { ...claudeLimitResume('review', { lastBlocking: blockingOf(rr) }), ...(rr.from && { deltaFrom: rr.from, answers: rr.range }) } }) : openResult('failed', 'review', { reason: rr.verdict.reason })
  if (rr.verdict.state === 'architectural') return openResult('escalated', 'review', { reason: 'architectural verdict' })
  return null
}

// A builder's work, and the commits a resumed run inherits, are checked against the claim before the first review, like every fixer's.
// A carried batch is checked after it instead: that check is branch-wide, and a fixer must be able to revert what the head names.
let firstScopeCheck = null
if (!carriesBatch && A.build) {
  firstScopeCheck = await pushAndCheckScope(`scope-${spent.total}`, { note: 'No reviewer has seen the build, so the new run reviews the whole lane.' })
} else if (!carriesBatch) {
  firstScopeCheck = await pushAndCheckScope('scope-resume', { note: 'The commits came from an earlier run.' })
}
if (firstScopeCheck?.stop) return firstScopeCheck.stop
const synchronizedBeginStop = syncedTip && !carriesBatch ? await beginRun(syncedTip) : null
if (synchronizedBeginStop) return synchronizedBeginStop
const dutyOfGate = await sampledDuty(firstBegan)
if (dutyOfGate.stop) return dutyOfGate.stop
// Re-entry after the head settled an awaiting-head result: review only the fix commits no reviewer has seen yet.
// Re-entry at the fix: the head hands over blocking findings from an earlier run (for example the tester's), and
// in-place follow-ups to fold in. The delta the fixer makes is reviewed before the test and CI run again.
let firstReview
if (carriesBatch) {
  followups.push(...(A.foldIn || []))
  // A conflict alone is the CI budget's round, as CI's own conflict finding is; joined to a carried batch it is that batch's round.
  const conflictOnly = syncRaisedConflict && carriedOver.length === 1 && !A.foldIn?.length
  let carriedFrom = 'the head (carried over from the previous run)'
  if (syncRaisedConflict) carriedFrom = conflictOnly ? 'the sync' : 'the sync and the head (carried over from the previous run)'
  const f = await fixRound(carriedOver, carriedFrom, carriedOver.some(isCiFinding) ? ROUND.mixed : ROUND.head, conflictOnly ? 'ci' : 'test', true)
  if (f.stop) return f.stop
  firstReview = firstReviewRange({ deltaFrom: A.deltaFrom, answers: A.answers, tip, item: A.item, pr, repoFlag: R, fix: { ...f, findingsText: listFindings(carriedOver), foldInsText: foldInsInRange(f.foldIn, f.declinedBy) } })
} else {
  firstReview = firstReviewRange({ deltaFrom: A.deltaFrom, answers: A.answers })
}
const firstStop = await reviewUntilClean(dutyOfGate.owed ? [REVIEW, GATE] : ALL, firstReview.range, firstReview.from)
if (firstStop) return firstStop
const lookStop = dutyOfGate.take ? await sampledLook() : null
if (lookStop) return lookStop

// ---------------------------- end-to-end test and CI side by side
// laneTest returns the tester's answer, null when both agents ended without a result, or a problem the lane stops on.
const explore = (n, fixRange) => runPart('lane-test', laneTest, { fixRange, delegatedLine: DELEGATED_LINE, n, pr, tip, worktree: A.worktree, scratch: A.scratch, tag: TAG, e2e: A.e2e, contract: A.contract, laneFacts, surfaceFacts: surfaceTesterFacts(), surfaced: surfaced(), blockingLine: BLOCKING_LINE, finding: FINDING, followup: REPORTED_FOLLOWUP, routing: claudeRole('test') })
// The paths the watcher's findings name; the printer keeps those among the pull request's changed files.
const findingPaths = (failing = []) => [...new Set(failing.map(finding => findingPath(finding.where)).filter(Boolean))]
// Review and tester both passed on the tip, so a CI read that stays refused leaves only the check runs for the head to read.
const provenOnTip = () => approvedOn(history, tip) && !testBlocking.length && lastTestedTip === tip
const restCheckAction = () => `without a new run: read the check runs of ${tip} with \`gh api ${REPO_API}/commits/${tip}/check-runs --paginate\` (REST, outside the GraphQL budget); once every one is completed and green, land with \`aco land ${pr} --head ${tip}\``
async function watchCi(n, rerun) {
  const watched = await runPart('lane-ci', laneCi, { delegatedLine: DELEGATED_LINE, pr, n, rerun, repo: A.repo, repoFlag: R, inRepo: IN_REPO, repoApi: REPO_API, worktree: A.worktree, finding: FINDING, mechanical: MECHANICAL })
  if (!watched || watched.problem) return watched
  const nonce = `ci-${n}-${tip}`
  const sentPaths = findingPaths(watched.failing)
  const read = await relay({ label: `ci-read-${n}`, phase: 'Test and CI', step: 'ci', relayArgs: [pr, `'${A.repo || ''}'`, `'${pathsArgument(sentPaths)}'`, `'${nonce}'`], sentPaths, nonce, requiredKeys: ['view'], brief: `${laneFacts}\nChange nothing in the files;`, watched, rerun: Boolean(rerun) })
  if (!read) return { problem: 'ended without reading the CI values' }
  if (read.problem) return { problem: `read the CI values, but their relay line ${read.problem}${printedLine(read)}` }
  if (read.unreachable) return { unreachable: read.unreachable }
  const { view } = read.values
  if (view.code !== 0) return { problem: `could not read the pull request: gh api pulls exited ${view.code}: ${view.err ?? ''}` }
  return { ...watched, ...read.ci }
}

// A red CI starts the fixer at once; the tester's answer joins the next batch, and the round awaits the tester only when CI
// has nothing of its own to fix. The tester judges the tip it started on, which later fixes may move. One tester runs at a time.
let n = 0
let testCalls = 0
let needTest = true
let lockRetried = false
let rerunRed  // the red jobs a flake dispute hands to the next watch for one re-run
function startTest() {
  startedStages.test = true
  needTest = false
  productionSinceTest = false
  trackTest(tip, explore(testCalls++, fixRangeOfTest()))
}
// Judges the pending tester's answer; returns the result that stops the lane, or undefined. A lock-busy answer is retried once, awaited when CI has nothing of its own to fix.
async function settleTest(ci, awaitRetry = true) {
  let e2e = await takePendingTest()
  if (e2e?.verdict === 'failed' && e2e.lockBusy && !lockRetried) {
    lockRetried = true
    log('the load stayed above the limit; trying the end-to-end test once more')
    startTest()
    if (!awaitRetry) return
    e2e = await takePendingTest()
  }
  const unusable = unusableTesterReason(e2e)
  if (unusable && e2e?.lockBusy && e2e.verdict === 'failed') {
    return openResult('awaiting-head', 'test', { reason: `load wait: the load stayed above the limit for both tries, so the end-to-end test did not run; CI of this round: ${ci && !ci.problem && !ci.unreachable ? ci.state : 'not readable'}. Start a new run with pr and tip once the load falls.` })
  }
  if (unusable) return openResult('failed', 'test', { reason: unusable })
  recordUsableTest(e2e)
  // A PASS on a tip a fix has since changed in production is stale: a new tester runs on the current tip.
  if (productionSinceTest) needTest = true
  if (e2e.verdict === 'PASS') return await storeProvenPoint()
}
while (true) {
  phase('Test and CI')
  const testBeginStop = needTest && !pendingTest ? await beginRun() : null
  if (testBeginStop) return testBeginStop
  if (needTest && !pendingTest) startTest()
  const rerunBatch = rerunRed
  const ci = await watchCi(n, rerunBatch?.red)
  rerunRed = undefined
  n++
  if (!ci || ci.problem || ci.unreachable) {
    const stop = pendingTest && await settleTest(ci)
    if (ci?.unreachable) return stop || await openResult('awaiting-head', 'ci', { reason: `${ci.unreachable} Start a new run with pr ${pr} and tip ${tip} once it answers.`, ...(provenOnTip() && { requiredHeadActions: [restCheckAction()] }) })
    return stop || await openResult('failed', 'ci', ci ? { reason: `the CI watcher ${ci.problem}` } : undefined)
  }
  if (!sameCommit(ci.head, tip)) return await openResult('failed', 'ci', { reason: `the pull request head ${ci.head} is not the lane tip ${tip}` })
  const { shared, unproven, ownRed, sharedOnly } = ci
  if (pendingTest && (testSettled || ci.green || sharedOnly || ci.operatorDoor)) {
    const stop = await settleTest(ci, ci.green || sharedOnly || Boolean(ci.operatorDoor))
    if (stop) return stop
  }
  history.push({ after: spent.total, by: `ci-${n - 1}`, verdict: ci.verdict, blocking: (ci.failing || []).map(f => f.where), deterministic: (ci.failing || []).filter(f => f.deterministic === true).map(f => f.where) })
  if (ci.readError) return await openResult('failed', 'ci', { reason: ci.readError })
  if (ci.pending) return await openResult('awaiting-head', 'ci', { reason: `${ci.pending} Start a new run with pr ${pr} and tip ${tip} once CI has finished.` })
  if (unproven) return await openResult('failed', 'ci', { reason: `CI reported green, but the check listing does not prove it: ${unproven}` })
  // The one re-run of a disputed flake came back red (a red shared with main aside): the disagreement between the fixer and CI is the head's.
  if (rerunBatch && !ci.green && !sharedOnly) return await awaitHeadOnDispute(rerunBatch.fixed, rerunBatch.blocking)
  if (testBlocking.length === 0 && ci.green) {
    if (!needTest) break
    continue
  }
  if (sharedOnly && testBlocking.length === 0) {
    return await openResult('awaiting-head', 'ci', { reason: `the CI check(s) ${shared.map(name => '"' + name + '"').join(', ')} are red on the base branch tip too: the red is shared with main and is fixed there, so no fixer was launched. If this lane's item is that repair, start a new run with pr and tip and fixFirst.` })
  }
  if (ci.operatorDoor && testBlocking.length === 0) {
    if (needTest) continue
    return await openResult('awaiting-head', 'ci', { reason: `the only red check is the quality verdict, red because the diff holds only declared loosenings, which only the operator merges, so no fixer was launched. It waits at the operator's merge door: run \`${ci.operatorDoor}\`.` })
  }
  const taken = takeTestBlocking()
  const ciBlocking = ci.green || sharedOnly ? [] : ownRed
  const f = await fixRound(taken.concat(ciBlocking), taken.length ? 'the end-to-end test and CI' : 'CI', taken.length ? ROUND.mixed : ROUND.ci, ci.green || sharedOnly ? 'test' : 'ci')
  if (f.stop) return f.stop
  if (f.flakes) {
    const ownJobs = (ci.red || []).filter(job => !shared.includes(job.name))
    if (!(ownJobs.length && ownJobs.every(job => job.runId && job.jobId))) return await awaitHeadOnDispute(f.fixed, ciBlocking)
    flakeRerunUsed = true
    followups.push(...f.flakes)
    adoptFixerTip(f.fixed)
    rerunRed = { red: ownJobs, fixed: f.fixed, blocking: ciBlocking }
    continue
  }
  const stop = f.range && await reviewUntilClean(f.gateAgain ? ALL : [REVIEW], f.range, f.deltaFrom)
  if (stop) return stop
  // The tester runs again when it had failed or when any fix since its last run (a review fix included) touched production.
  // A clean merge of main alone does not re-run it: the integrated tree is then proven by CI, not by the tester. CI always runs again.
  needTest ||= taken.length > 0 || productionSinceTest
}

// A pull request still titled as the unfinished checkpoint gets the item's title and a draft is marked ready, by one relay step; a failed write or an unreadable draft flag is the head's, because aco land refuses a draft.
async function checkpointRenameActions() {
  const relayed = await relay({ label: 'retitle', phase: 'Title', step: 'retitle', relayArgs: [pr, A.item, `'${A.repo || ''}'`, "'retitle'"], nonce: 'retitle', requiredKeys: ['pull'], brief: `${laneFacts}\nChange nothing in the files;` })
  const renameProblem = checkpointRenameProblem(relayed, A.item)
  const readyProblem = draftReadyProblem(relayed)
  return [
    ...(renameProblem ? [`rename pull request #${pr} to the title of item #${A.item} (gh api -X PATCH ${REPO_API}/pulls/${pr} -f title=...): it still carries the checkpoint title and the lane's write failed: ${renameProblem}`] : []),
    ...(readyProblem ? [`mark pull request #${pr} ready with \`gh pr ready ${pr}\`: aco land refuses a draft, and ${readyProblem}`] : []),
  ]
}

const rescopeCommand = 'aco rescope ' + A.item + ' ' + passedOutsidePaths.map(path => '--add ' + shellQuoted(path)).join(' ')
const stillOpen = openFollowups()
// A clean merge of main moves the tip without a verdict, and aco refuses a landing whose head the record's last verdict did not judge.
const lastJudged = lastVerdictSha(history)
if (lastJudged !== tip) return await openResult('awaiting-head', 'record', { reason: `the tip ${tip} carries commits no review or gate verdict judged (the last verdict judged ${lastJudged ?? 'nothing'}), so aco would refuse to land it. Start a new run with pr ${pr} and tip ${tip} for a review of the whole lane.` })
const finalRoutingLine = await routingLine()
const finalRecord = await writeRecord()
// The landing needs the file aco accepts, so a record that fails its check leaves the lane for the head.
if (finalRecord.problem) return await openResult('awaiting-head', 'record', { reason: `${finalRecord.problem}. Start a new run with pr ${pr} and tip ${tip}.` })
const refusedAdd = await addRecord(finalRecord)
if (refusedAdd) return await openResult('awaiting-head', 'record', { reason: refusedAddReason(refusedAdd, 'ready-to-land') })
return {
  status: 'ready-to-land', pr, tip, spent, routing: ROUTING, ...(OPERATOR_WORD && { operatorWord: OPERATOR_WORD }), routingLine: finalRoutingLine, ...recordView(finalRecord, began), history, followups: stillOpen, raisedBeforeTip: raisedBeforeTip(stillOpen), folded: [...folded.values()], disputed,
  ...gateUnseenView(), ...sampledView(), pathsOutsideClaim: passedOutsidePaths,
  requiredHeadActions: [
    ...(passedOutsidePaths.length ? [`write these paths into the scope of item #${A.item}'s body (and a one-sentence whole there when the combined scope is wide), then run \`${rescopeCommand}\` from ${A.worktree} before landing: these paths are outside the claim and passed the scope check`] : []),
    ...await checkpointRenameActions(),
    `land with \`aco land ${pr} --head ${tip}\` only while the pull request head is still ${tip}`,
    ...(OPERATOR_WORD ? [`quote the operatorWord with its source in the body of pull request #${pr}: the lane may have run above the effort cap or on fable on the operator's word`] : []),
    ...(MATERIAL && isGateStandIn('gate', ROUTING.gate.model, ROUTING.gate.effort) ? [`name the Opus 5.5 stand-in as the final gate in the body of pull request #${pr}: ${gateRefused ? 'Codex refused the gate model' : 'the lane ran no Codex gate'}`] : []),
    ...(gateUnseen ? [`name ${gateUnseen.seenTip}..${tip} in the body of pull request #${pr}: the final gate, at its usage limit, did not see that range`] : []),
    ...(raisedBeforeTip(stillOpen).length ? ['re-check the follow-ups in raisedBeforeTip against the returned tip before routing them'] : []),
    ...(stillOpen.length ? [`route ${stillOpen.length} follow-up(s) to their owning items before landing`] : []),
    `update the body of item #${A.item}'s parent and name what the landing freed`,
  ],
}
