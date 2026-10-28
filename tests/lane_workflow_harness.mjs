// Drives the atelier lane workflow script with a stub agent runner; shared by the lane workflow tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const workflowSource = (file) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${file}`, import.meta.url), 'utf8').replace(/^export const meta/m, 'const meta')
// The plugin workflows a workflow can start by name, as the Workflow runtime resolves them.
const CHILD_WORKFLOWS = { 'atelier:lane-ci': 'lane-ci.js', 'atelier:lane-codex': 'lane-codex.js' }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Stand-ins for the two programs the printer runs, steered by environment variables the harness sets for the child only.
const FAKE_GIT = `#!/bin/sh
case "$1 $2" in
  "push origin") [ -z "$FAKE_PUSH_ERROR" ] || { printf '%s\\n' "$FAKE_PUSH_ERROR" >&2; exit 1; } ;;
  "rev-parse HEAD") [ "$FAKE_HEAD_CODE" = 0 ] || { printf 'fatal: bad revision\\n' >&2; exit "$FAKE_HEAD_CODE"; }; printf '%s\\n' "$FAKE_HEAD" ;;
  "rev-parse HEAD^@") printf '%s\\n' "$FAKE_PARENTS" ;;
  "merge-base --is-ancestor") exit "$FAKE_MAIN_CODE" ;;
  "rev-parse origin/"*) printf '%s\\n' "$FAKE_REMOTE" ;;
esac
`
export const FAKE_ACO = `#!/bin/sh
[ -z "$FAKE_BRIEF_ERROR" ] || printf '%s\\n' "$FAKE_BRIEF_ERROR" >&2
printf '%s' "$FAKE_BRIEF_OUTPUT"
[ -z "$FAKE_BRIEF_ERROR" ]
`
export const installFake = (directory, program, script) => fs.writeFileSync(path.join(directory, program), script, { mode: 0o755 })

// Runs a command line the way the agent does and returns what it printed (its error output when it printed nothing).
export const runCommandLine = (line, { cwd, env }) => {
  const ran = spawnSync('sh', ['-c', line], { cwd, env, encoding: 'utf8' })
  return (ran.stdout || ran.stderr).trim()
}

// answers holds each agent's result by its label; an agent without one ends without a result. Without answers only
// the sync step answers (an up-to-date lane), so a run gets as far as starting its first review round.
// options.transformChild rewrites a child's source and options.alterChildArgs the args a child receives, so a test can
// break the parent-child contract; launchedByChild lists the agent labels each child workflow launched.
export async function runLane(args, answers = {}, options = {}) {
  const source = workflowSource('lane.js')
  const launchedByChild = {}
  const launchedAgents = []
  const agentCalls = {}
  const isRelayed = (label) => label === 'sync' || label.startsWith('scope-')
  const defaultAnswerFor = (label) => isRelayed(label) ? {} : null
  // The branch carries the newest tip a builder, fixer or sync returned. A scope or sync step's answer says what the fake
  // git and aco print (scope: push_error, remote_tip, brief_error, outside_claim; sync: head, parents, head_code,
  // main_code) and how the agent mishandled the printed line (nonce, edit, printed, printerMode: the printer mode it ran instead); the line itself always comes from
  // running the real printer the prompt carries. Without answers a sync leaves an up-to-date lane as it is.
  let newestTip = args.tip
  let fakeBin
  const fakeCommands = () => {
    if (!fakeBin) {
      fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-fake-'))
      installFake(fakeBin, 'git', FAKE_GIT)
      installFake(fakeBin, 'aco', FAKE_ACO)
    }
    return fakeBin
  }
  const printedBy = (prompt, scenario) => {
    if ('printed' in scenario) return scenario.printed
    const line = prompt.split('\n').at(-1).replace(/^cd '[^']*' && /, '')
    const env = {
      ...process.env, PATH: `${fakeCommands()}:${process.env.PATH}`, FAKE_HEAD: scenario.head ?? newestTip, FAKE_REMOTE: scenario.remote_tip ?? newestTip,
      FAKE_HEAD_CODE: scenario.head_code ?? 0, FAKE_PARENTS: (scenario.parents ?? []).join('\n'), FAKE_MAIN_CODE: scenario.main_code ?? 0,
      FAKE_PUSH_ERROR: scenario.push_error ?? '', FAKE_BRIEF_ERROR: scenario.brief_error ?? '',
      FAKE_BRIEF_OUTPUT: JSON.stringify({ outside_claim: 'outside_claim' in scenario ? scenario.outside_claim : [] }),
    }
    const asked = scenario.printerMode ? line.replace(/' scope .* ('[^']*')$/, `' ${scenario.printerMode} $1`) : line
    const printed = runCommandLine(scenario.nonce ? asked.replace(/'[^']*'$/, `'${scenario.nonce}'`) : asked, { cwd: os.tmpdir(), env })
    return scenario.edit ? scenario.edit(printed) : printed
  }
  const answerFor = (label, prompt) => {
    const given = label in answers ? answers[label] : defaultAnswerFor(label)
    if (typeof given === 'function') return given(prompt)
    const answer = isRelayed(label) && given ? { ...given } : structuredClone(given)
    if (answer?.tip && /^(build|fix-)/.test(label)) newestTip = answer.tip
    if (!isRelayed(label) || !answer) return answer
    const printed = printedBy(prompt, answer)
    if (label === 'sync' && answer.head) newestTip = answer.head
    return { ...(answer.note && { note: answer.note }), printed }
  }
  const agent = async (prompt, agentOptions = {}) => { launchedAgents.push(agentOptions.label); agentCalls[agentOptions.label] = { prompt, options: agentOptions }; return answerFor(agentOptions.label, prompt) }
  // A thunk that throws resolves to null, as in the Workflow runtime.
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk().catch(() => null)))
  const ignore = () => {}
  const compile = (body) => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', body)
  const startWorkflow = async (name, childArgs) => {
    if (!Object.hasOwn(CHILD_WORKFLOWS, name)) throw new Error(`unknown workflow ${name}`)
    const childSource = options.transformChild ? options.transformChild(workflowSource(CHILD_WORKFLOWS[name])) : workflowSource(CHILD_WORKFLOWS[name])
    const childLabels = launchedByChild[name] ||= []
    const childAgent = (prompt, agentOptions) => { childLabels.push(agentOptions?.label); return agent(prompt, agentOptions) }
    const nested = () => { throw new Error('a child workflow cannot start another workflow') }
    return compile(childSource)(options.alterChildArgs ? options.alterChildArgs(childArgs) : childArgs, childAgent, parallel, async () => [], ignore, ignore, nested)
  }
  try {
    const result = await compile(source)(args, agent, parallel, async () => [], ignore, ignore, startWorkflow)
    return { result, launchedAgents, agentCalls, launchedByChild }
  } finally {
    if (fakeBin) fs.rmSync(fakeBin, { recursive: true })
  }
}

export const resumedLane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip: 'abcdef0' }

export const APPROVE = { verdict: 'APPROVE', blocking: [], followups: [] }

export const PASS = { verdict: 'PASS', blocking: [], followups: [] }

export const greenCi = (head) => ({ head, green: true, failing: [], checks: [{ name: 'quality / verdict', bucket: 'pass' }], requiredChecks: ['quality / verdict'] })

export const finding = (where, text) => ({ where, text, rule: 'recorded rule', evidence: 'recorded evidence' })

export const followup = (where, text, owner) => ({ where, text, owner })

export const webauthTips = { built: '7ac1653ab10c05e6b41a393d47a586a2bacb9640', firstFix: 'd7e50a7509ea87793fed5bdbabcf7df3955bc893', secondFix: '307742391d346d4579400c733ef7adbdeea5ef79' }

export const webauthC1Finding = 'src/webauth/jwt_verification.py:65 (_URL_CONTROL_OR_SPACE) via is_https_url, reached through OidcClientConfig.__post_init__ (src/webauth/oidc.py:73-92)'

export const webauthReplay = {
  name: 'webauth#57',
  args: { item: 57, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r1-gate', fixedBy: 'fix-2', number: 3, where: 'tests/test_oidc.py:479', mutation: 'drop quote_plus from the client-ID part of the Basic authorization only' },
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
        { finding: 1, test: 'tests/test_oidc.py [lone-surrogate-not-percent-encoded]', failedBefore: true, passesAfter: true },
        { finding: 2, test: 'tests/test_oidc.py [secret-form-encoded-before-basic-encoding]', failedBefore: true, passesAfter: true },
        { finding: 3, test: 'tests/test_oidc.py [redirect-uri-with-a-carriage-return-in-its-path]', failedBefore: true, passesAfter: true },
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
        { finding: 1, test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 2, test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 3, test: 'tests/test_oidc.py [client-id-form-encoded-before-basic-encoding]', failedBefore: false, passesAfter: true },
        { finding: 4, test: 'tests/test_jwt_verification.py [key-set-url-not-a-string]', failedBefore: true, passesAfter: true },
      ],
    },
    'r2-review': APPROVE,
    'r2-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(webauthTips.secondFix),
  },
}

export const agentProvidersTips = { built: 'adfb04bc5b1f543f6060709047570d92550f905d', fix: '7c543ba55440b4d743eecf18aa9a1520aadeda55' }

export const agentProvidersReplay = {
  name: 'agent-providers#25',
  args: { item: 25, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r0-gate', fixedBy: 'fix-1', number: 1, where: 'tests/test_sse_codec.py:58', mutation: 'encode_event writes the event line before the id line' },
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
      regression: [{ finding: 1, test: 'tests/test_sse_codec.py::test_an_event_travels_as_one_frame_of_compact_utf8_json', failedBefore: false, passesAfter: true }],
    },
    'r1-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(agentProvidersTips.fix),
  },
}

export const replays = [webauthReplay, agentProvidersReplay]

// One past every blocking list a replay hands a fixer.
export const outOfRange = 9

export function answersWith(replay, { kind, mutation, testDraft = false, passesAfter = true, proof = 'exact', proofNumber, strayProof = false, failedBefore }) {
  const answers = structuredClone(replay.answers)
  const { raisedBy, fixedBy, number, where } = replay.testGap
  const testGap = answers[raisedBy].blocking.find(f => f.where === where)
  if (kind) testGap.kind = kind
  if (testDraft) testGap.testDraft = '/s/draft_test.py'
  const regression = answers[fixedBy].regression
  const testGapProof = regression.find(recorded => recorded.finding === number)
  if (mutation) testGapProof.mutation = replay.testGap.mutation
  testGapProof.passesAfter = passesAfter
  if (failedBefore !== undefined) testGapProof.failedBefore = failedBefore
  if (proofNumber !== undefined) testGapProof.finding = proofNumber
  if (proof === 'omitted') regression.splice(regression.indexOf(testGapProof), 1)
  if (strayProof) regression.push({ finding: outOfRange, test: 'fold-in test', failedBefore: false, passesAfter: false })
  return answers
}

export const resumeTip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'

export const resumeFixedTip = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1'

export const tidy = followup('x.py:1', 'tidy the import order', 'follow-up (fix in place)')

export const defectWithoutDraft = { ...finding('t.py:1', 'the code breaks the rule'), kind: 'defect' }

export const resumeFix = { oldTip: resumeTip, mergedBase: resumeTip, tip: resumeFixedTip, mergeResolvedLaneConflict: false, files: ['x.py'], disputed: [], blocked: false }

export const resumeArgs = { ...resumedLane, tip: resumeTip }

export const unchangedFix = { ...resumeFix, tip: resumeTip, files: [], regression: [] }

export const satisfied = (item, evidence = 'tests/x_test.py already pins it') => ({ where: item.where, text: item.text, evidence })

export const reachesTheEnd = { 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

export const testGap = { ...finding('t.py:1', 'a behaviour has no test'), kind: 'test-gap' }

export const secondFix = { ...resumeFix, oldTip: resumeFixedTip, mergedBase: resumeFixedTip, tip: 'e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3', files: ['x.py'], regression: [] }

export const built = { pr: 2, tip: resumeTip, blocked: false }

export const mergedOnlyTip = 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2'

export const conflictsWithMain = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }

export const mergeOnlyFix = { ...resumeFix, mergedBase: mergedOnlyTip, tip: mergedOnlyTip, files: [], regression: [] }
