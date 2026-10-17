// Drives the atelier lane workflow script through its inputs with a stub agent runner, so no subagent ever starts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const LANE_SCRIPT = new URL('../plugins/atelier/workflows/lane.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// answers holds each agent's result by its label; an agent without one ends without a result. Without answers only
// the sync step answers (an up-to-date lane), so a run gets as far as starting its first review round.
async function runLane(args, answers = {}) {
  const source = fs.readFileSync(LANE_SCRIPT, 'utf8').replace(/^export const meta/m, 'const meta')
  const launchedAgents = []
  const agentCalls = {}
  const cleanSync = { merged: false, tip: args.tip, stoppedOnConflict: false }
  const coveredByClaim = { outside_claim: '[]' }
  const defaultAnswerFor = (label) => label === 'sync' ? cleanSync : label.startsWith('scope-') ? coveredByClaim : null
  // The remote branch carries the newest tip a builder or fixer returned, unless a test says what the push printed
  // or the answer carries the error of a failed push.
  let newestTip = args.tip
  const pushPrintedSomething = (answer) => !answer.command_error || 'remote_tip' in answer
  const answerFor = (label) => {
    const answer = label in answers ? structuredClone(answers[label]) : defaultAnswerFor(label)
    if (answer?.tip && /^(build|fix-|sync)/.test(label)) newestTip = answer.tip
    return label.startsWith('scope-') && answer && pushPrintedSomething(answer) ? { remote_tip: newestTip, ...answer } : answer
  }
  const agent = async (prompt, options = {}) => { launchedAgents.push(options.label); agentCalls[options.label] = { prompt, options }; return answerFor(options.label) }
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk()))
  const ignore = () => {}
  const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', source)
  const result = await run(args, agent, parallel, async () => [], ignore, ignore)
  return { result, launchedAgents, agentCalls }
}

const resumedLane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip: 'abcdef0' }

const misspelledChoices = [
  ['risk', 'Material'], ['risk', 'MATERIAL'], ['risk', 'high'],
  ['reviewer', 'Codex'], ['reviewer', 'terra'],
]
for (const [name, value] of misspelledChoices) {
  test(`refuses ${name} ${JSON.stringify(value)} before any agent starts`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, [name]: value })
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'input')
    assert.deepEqual(launchedAgents, [])
  })
}

const refusedRoutings = [
  ['an unknown role', { janitor: { effort: 'low' } }],
  ['an unknown model', { build: { model: 'gpt-5.6-terra' } }],
  ['an effort above the ceiling', { fix: { effort: 'xhigh' } }],
  ['a gate on the builder\'s provider', { gate: { model: 'opus' } }],
  ['a Claude review model for a Codex reviewer', { review: { model: 'sonnet' }, __reviewer: 'codex' }],
  ['a Codex builder', { build: { model: 'gpt-6-astra' } }],
  ['an inherited property name as the gate model', { gate: { model: 'constructor' } }],
  ['a non-string model', { build: { model: ['sonnet'] } }],
  ['an inherited property name as the role', { constructor: { effort: 'low' } }],
]
for (const [what, routing] of refusedRoutings) {
  test(`#90 AC-routing-refusal: refuses a routing override with ${what} before any agent starts`, async () => {
    const { __reviewer, ...overrides } = routing
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk: 'material', reviewer: __reviewer, routing: overrides })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

const defaultRoutingByRole = [
  ['sync', 'haiku', 'low'], ['r0-review', 'sonnet', 'medium'],
]
for (const [label, model, effort] of defaultRoutingByRole) {
  test(`#90 AC-default-routing: ${label} runs on ${model} at ${effort} effort by default`, async () => {
    const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
    assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], [model, effort])
  })
}

test('#90 AC-default-routing: the build, fix and test agents run on sonnet at medium effort by default', async () => {
  const { agentCalls } = await runLane({ ...webauthReplay.args, build: 'b' }, answersWith(webauthReplay, { kind: 'test-gap', mutation: true }))
  for (const label of ['build', 'fix-1', 'e2e-0']) {
    assert.deepEqual([agentCalls[label].options.model, agentCalls[label].options.effort], ['sonnet', 'medium'], label)
  }
})

test('#90 AC-gate-separation: a Claude builder gets the Codex gpt-6-astra gate at high effort', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  const gatePrompt = agentCalls['r0-gate'].prompt
  assert.match(gatePrompt, /-m gpt-6-astra -c model_reasoning_effort=high/)
  assert.doesNotMatch(gatePrompt, /terra|sol/i)
})

test('#128 AC-gate-revise-kept: the courier brief returns a REVISE from a clean Codex exit unchanged and never as failed', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, risk: 'material' })
  assert.match(agentCalls['r0-gate'].prompt, /holds 0 and .* is valid JSON, return its verdict, blocking and followups UNCHANGED.*a REVISE with blocking findings is never failed/s)
})

test('#90 AC-codex-reviewer: a Codex reviewer runs gpt-6-astra at medium effort', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, reviewer: 'codex' })
  assert.match(agentCalls['r0-review'].prompt, /-m gpt-6-astra -c model_reasoning_effort=medium/)
})

test('#90 AC-override: a routing override sets a role\'s model and effort within the ceiling', async () => {
  const { agentCalls } = await runLane({ ...resumedLane, routing: { review: { model: 'opus', effort: 'high' } } })
  assert.deepEqual([agentCalls['r0-review'].options.model, agentCalls['r0-review'].options.effort], ['opus', 'high'])
})

test('#90 AC-remeasure: every lane result records each role\'s model and effort and which stage found each blocking finding', async () => {
  const replay = webauthReplay
  const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
  assert.deepEqual(result.routing.gate, { model: 'gpt-6-astra', effort: 'high' })
  assert.deepEqual(result.routing.build, { model: 'sonnet', effort: 'medium' })
  assert.deepEqual(result.history.find(entry => entry.by === 'gate').blocking, ['src/webauth/oidc.py:315'])
})

test('#103 AC-remeasure-test-and-ci: the e2e and CI history entries carry their blocking locations', async () => {
  const replay = webauthReplay
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['e2e-0'] = { verdict: 'FAIL', blocking: [finding('probe: login redirect', 'the redirect loses the state')], followups: [] }
  answers['ci-0'] = { head: webauthTips.secondFix, green: false, failing: [finding('ci: lint', 'ruff fails')] }
  const { result } = await runLane(replay.args, answers)
  assert.deepEqual(result.history.find(entry => entry.by === 'e2e-0').blocking, ['probe: login redirect'])
  assert.deepEqual(result.history.find(entry => entry.by === 'ci-0').blocking, ['ci: lint'])
})

test('#90 AC-reviewer-stopgap: a reviewer brief carries the stopgap refusals and narrows test-gap to a behaviour without a test', async () => {
  const { agentCalls } = await runLane(resumedLane)
  const brief = agentCalls['r0-review'].prompt
  assert.match(brief, /800 lines or more/)
  assert.match(brief, /criterion ID or `defect:#n`/)
  assert.match(brief, /a behaviour has no test/)
  assert.match(brief, /Hygiene in test code .* is a \*\*defect\*\* whose proof is the diff/)
})

const firstReviewRoundByRisk = [
  [undefined, ['r0-review']],
  ['normal', ['r0-review']],
  ['material', ['r0-review', 'r0-gate']],
]
for (const [risk, reviewers] of firstReviewRoundByRisk) {
  test(`risk ${JSON.stringify(risk)} passes input and starts the reviews ${reviewers.join(' and ')}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumedLane, risk })
    assert.notEqual(result.stage, 'input')
    assert.deepEqual(launchedAgents, ['sync', 'scope-resume', ...reviewers])
  })
}

// Two recorded lane runs that stopped at a fix (journals wf_ef1e8c59-bcb and wf_a3d28910-a89), keyed by agent label.
// Tips, files, finding wheres, verdicts and proofs are copied as recorded; the prose of findings and follow-ups, and
// some follow-up wheres, are shortened.
// Each fixer proved an honest test-gap finding with a mutation it reported only in prose, so the guard stopped the run.
const APPROVE = { verdict: 'APPROVE', blocking: [], followups: [] }
const PASS = { verdict: 'PASS', blocking: [], followups: [] }
const greenCi = (head) => ({ head, green: true, failing: [] })
const finding = (where, text) => ({ where, text, rule: 'recorded rule', evidence: 'recorded evidence' })
const followup = (where, text, owner) => ({ where, text, owner })

const webauthTips = { built: '7ac1653ab10c05e6b41a393d47a586a2bacb9640', firstFix: 'd7e50a7509ea87793fed5bdbabcf7df3955bc893', secondFix: '307742391d346d4579400c733ef7adbdeea5ef79' }
const webauthC1Finding = 'src/webauth/jwt_verification.py:65 (_URL_CONTROL_OR_SPACE) via is_https_url, reached through OidcClientConfig.__post_init__ (src/webauth/oidc.py:73-92)'
const webauthReplay = {
  name: 'webauth#57',
  args: { item: 57, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r1-gate', fixedBy: 'fix-2', where: 'tests/test_oidc.py:479', mutation: 'drop quote_plus from the client-ID part of the Basic authorization only' },
  nextReview: 'r2-review',
  // The fix-in-place follow-ups by the fix that carried them, and how many follow-ups the head still routes when the lane is ready.
  foldIns: {
    accepted: {
      folded: [['src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', webauthTips.firstFix], ['README.md:433-434 (OpenID Connect login paragraph)', webauthTips.firstFix], ['src/webauth/jwt_verification.py:365-372 (is_https_url)', webauthTips.secondFix]],
      open: [],
    },
    stopped: {
      folded: [['src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', webauthTips.firstFix], ['README.md:433-434 (OpenID Connect login paragraph)', webauthTips.firstFix]],
      open: ['src/webauth/jwt_verification.py:365-372 (is_https_url)'],
    },
  },
  followupsToRoute: 3,
  answers: {
    build: { pr: 58, tip: webauthTips.built, blocked: false },
    'r0-review': {
      verdict: 'REVISE',
      blocking: [
        finding('src/webauth/oidc.py:340-356 (_is_same_secret, _callback_parameters) via OidcRelyingParty.complete_login', 'complete_login raises UnicodeEncodeError on a hostile callback'),
        finding('tests/test_oidc.py:70-72, 463-476 (token request test) and 230-291 (_CALLBACK_REFUSALS)', 'Two behaviours this diff implements have no test that pins them'),
      ],
      followups: [
        followup('src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', 'Follow-up (fix in place): the default repr prints the whole token body', '#57'),
        followup('README.md:433-434 (OpenID Connect login paragraph)', 'Follow-up (fix in place): the README leaves out that any azp must name the client', '#57'),
        followup("CLAUDE.md 'Code patterns'", 'The guidance names only one of the two arrangement modules', 'distributor'),
        followup('AGENTS.md:35-38 / .importlinter', 'The import claims are not enforced', '#49'),
      ],
    },
    'r0-gate': { verdict: 'REVISE', blocking: [finding('src/webauth/oidc.py:315', 'OidcClientConfig accepts endpoint URLs containing control characters')], followups: [], codexExit: 0 },
    'fix-1': {
      oldTip: webauthTips.built, mergedBase: '1a0864b704b6717b660951357191f1562af7802e', tip: webauthTips.firstFix, mergeResolvedLaneConflict: true, disputed: [], blocked: false,
      files: ['README.md', 'pyproject.toml', 'src/webauth/__init__.py', 'src/webauth/config.py', 'src/webauth/jwt_verification.py', 'src/webauth/liveness.py', 'src/webauth/oidc.py', 'tests/test_jwt_verification.py', 'tests/test_liveness.py', 'tests/test_oidc.py', 'tests/test_web_auth_config.py', 'uv.lock'],
      regression: [
        { finding: 'src/webauth/oidc.py:340-356 (_is_same_secret, _callback_parameters) via OidcRelyingParty.complete_login', kind: 'defect', test: 'tests/test_oidc.py [lone-surrogate-not-percent-encoded]', failedBefore: true, passesAfter: true },
        { finding: 'tests/test_oidc.py:70-72, 463-476 (token request test) and 230-291 (_CALLBACK_REFUSALS)', kind: 'test-gap', test: 'tests/test_oidc.py [secret-form-encoded-before-basic-encoding]', failedBefore: true, passesAfter: true },
        { finding: 'src/webauth/oidc.py:315', kind: 'defect', test: 'tests/test_oidc.py [redirect-uri-with-a-carriage-return-in-its-path]', failedBefore: true, passesAfter: true },
      ],
    },
    'r1-review': {
      verdict: 'REVISE',
      blocking: [finding(webauthC1Finding, 'C1 control characters are still accepted and stored')],
      followups: [
        followup('src/webauth/jwt_verification.py:365-372 (is_https_url)', 'follow-up (fix in place). A non-str argument now raises a bare TypeError', '#57'),
        followup('overnightworks/webauth#57 body, claim-scope line for src/webauth/jwt_verification.py', 'The body says this lane only renames the function', '#57'),
      ],
    },
    'r1-gate': {
      verdict: 'REVISE', codexExit: 0, followups: [],
      blocking: [
        finding('src/webauth/jwt_verification.py:65', 'Endpoint validation still accepts C1 controls U+0080–U+009F'),
        finding('tests/test_oidc.py:479', 'The Basic-auth regression test does not pin the form-encoding of client_id'),
      ],
    },
    'fix-2': {
      oldTip: webauthTips.firstFix, mergedBase: webauthTips.firstFix, tip: webauthTips.secondFix, mergeResolvedLaneConflict: false, disputed: [], blocked: false,
      files: ['src/webauth/jwt_verification.py', 'src/webauth/oidc.py', 'tests/test_jwt_verification.py', 'tests/test_oidc.py'],
      regression: [
        { finding: webauthC1Finding, kind: 'defect', test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 'src/webauth/jwt_verification.py:65', kind: 'defect', test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 'tests/test_oidc.py:479', kind: 'test-gap', test: 'tests/test_oidc.py [client-id-form-encoded-before-basic-encoding]', failedBefore: false, passesAfter: true },
        { finding: 'src/webauth/jwt_verification.py:365-372 (is_https_url) follow-up', kind: 'defect', test: 'tests/test_jwt_verification.py [key-set-url-not-a-string]', failedBefore: true, passesAfter: true },
      ],
    },
    'r2-review': APPROVE,
    'r2-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(webauthTips.secondFix),
  },
}

const agentProvidersTips = { built: 'adfb04bc5b1f543f6060709047570d92550f905d', fix: '7c543ba55440b4d743eecf18aa9a1520aadeda55' }
const agentProvidersReplay = {
  name: 'agent-providers#25',
  args: { item: 25, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r0-gate', fixedBy: 'fix-1', where: 'tests/test_sse_codec.py:58', mutation: 'encode_event writes the event line before the id line' },
  nextReview: 'r1-gate',
  foldIns: {
    accepted: {
      folded: [['packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', agentProvidersTips.fix], ['docs/decisions/0001-agent-service.md:238-246 (ruling f)', agentProvidersTips.fix]],
      open: [],
    },
    stopped: {
      folded: [],
      open: ['packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', 'docs/decisions/0001-agent-service.md:238-246 (ruling f)'],
    },
  },
  followupsToRoute: 4,
  answers: {
    build: { pr: 26, tip: agentProvidersTips.built, blocked: false },
    'r0-review': {
      verdict: 'APPROVE', blocking: [],
      followups: [
        followup('packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', 'follow-up (fix in place). The valid tool_use_id rule is declared twice', 'follow-up (fix in place)'),
        followup('docs/decisions/0001-agent-service.md:238-246 (ruling f)', 'follow-up (fix in place). Ruling (f) names only "any other field" as malformed_frame', 'follow-up (fix in place)'),
        followup('packages/agent-client/src/agent_client/run_stream.py:96-104 (_violation_from)', 'Pre-existing. Violation details copy unbounded text', 'distributor'),
        followup('packages/agent-client/src/agent_client/sse.py:45 (encode_event)', 'Pre-existing model laxity the encoder makes visible', '#18'),
        followup('packages/agent-client/src/agent_client/run_stream.py:144-162 and :209-224', 'Ownership note (pre-existing): one rule lives in two places', 'distributor'),
        followup('tests/test_sse_codec.py:35-60 vs tests/test_wire_protocol.py:67-297', 'The test helpers are copied rather than shared', 'distributor'),
      ],
    },
    'r0-gate': { verdict: 'REVISE', blocking: [finding('tests/test_sse_codec.py:58', 'Add a literal expected-bytes assertion for a representative non-ASCII event')], followups: [], codexExit: 0 },
    'fix-1': {
      oldTip: agentProvidersTips.built, mergedBase: agentProvidersTips.built, tip: agentProvidersTips.fix, mergeResolvedLaneConflict: false, disputed: [], blocked: false,
      files: ['docs/decisions/0001-agent-service.md', 'packages/agent-client/src/agent_client/wire.py', 'tests/test_sse_codec.py'],
      regression: [{ finding: 'tests/test_sse_codec.py:58', kind: 'test-gap', test: 'tests/test_sse_codec.py::test_an_event_travels_as_one_frame_of_compact_utf8_json', failedBefore: false, passesAfter: true }],
    },
    'r1-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(agentProvidersTips.fix),
  },
}
const replays = [webauthReplay, agentProvidersReplay]

const gateRevise = agentProvidersReplay.answers['r0-gate']
const contradictoryCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 0, note: 'Verdict was REVISE, not failed' }
const courierAnswersByExit = [
  ['a REVISE with a clean Codex exit goes to a fixer', { ...gateRevise, codexExit: 0 }, undefined, ['ready-to-land', undefined], true, 0],
  ['a REVISE without a clean Codex exit stops the lane', { ...gateRevise, codexExit: 1 }, undefined, ['failed', 'review'], false, 0],
  ['a failed courier without a marker stops the lane', { verdict: 'failed', blocking: [], followups: [], codexExit: -1, note: 'no marker' }, undefined, ['failed', 'review'], false, 0],
  ['a failed courier with a clean exit is re-read once and the re-read REVISE goes to a fixer', contradictoryCourier, { ...gateRevise, codexExit: 0 }, ['ready-to-land', undefined], true, 1],
  ['a failed courier with a clean exit whose re-read fails again stops the lane', contradictoryCourier, contradictoryCourier, ['failed', 'review'], false, 1],
]
for (const [what, gateAnswer, rereadAnswer, outcome, reachesFixer, rereads] of courierAnswersByExit) {
  test(`#128 AC-gate-revise-reaches-fixer: ${what}`, async () => {
    const answers = { ...agentProvidersReplay.answers, 'r0-gate': gateAnswer, ...(rereadAnswer && { 'r0-gate-reread': rereadAnswer }) }
    const { result, launchedAgents } = await runLane(agentProvidersReplay.args, answers)
    assert.deepEqual([result.status, result.stage], outcome)
    assert.equal(launchedAgents.includes('fix-1'), reachesFixer)
    assert.equal(launchedAgents.filter(label => label.startsWith('r0-gate-reread')).length, rereads)
  })
}

test('#128 AC-courier-final-action: the courier and its re-read name StructuredOutput as their only final action', async () => {
  const { agentCalls } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'r0-gate': contradictoryCourier, 'r0-gate-reread': { ...gateRevise, codexExit: 0 } })
  for (const label of ['r0-gate', 'r0-gate-reread']) {
    assert.match(agentCalls[label].prompt, /only final action is the StructuredOutput call.*verbatim.*never write a text answer first/s, label)
  }
})

// The recorded answers as a reviewer and fixer briefed with finding kinds would give them: the test-gap finding
// carries the kind its reviewer gives it, and its proof the mutation its fixer reported. The other options vary
// that proof: whether it passes after the fix, whether it names the finding's where exactly, a near match of it,
// or is left out, and whether the fixer adds a failing proof for a where no blocking finding has (its fold-in's).
function answersWith(replay, { kind, mutation, testDraft = false, passesAfter = true, proof = 'exact', strayProof = false, proofKind, failedBefore }) {
  const answers = structuredClone(replay.answers)
  const { raisedBy, fixedBy, where } = replay.testGap
  const testGap = answers[raisedBy].blocking.find(f => f.where === where)
  if (kind) testGap.kind = kind
  if (testDraft) testGap.testDraft = '/s/draft_test.py'
  const regression = answers[fixedBy].regression
  const testGapProof = regression.find(recorded => recorded.finding === where)
  testGapProof.kind = proofKind || testGap.kind || 'defect'
  if (mutation) testGapProof.mutation = replay.testGap.mutation
  testGapProof.passesAfter = passesAfter
  if (failedBefore !== undefined) testGapProof.failedBefore = failedBefore
  if (proof === 'near-match') testGapProof.finding = `${where} (test)`
  if (proof === 'omitted') regression.splice(regression.indexOf(testGapProof), 1)
  if (strayProof) regression.push({ finding: replay.foldIns.accepted.folded.at(-1)[0], test: 'fold-in test', failedBefore: false, passesAfter: false })
  return answers
}

const proofsByKind = [
  ['a resumed run whose findings carry no kind stops at the fix as before', { kind: undefined, testDraft: true, mutation: true }, false],
  ['#103 AC-proof-matches-its-finding: a defect with a test draft whose test did not fail before stops at the fix', { kind: 'defect', testDraft: true, mutation: true }, false],
  ['#103 AC-proof-matches-its-finding: a test-gap whose only proof names another kind stops at the fix', { kind: 'test-gap', mutation: true, proofKind: 'defect' }, false],
  ['#103 AC-pre-fix-mutation: a test-gap whose test failed on the pre-fix code needs no named mutation and moves past the fix', { kind: 'test-gap', mutation: false, failedBefore: true }, true],
  ['a test-gap without a named mutation stops at the fix', { kind: 'test-gap', mutation: false }, false],
  ['a test-gap whose test does not pass after the fix stops at the fix', { kind: 'test-gap', mutation: true, passesAfter: false }, false],
  ['a test-gap without any proof stops at the fix', { kind: 'test-gap', proof: 'omitted' }, false],
  ['a test-gap whose proof names only a near match of its where stops at the fix', { kind: 'test-gap', mutation: true, proof: 'near-match' }, false],
  ['a test-gap proven by a named mutation moves past the fix', { kind: 'test-gap', mutation: true }, true],
  ['a failing proof for a where no blocking finding has is ignored and the run moves past the fix', { kind: 'test-gap', mutation: true, strayProof: true }, true],
  ['#90 AC-hygiene-defect: a hygiene defect proven by the diff needs no mutation and moves past the fix', { kind: 'defect', mutation: false, proof: 'omitted' }, true],
  ['a docs finding needs no test and moves past the fix', { kind: 'docs', mutation: false }, true],
  ['a docs finding with a test draft needs no test either and moves past the fix', { kind: 'docs', testDraft: true, proof: 'omitted' }, true],
]
for (const replay of replays) {
  for (const [behaviour, labels, movesOn] of proofsByKind) {
    test(`${replay.name} replay: ${behaviour}`, async () => {
      const { result, launchedAgents } = await runLane(replay.args, answersWith(replay, labels))
      if (movesOn) {
        assert.equal(result.status, 'ready-to-land')
        assert.ok(launchedAgents.includes(replay.nextReview))
      } else {
        assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
        assert.deepEqual(result.lastBlocking.map(f => f.where), [replay.testGap.where])
      }
    })
  }
}

const fixOutcomes = [
  ['accepted', { kind: 'test-gap', mutation: true }],
  ['stopped', { kind: undefined, testDraft: true, mutation: false }],
]
for (const replay of replays) {
  for (const [outcome, labels] of fixOutcomes) {
    test(`${replay.name} replay: a fold-in counts as folded, with its tip, only once its fix is accepted (${outcome} fix)`, async () => {
      const { result } = await runLane(replay.args, answersWith(replay, labels))
      const expected = replay.foldIns[outcome]
      const openWheres = result.followups.map(f => f.where)
      assert.deepEqual(result.folded.map(f => [f.where, f.tip]), expected.folded)
      for (const [where] of expected.folded) assert.ok(!openWheres.includes(where), `${where} is still open`)
      for (const where of expected.open) assert.ok(openWheres.includes(where), `${where} is not open`)
    })
  }

  test(`${replay.name} replay: a ready lane asks the head to route only the follow-ups still open`, async () => {
    const { result } = await runLane(replay.args, answersWith(replay, { kind: 'test-gap', mutation: true }))
    assert.equal(result.followups.length, replay.followupsToRoute)
    assert.ok(result.requiredHeadActions.includes(`route ${replay.followupsToRoute} follow-up(s) to their owning items before landing`))
  })
}

test('a fix that only merged main folds nothing in, so the head still routes the fold-in it was handed', async () => {
  const built = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
  const merged = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
  const foldIn = followup('x.py:1', 'tidy', 'follow-up (fix in place)')
  const conflicting = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }
  const { result } = await runLane({ ...webauthReplay.args, build: 'b' }, {
    build: { pr: 2, tip: built, blocked: false },
    'r0-review': { ...APPROVE, followups: [foldIn] },
    'r0-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': { head: built, green: false, failing: [conflicting] },
    'fix-1': { oldTip: built, mergedBase: merged, tip: merged, mergeResolvedLaneConflict: false, files: [], disputed: [], blocked: false },
    'ci-1': greenCi(merged),
  })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(result.folded, [])
  assert.deepEqual(result.followups, [{ ...foldIn, tip: built }])
  assert.ok(result.requiredHeadActions.includes('route 1 follow-up(s) to their owning items before landing'))
})

test('a stopped fix reports the fold-ins its fixer found already done, and leaves them open', async () => {
  const replay = agentProvidersReplay
  const answers = answersWith(replay, { kind: undefined, testDraft: true, mutation: false })
  const resolved = [{ where: replay.foldIns.stopped.open[0], text: 'done by an earlier fixer' }]
  answers[replay.testGap.fixedBy].resolved = resolved
  const { result } = await runLane(replay.args, answers)
  assert.deepEqual(result.resolved, resolved)
  assert.ok(result.followups.some(f => f.where === resolved[0].where))
})

const resumeTip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const resumeFixedTip = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1'
const tidy = followup('x.py:1', 'tidy the import order', 'follow-up (fix in place)')
const defectWithoutDraft = { ...finding('t.py:1', 'the code breaks the rule'), kind: 'defect' }
const resumeFix = { oldTip: resumeTip, mergedBase: resumeTip, tip: resumeFixedTip, mergeResolvedLaneConflict: false, files: ['x.py'], disputed: [], blocked: false }
const resumeArgs = { ...resumedLane, tip: resumeTip }

const resumesByHandedOver = [
  ['foldIn alone', { foldIn: [tidy] }, ['sync', 'scope-resume', 'fix-1', 'scope-1', 'r1-review']],
  ['foldIn alone with deltaFrom', { foldIn: [tidy], deltaFrom: resumeTip }, ['sync', 'scope-resume', 'fix-1', 'scope-1', 'r1-review']],
  ['neither foldIn nor fixFirst', {}, ['sync', 'scope-resume', 'r0-review']],
]
for (const [handedOver, args, expectedAgents] of resumesByHandedOver) {
  test(`a resume with ${handedOver} runs ${expectedAgents.slice(1).join(' then ')}`, async () => {
    const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, ...args }, { 'fix-1': resumeFix })
    assert.deepEqual(launchedAgents.slice(0, expectedAgents.length), expectedAgents)
    if (args.foldIn) assert.match(agentCalls['fix-1'].prompt, /tidy the import order/)
  })
}

test('a resume gives the fixer every foldIn the head names, whatever its owner or wording', async () => {
  const named = followup('x.py:1', 'tidy the import order', '#57')
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [named] }, { 'fix-1': resumeFix })
  assert.match(agentCalls['fix-1'].prompt, /tidy the import order/)
})

test('a fixer given only fold-ins is told there are no blocking findings', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': resumeFix })
  assert.match(agentCalls['fix-1'].prompt, /There are no blocking findings; your whole task is the follow-ups below/)
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /and nothing else/)
})

const alsoTidy = followup('y.py:2', 'rename the helper', 'follow-up (fix in place)')
const unchangedFix = { ...resumeFix, tip: resumeTip, files: [], regression: [] }
const satisfied = (item, evidence = 'tests/x_test.py already pins it') => ({ where: item.where, text: item.text, evidence })
const reachesTheEnd = { 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

const satisfiedFoldIns = [
  ['one fold-in', [tidy], [satisfied(tidy)]],
  ['two fold-ins', [tidy, alsoTidy], [satisfied(tidy), satisfied(alsoTidy, 'probe cell 4 proves it')]],
]
for (const [what, foldIn, resolved] of satisfiedFoldIns) {
  test(`#119 AC-satisfied-counts-as-folded: ${what} the fixer proves already satisfied at an unchanged tip are folded with its evidence and the lane goes on`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn }, { 'fix-1': { ...unchangedFix, resolved }, ...reachesTheEnd })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.deepEqual(result.folded, foldIn.map((f, i) => ({ ...f, tip: resumeTip, evidence: resolved[i].evidence })))
    assert.deepEqual(result.followups, [])
    assert.ok(launchedAgents.includes('e2e-0'))
  })
}

const mainMovedTip = 'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3'
const satisfiedAcrossMovedMain = [
  ['main moved and the lane has no change of its own past the merge', { mergedBase: mainMovedTip, tip: mainMovedTip }, true],
  ['main moved but the returned tip is not the merge', { mergedBase: mainMovedTip, tip: resumeTip }, false],
]
for (const [what, shape, goesOn] of satisfiedAcrossMovedMain) {
  test(`#119 AC-satisfied-counts-as-folded: every fold-in satisfied with ${what} ${goesOn ? 'goes on with the merge as the tip' : 'stops at fix'}`, async () => {
    const answers = { 'fix-1': { ...unchangedFix, ...shape, resolved: [satisfied(tidy)] }, 'e2e-0': PASS, 'ci-0': greenCi(mainMovedTip) }
    const { result, launchedAgents } = await runLane({ ...resumeArgs, foldIn: [tidy] }, answers)
    assert.deepEqual([result.status, result.stage], goesOn ? ['ready-to-land', undefined] : ['failed', 'fix'])
    assert.equal(launchedAgents.some(label => label.includes('review')), false)
    if (goesOn) assert.deepEqual(result.folded.map(f => f.tip), [mainMovedTip])
  })
}

const stopsDespiteResolved = [
  ['a fold-in the fixer leaves out of resolved', { foldIn: [tidy, alsoTidy] }, [satisfied(tidy)]],
  ['nothing listed in resolved', { foldIn: [tidy] }, []],
  ['a fold-in listed without evidence', { foldIn: [tidy] }, [satisfied(tidy, '')]],
  ['a fold-in listed with blank evidence', { foldIn: [tidy] }, [satisfied(tidy, '  ')]],
  ['blocking findings, however much the fixer lists', { foldIn: [tidy], fixFirst: [defectWithoutDraft] }, [satisfied(tidy)]],
]
for (const [what, args, resolved] of stopsDespiteResolved) {
  test(`#119 AC-evidence-or-stop: a fixer that changes nothing with ${what} still stops at fix`, async () => {
    const { result } = await runLane({ ...resumeArgs, ...args }, { 'fix-1': { ...unchangedFix, resolved } })
    assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
    assert.match(result.reason, /the fixer changed nothing/)
    assert.deepEqual(result.folded, [])
    assert.ok(result.followups.some(f => f.where === tidy.where))
  })
}

test('#119 AC-satisfied-counts-as-folded: with deltaFrom, the review after satisfied fold-ins still sees everything since deltaFrom', async () => {
  const answers = { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, ...reachesTheEnd }
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy], deltaFrom: resumeTip }, answers)
  assert.ok(agentCalls['r1-review'].prompt.includes(`git diff ${resumeTip}..HEAD`), agentCalls['r1-review'].prompt)
})

test('#119 AC-mixed-batch-folds-all: a batch with one fold-in committed and one already satisfied folds both, the satisfied one with its evidence', async () => {
  const resolved = [satisfied(alsoTidy)]
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy, alsoTidy] }, { 'fix-1': { ...resumeFix, resolved }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land')
  assert.deepEqual(result.folded, [{ ...tidy, tip: resumeFixedTip }, { ...alsoTidy, tip: resumeFixedTip, evidence: resolved[0].evidence }])
})

test('#119 AC-resolved-carries-evidence: the fixer is told to list every fold-in already done with its evidence, and the schema requires it', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': resumeFix })
  const { prompt, options } = agentCalls['fix-1']
  assert.match(prompt, /already satisfied[^]*resolved[^]*evidence/)
  assert.ok(options.schema.properties.resolved.items.required.includes('evidence'))
})

const reviewReviseAnswers = (followups) => ({
  'r0-review': { verdict: 'REVISE', blocking: [{ ...finding('y.py:2', 'a defect'), kind: 'docs' }], followups },
  'fix-1': { ...resumeFix, regression: [] },
  'r1-review': APPROVE,
})

const deltaRangesByFoldIns = [
  ['names the fold-in the fixer was given', [tidy], true],
  ['has no fold-in section when the fixer was given none', [], false],
]
for (const [behaviour, followups, namesFoldIn] of deltaRangesByFoldIns) {
  test(`the re-checking reviewer's delta range ${behaviour}`, async () => {
    const { agentCalls } = await runLane(resumeArgs, reviewReviseAnswers(followups))
    const recheckPrompt = agentCalls['r1-review'].prompt
    assert.match(recheckPrompt, /only this delta: git diff/)
    assert.equal(/tidy the import order/.test(recheckPrompt), namesFoldIn)
    assert.equal(/these follow-ups to fold in/.test(recheckPrompt), namesFoldIn)
  })
}

test('a follow-up carries the tip it was raised at, and the result lists those raised before the returned tip separately', async () => {
  const replay = webauthReplay
  const raisedAtReturnedTip = followup('late.py:1', 'raised by the review of the returned tip', '#57')
  const answers = answersWith(replay, { kind: 'test-gap', mutation: true })
  answers['r2-review'] = { ...APPROVE, followups: [raisedAtReturnedTip] }
  const { result } = await runLane(replay.args, answers)
  assert.equal(result.tip, webauthTips.secondFix)
  const raisedAt = Object.fromEntries(result.followups.map(f => [f.where, f.tip]))
  assert.equal(raisedAt[raisedAtReturnedTip.where], webauthTips.secondFix)
  assert.equal(raisedAt['AGENTS.md:35-38 / .importlinter'], webauthTips.built)
  assert.equal(result.followups.length, replay.followupsToRoute + 1)
  const earlier = result.raisedBeforeTip.map(f => f.where)
  assert.ok(earlier.includes('AGENTS.md:35-38 / .importlinter'))
  assert.ok(!earlier.includes(raisedAtReturnedTip.where))
})

// A resumed run whose fixer answers findings handed over by the head: what each proof must show for its own finding.
const defectWithDraft = { ...finding('t.py:1', 'the code breaks the rule'), kind: 'defect', testDraft: '/s/draft_test.py' }
const testGap = { ...finding('t.py:1', 'a behaviour has no test'), kind: 'test-gap' }
const proofOf = (kind, overrides) => ({ finding: 't.py:1', kind, test: 't.py [case]', failedBefore: false, passesAfter: true, ...overrides })
const removalDiff = '-    def test_case_that_asserts_nothing(): pass'
const proofsAtOneWhere = [
  ['a defect and a test-gap at one where, each with its own proof, are each accepted', [defectWithDraft, testGap], [proofOf('defect', { failedBefore: true }), proofOf('test-gap', { mutation: 'drop the guard' })], null],
  ['one proof for the defect does not satisfy the test-gap at the same where', [defectWithDraft, testGap], [proofOf('defect', { failedBefore: true })], /test-gap finding or a defect with a test draft got no regression test/],
  ['a test-gap test that failed before the fix needs no mutation', [testGap], [proofOf('test-gap', { failedBefore: true })], null],
  ['a test-gap test without a mutation that did not fail before is rejected naming its where and the mutation', [testGap], [proofOf('test-gap')], /t\.py:1.*no mutation/],
  ['a test-gap test with a mutation that does not pass after is rejected as not passing', [testGap], [proofOf('test-gap', { mutation: 'drop the guard', passesAfter: false })], /t\.py:1.*did not pass/],
  ['a defect without a test draft needs no failing-before test', [defectWithoutDraft], [proofOf('defect')], null],
  ['a defect with a test draft still needs its test to fail before', [defectWithDraft], [proofOf('defect')], /did not fail before/],
  ['a removed vacuous test with its diff answers a test-gap', [testGap], [proofOf('test-gap', { resolution: 'removed-vacuous', diff: removalDiff })], null],
  ['a removed vacuous test without a diff is rejected', [testGap], [proofOf('test-gap', { resolution: 'removed-vacuous' })], /t\.py:1.*no diff/],
]
for (const [behaviour, fixFirst, regression, rejectedFor] of proofsAtOneWhere) {
  test(`#103 proof guard: ${behaviour}`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst }, { 'fix-1': { ...resumeFix, regression } })
    if (rejectedFor) {
      assert.deepEqual([result.status, result.stage], ['failed', 'fix'])
      assert.match(result.reason, rejectedFor)
    } else {
      assert.ok(launchedAgents.includes('r1-review'))
    }
  })
}

const removalsByFindingKind = [
  ['#103 AC-removed-vacuous: the review after a removal answering a test-gap asks the reviewer to judge the removed test', testGap, true],
  ['#71 AC-removal-answers-test-gap: a defect proof marked removed-vacuous is judged by the defect bar and shows no removal', defectWithoutDraft, false],
]
for (const [behaviour, answered, shownAsRemoval] of removalsByFindingKind) {
  test(behaviour, async () => {
    const regression = [proofOf(answered.kind, { resolution: 'removed-vacuous', diff: removalDiff, failedBefore: true })]
    const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [answered] }, { 'fix-1': { ...resumeFix, regression } })
    const prompt = agentCalls['r1-review'].prompt
    assert.equal(/removing a vacuous test.*judge whether the removed test pinned no behaviour/.test(prompt), shownAsRemoval)
    assert.equal(prompt.includes(removalDiff), shownAsRemoval)
  })
}

const bouncedTip = 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2'
const bounceFix = { ...resumeFix, oldTip: resumeFixedTip, mergedBase: resumeFixedTip, tip: bouncedTip, files: ['x.py'], regression: [] }
const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const built = { pr: 2, tip: resumeTip, blocked: false }

const claimScopeAnswers = (outsideClaim) => ({ 'fix-1': { ...resumeFix, regression: [] }, 'scope-1': { outside_claim: JSON.stringify(outsideClaim) }, 'fix-2': bounceFix })
const bouncesAfterAFixer = [
  ['#71 AC-bounce-outside-claim: a fixer that changed board.py outside the claim is bounced to a fresh fixer naming it, before review', ['board.py'], ['fix-1', 'scope-1', 'fix-2', 'scope-2', 'r2-review']],
  ['#71 AC-bounce-outside-claim: outside_claim [] goes to review unchanged', [], ['fix-1', 'scope-1', 'r1-review']],
]
for (const [behaviour, outsideClaim, expectedAgents] of bouncesAfterAFixer) {
  test(behaviour, async () => {
    const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, claimScopeAnswers(outsideClaim))
    assert.deepEqual(launchedAgents.slice(2, 2 + expectedAgents.length), expectedAgents)
    if (outsideClaim.length) {
      assert.match(agentCalls['fix-2'].prompt, /board\.py/)
      assert.match(agentCalls['fix-2'].prompt, /move the change back inside the claim scope or revert it/)
      const reviewPrompt = agentCalls['r2-review'].prompt
      assert.ok(reviewPrompt.includes(`git diff ${resumeTip}..${resumeFixedTip}`), 'the review still sees the first fix')
      assert.ok(reviewPrompt.includes(`git diff ${resumeFixedTip}..${bouncedTip}`), 'the review sees the bounce')
    }
  })
}

const stopsWhileFixersStayOutside = [
  ['the second fixer leaves the same paths again', { budgets: { test: 3 } }, ['fix-1', 'scope-1', 'fix-2', 'scope-2'], /left the claim scope again at board\.py/],
  ['the fix budget is spent', { budgets: { test: 1 } }, ['fix-1', 'scope-1'], /test budget spent/],
]
for (const [behaviour, extraArgs, expectedAgents, reason] of stopsWhileFixersStayOutside) {
  test(`#71 AC-bounce-outside-claim: a lane stops when ${behaviour}, before any review`, async () => {
    const answers = { ...claimScopeAnswers(['board.py']), 'scope-2': { outside_claim: '["board.py"]' } }
    const { result, launchedAgents } = await runLane({ ...resumeArgs, ...extraArgs, fixFirst: [defectWithoutDraft] }, answers)
    assert.equal(result.status, 'unresolved')
    assert.match(result.reason, reason)
    assert.deepEqual(launchedAgents.slice(2), expectedAgents)
  })
}

const resumesOutsideTheClaim = [
  ['deltaFrom alone', { deltaFrom: resumeTip }],
  ['pr and tip alone', {}],
]
for (const [handedOver, args] of resumesOutsideTheClaim) {
  test(`#71 AC-bounce-outside-claim: a resume with ${handedOver} whose range left the claim scope is bounced before its first review`, async () => {
    const { launchedAgents, agentCalls } = await runLane({ ...resumeArgs, ...args }, { 'scope-resume': { outside_claim: '["board.py"]' }, 'fix-1': { ...resumeFix, regression: [] } })
    assert.deepEqual(launchedAgents.slice(0, 4), ['sync', 'scope-resume', 'fix-1', 'scope-1'])
    assert.match(agentCalls['fix-1'].prompt, /board\.py/)
    assert.ok(launchedAgents.findIndex(label => label.endsWith('-review')) > launchedAgents.indexOf('scope-1'))
  })
}

test('#71 AC-bounce-outside-claim: a builder that left the claim scope is bounced before the first review', async () => {
  const { launchedAgents, agentCalls } = await runLane(builtLane, { build: built, 'scope-0': { outside_claim: '["board.py"]' }, 'fix-1': { ...resumeFix, regression: [] } })
  assert.deepEqual(launchedAgents.slice(0, 4), ['build', 'scope-0', 'fix-1', 'scope-1'])
  assert.match(agentCalls['fix-1'].prompt, /board\.py/)
  assert.ok(launchedAgents.findIndex(label => label.endsWith('-review')) > launchedAgents.indexOf('scope-1'))
})

const stopsWithoutClaim = [
  ['the builder', builtLane, { build: built, 'scope-0': { outside_claim: 'null' } }, 'scope-0'],
  ['a fixer', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] }, 'scope-1': { outside_claim: 'null' } }, 'scope-1'],
]
for (const [step, args, answers, scopeLabel] of stopsWithoutClaim) {
  test(`#71 AC-no-claim-no-pass: outside_claim null after ${step} stops the lane with a reason before any review`, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
    assert.match(result.reason, /no live claim/)
    assert.equal(launchedAgents.at(-1), scopeLabel)
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

const rescopeRequest = [{ path: 'src/cli.py', change: 'pass the new argument', reason: 'it calls the changed signature' }]
const rescopeHandbacks = [
  ['the builder', builtLane, { build: { ...built, rescope: rescopeRequest } }, 'build', { pr: 2, tip: resumeTip, unreviewed: false, lastBlocking: undefined }],
  ['a fixer', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, rescope: rescopeRequest } }, 'fix', { pr: resumeArgs.pr, tip: resumeFixedTip, unreviewed: true, lastBlocking: [defectWithoutDraft] }],
]
for (const [step, args, answers, stage, resumeFrom] of rescopeHandbacks) {
  test(`#124 AC-rescope-handback: ${step} that needs a path outside the claim ends awaiting-head with the rescope list before the scope check`, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.deepEqual([result.status, result.stage, result.rescope], ['awaiting-head', stage, rescopeRequest])
    assert.deepEqual([result.pr, result.tip], [resumeFrom.pr, resumeFrom.tip])
    assert.match(result.reason, /path to where, change to text, reason to evidence, kind defect/)
    assert.deepEqual(result.lastBlocking, resumeFrom.lastBlocking)
    assert.equal(/no reviewer has seen/.test(result.reason), resumeFrom.unreviewed)
    assert.equal(result.history.some(entry => entry.tip === resumeFixedTip && !entry.reviewed), resumeFrom.unreviewed)
    assert.ok(!launchedAgents.some(label => label.startsWith('scope-') && label !== 'scope-resume'))
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

test('#71 AC-answer-not-aco: the scope agent gets one complete command line that enters the lane worktree first', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  const commandLine = `cd '/w' && aco brief 1 --json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["outside_claim"]))'`
  assert.ok(agentCalls['scope-0'].prompt.includes(commandLine), agentCalls['scope-0'].prompt)
})

test('#108 AC-sync-in-worktree: every git command the sync agent is handed carries the worktree', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  const prompt = agentCalls.sync.prompt.slice(agentCalls.sync.prompt.indexOf('Bring the lane up to date'))
  for (const command of ['git fetch origin', 'git merge-base --is-ancestor origin/main HEAD', 'git merge origin/main', 'git push', 'git merge --abort', 'git status --porcelain', 'git rev-parse HEAD']) {
    assert.ok(prompt.includes(command.replace('git ', "git -C '/w' ")), `${command}: ${prompt}`)
  }
  assert.doesNotMatch(prompt, /\bgit (?!-C '\/w' )/)
})

test('#108 AC-sync-in-worktree: the ledger conflict path pushes from the worktree too', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, ledgers: ['LEDGER.md'] })
  const ledgerSentence = agentCalls.sync.prompt.match(/Conflicts only in the append-only ledgers:[^.]*\./)[0]
  assert.ok(ledgerSentence.includes("git -C '/w' push"), ledgerSentence)
})

test('#108 AC-watcher-in-repo: the CI watcher enters the worktree when repo is unset and names the repo when it is set', async () => {
  const reachCi = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }
  const unset = await runLane(resumeArgs, reachCi)
  const watcherPrompt = unset.agentCalls['ci-0'].prompt
  for (const command of ['gh pr view', "timeout 540 gh pr checks", 'gh run rerun', 'gh run view']) {
    assert.ok(watcherPrompt.includes(`cd '/w' && ${command}`), `${command}: ${watcherPrompt}`)
  }
  assert.match(watcherPrompt, /cd '\/w' && timeout 540 gh pr checks \d+ --watch --interval 90/)
  const set = await runLane({ ...resumeArgs, repo: 'owner/name' }, reachCi)
  assert.match(set.agentCalls['ci-0'].prompt, /gh pr view \d+ -R owner\/name/)
  assert.match(set.agentCalls['ci-0'].prompt, /timeout 540 gh pr checks \d+ -R owner\/name --watch/)
  assert.doesNotMatch(set.agentCalls['ci-0'].prompt, /cd '\/w'/)
})

test('#108 AC-sync-in-worktree: the sync prompt separates the no-op sentence from the merge sentence', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  assert.ok(agentCalls.sync.prompt.includes('change nothing. Otherwise'), agentCalls.sync.prompt)
})

const textsThatAreNotAcoAnswers = ['"claimed"', '{"a":1}', '[1]', 'true', 'not json', 'ERROR: no claim store']
test('#118 AC-answer-not-aco: a push that succeeded but an answer without outside_claim stops at scope naming the omission', async () => {
  const { result, launchedAgents } = await runLane(builtLane, { build: built, 'scope-0': { remote_tip: built.tip } })
  assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
  assert.match(result.reason, /no outside_claim/)
  assert.doesNotMatch(result.reason, /undefined/)
  assert.deepEqual(launchedAgents, ['build', 'scope-0'])
})

for (const text of textsThatAreNotAcoAnswers) {
  test(`#71 AC-answer-not-aco: the text ${text} stops the lane at scope naming it, before any review`, async () => {
    const { result, launchedAgents } = await runLane(builtLane, { build: built, 'scope-0': { outside_claim: text } })
    assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
    assert.ok(result.reason.includes(text), result.reason)
    assert.deepEqual(launchedAgents, ['build', 'scope-0'])
  })
}

test('#103 AC-scratch-and-load: the builder and fixer know the scratch path and the tester re-reads the load after the lock', async () => {
  const replay = webauthReplay
  const args = { ...replay.args, scratch: '/drive-scratch' }
  const { agentCalls } = await runLane(args, answersWith(replay, { kind: 'test-gap', mutation: true }))
  for (const label of ['build', 'fix-1']) assert.match(agentCalls[label].prompt, /pidfiles and evidence under \/drive-scratch/)
  assert.match(agentCalls['e2e-0'].prompt, /Right after you acquire the lock, read the 1-minute load average again.*above 1\.5 × cores, release the lock and wait/)
})

test('#108 AC-scope-error-named: the scope agent is told to return the error output when the command prints nothing or fails', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  assert.match(agentCalls['scope-0'].prompt, /prints nothing or fails, return its error output/)
})

const scopeSchemaOf = async () => (await runLane(builtLane, { build: built })).agentCalls['scope-0'].options.schema
// json.dumps prints non-ASCII as \uXXXX and escapes a quote with a backslash
const acoPrints = ['null', '[]', '["a.py"]', '["a.py", "dir/b c.py"]', '["caf\\u00e9/\\u3042.py"]', '["a\\"b.py"]']
const slipsAndForeignText = ['', '"claimed"', '{"a":1}', '[1]', '["a.py", 2]', 'true', 'not json', 'ERROR: no claim store', 'null null', '[] []']
for (const [printed, admitted] of [...acoPrints.map(text => [text, true]), ...slipsAndForeignText.map(text => [text, false])]) {
  test(`#118 AC-schema-admits-aco-only: the scope agent's schema ${admitted ? 'admits' : 'refuses'} ${JSON.stringify(printed)} as outside_claim`, async () => {
    const { properties } = await scopeSchemaOf()
    assert.equal(properties.outside_claim.type, 'string')
    assert.equal(new RegExp(properties.outside_claim.pattern).test(printed), admitted)
  })
}

test('#118 AC-failed-command-own-field: the schema lets a failed command be answered by its error output alone', async () => {
  const schema = await scopeSchemaOf()
  assert.equal(schema.properties.command_error.type, 'string')
  assert.deepEqual(schema.required.filter(field => field === 'outside_claim' || field === 'remote_tip'), [])
})

const failedCommands = [
  ['push', builtLane, { build: built }, 'scope-0', { command_error: "fatal: unable to access 'https://example.invalid/r.git'" }, 'push'],
  ['aco brief', builtLane, { build: built }, 'scope-0', { remote_tip: built.tip, command_error: 'aco: no claim store here' }, 'scope'],
  ['aco brief that also printed a valid answer', builtLane, { build: built }, 'scope-0', { remote_tip: built.tip, outside_claim: '[]', command_error: 'aco: warning, store locked' }, 'scope'],
]
for (const [command, args, answers, scopeLabel, answer, stage] of failedCommands) {
  test(`#118 AC-failed-command-own-field: a failed ${command} stops the lane at ${stage} naming its error output, before any review`, async () => {
    const { result, launchedAgents } = await runLane(args, { ...answers, [scopeLabel]: answer })
    assert.deepEqual([result.status, result.stage], ['failed', stage])
    assert.ok(result.reason.includes(answer.command_error), result.reason)
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

const mergedOnlyTip = 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2'
const conflictsWithMain = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }
const mergeOnlyFix = { ...resumeFix, mergedBase: mergedOnlyTip, tip: mergedOnlyTip, files: [], regression: [] }
const stepsThatMustPush = [
  ['the builder', builtLane, { build: built }, 'scope-0', resumeTip],
  ['an accepted fix batch', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] } }, 'scope-1', resumeFixedTip],
  ['a fix batch that only merged main', { ...resumeArgs, fixFirst: [conflictsWithMain] }, { 'fix-1': mergeOnlyFix }, 'scope-1', mergedOnlyTip],
]
const pushLine = (branch) => `git push origin '${branch}' && git rev-parse 'origin/${branch}'`
for (const [step, args, answers, scopeLabel, stepTip] of stepsThatMustPush) {
  test(`#115 AC-remote-carries-tip: after ${step} the scope agent is handed one command line that pushes the lane branch by name and prints the remote sha`, async () => {
    const { agentCalls } = await runLane(args, answers)
    assert.ok(agentCalls[scopeLabel].prompt.includes(`cd '/w' && ${pushLine('b')}`), agentCalls[scopeLabel].prompt)
    assert.doesNotMatch(agentCalls[scopeLabel].prompt, /--force| -f\b|\bgit push origin '?\+/)
  })

  for (const [spelling, remote] of [['the full tip', stepTip], ['an abbreviation of the tip', stepTip.slice(0, 7)], ['the tip with a trailing newline', `${stepTip}\n`]]) {
    test(`#115 AC-remote-carries-tip: a remote that prints ${spelling} after ${step} goes on past the push unchanged`, async () => {
      const { result, launchedAgents } = await runLane(args, { ...answers, [scopeLabel]: { outside_claim: '[]', remote_tip: remote } })
      assert.notEqual(result.stage, 'push')
      assert.ok(launchedAgents.indexOf(scopeLabel) < launchedAgents.length - 1, launchedAgents.join())
    })
  }

  const remoteTextsThatCannotCarryTheTip = [
    ['a rejected push', '! [rejected] b -> b (non-fast-forward)', { remote_tip: '! [rejected] b -> b (non-fast-forward)' }],
    ['another commit', 'ffffffffffffffffffffffffffffffffffffffff', { remote_tip: 'ffffffffffffffffffffffffffffffffffffffff' }],
    ['nothing at all', '', { remote_tip: '' }],
    ['a push that failed with only its error output', "fatal: unable to access 'https://example.invalid/r.git'", { command_error: "fatal: unable to access 'https://example.invalid/r.git'" }],
  ]
  for (const [outcome, printed, answer] of remoteTextsThatCannotCarryTheTip) {
    test(`#115 AC-push-stops-loud: ${outcome} after ${step} stops the lane at push naming the tip and what came back, before any review`, async () => {
      const { result, launchedAgents } = await runLane(args, { ...answers, [scopeLabel]: answer })
      assert.deepEqual([result.status, result.stage], ['failed', 'push'])
      assert.ok(result.reason.includes(stepTip), result.reason)
      assert.ok(result.reason.includes(printed), result.reason)
      assert.ok(!launchedAgents.some(label => label.includes('review')))
    })
  }
}

test('#103 AC-scratch-and-load: the sync prompt does not carry the drive facts', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, scratch: '/drive-scratch' })
  assert.doesNotMatch(agentCalls.sync.prompt, /drive-scratch/)
})

const reachesToCi = { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, ...reachesTheEnd }
const jobLogCommandByRepo = [
  { repo: undefined, command: "cd '/w' && gh run view <run-id> --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200" },
  { repo: 'o/r', command: "gh run view <run-id> -R o/r --job <job-id> --log | sed -n '1,/##\\[error\\]/p' | tail -n 200" },
]
for (const { repo, command } of jobLogCommandByRepo) {
  test(`the CI agent reads each red job's own log up to its first error line (${repo ?? 'worktree repository'})`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, repo, foldIn: [tidy] }, reachesToCi)
    const brief = agentCalls['ci-0'].prompt
    assert.ok(brief.includes(command), brief)
    assert.match(brief, /--json name,state,link/)
  })
}

const ciBriefClauses = [
  { duty: 'a check whose link is not an Actions job has no log command', clause: /not an Actions job link/ },
  { duty: 'listed findings become one entry each', clause: /one failing entry per listed finding/ },
  { duty: 'a plain red check stays one entry', clause: /without such a list stays one entry/ },
  { duty: 'the log line prefix stays out of the evidence', clause: /UNKNOWN STEP/ },
  { duty: 'a Fix line is not a finding', clause: /`Fix:` line belongs to the finding above/ },
  { duty: 'a log without an error line is reported as such', clause: /log held no error line/ },
  { duty: 'a derived red check is left out', clause: /derived: leave it out/ },
]
for (const { duty, clause } of ciBriefClauses) {
  test(`the CI brief covers it: ${duty}`, async () => {
    const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, reachesToCi)
    assert.match(agentCalls['ci-0'].prompt, clause)
  })
}

test('two Sonar findings listed by the CI agent reach the fixer as two findings, each with its where and rule', async () => {
  const sonar = (where, rule) => ({ where, kind: 'defect', text: 'Refactor this exception test', rule, evidence: `sonar ${where} - ${rule}: Refactor this exception test` })
  const failing = [sonar('tests/test_edge_apply.py:498', 'python:S5778'), sonar('tests/test_step_ca_init.py:685', 'python:S5779')]
  const answers = { ...reachesToCi, 'ci-0': { head: resumeTip, green: false, failing }, 'fix-2': resumeFix }
  const { agentCalls } = await runLane({ ...resumeArgs, foldIn: [tidy] }, answers)
  const fixerBrief = agentCalls['fix-2'].prompt
  for (const { where, rule } of failing) {
    assert.ok(fixerBrief.includes(where), fixerBrief)
    assert.ok(fixerBrief.includes(rule), fixerBrief)
  }
})
