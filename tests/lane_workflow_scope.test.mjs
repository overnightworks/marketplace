// Drives the atelier lane workflow script through the sync, push, claim scope and rescope rules with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi, finding, agentProvidersReplay, tidy, satisfied, unchangedFix, webauthReplay, answersWith, resumeTip, resumeFixedTip, defectWithoutDraft, resumeFix, resumeArgs, built, mergedOnlyTip, conflictsWithMain, mergeOnlyFix, reachesTheEnd } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

const outsideClaim = (paths) => ({ outside_claim: paths })
// The relay lists at most 50 paths, so only a longer list cannot be judged and stops the scope check.
const unjudgeableOutside = ['board.py', ...Array.from({ length: 50 }, (_, index) => `src/mod_${index}.py`)]
const listedOutside = unjudgeableOutside.slice(0, 50)
const newRunWithBothChoices = /aco rescope[\s\S]*new run with pr and tip[\s\S]*fixFirst[\s\S]*revert[\s\S]*git log origin\/main\.\.\w+ -- board\.py/
const reviseOnce = { verdict: 'REVISE', blocking: [{ ...defectWithoutDraft, kind: 'docs' }], followups: [] }
const redCi = { head: resumeFixedTip, green: false, failing: [{ ...finding('ci', 'quality / verdict is red'), kind: 'defect' }], checks: [{ name: 'quality / verdict', bucket: 'fail' }], requiredChecks: ['quality / verdict'] }
const aFixFor = { ...resumeFix, regression: [] }

const scopeStops = [
  ['AC-scope-stop-not-bounce: a review fixer that changed board.py ends awaiting-head at scope and names the tip before its fix as deltaFrom',
    resumeArgs, { 'r0-review': reviseOnce, 'fix-1': aFixFor, 'scope-1': outsideClaim(unjudgeableOutside) }, ['r0-review', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /no reviewer has seen/]],
  ['AC-scope-stop-not-bounce: a CI fix outside the claim ends at scope with no fixer after it and names the unreviewed fix commits and the tip before the fix',
    resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { ...redCi, head: resumeTip }, 'fix-1': aFixFor, 'scope-1': outsideClaim(unjudgeableOutside) }, ['ci-0', 'ci-read-0', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /fix commits no reviewer has seen/]],
  ['AC-scope-stop-not-bounce: a resume whose inherited commits are outside the claim ends at scope and names no deltaFrom',
    resumeArgs, { 'scope-resume': outsideClaim(unjudgeableOutside) }, ['sync', 'scope-resume'], resumeTip, [/earlier run/]],
  ['AC-scope-stop-not-bounce: a resume with deltaFrom alone whose inherited commits are outside the claim names no deltaFrom',
    { ...resumeArgs, deltaFrom: resumeTip }, { 'scope-resume': outsideClaim(unjudgeableOutside) }, ['sync', 'scope-resume'], resumeTip, [/earlier run/]],
  ['AC-scope-stop-not-bounce: a builder that left the claim scope ends at scope and names no deltaFrom, so the new run reviews the whole lane',
    builtLane, { build: built, 'scope-0': outsideClaim(unjudgeableOutside) }, ['build', 'scope-0'], resumeTip, [/No reviewer has seen the build/, /whole lane/]],
  ['AC-scope-stop-not-bounce: a carried batch that ends outside the claim says the paths may come from earlier commits and names no deltaFrom',
    { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(unjudgeableOutside) }, ['sync', 'fix-1', 'scope-1'], resumeFixedTip, [/earlier commits/]],
  ['AC-scope-stop-not-bounce: a carried batch with deltaFrom that ends outside the claim names the deltaFrom the run was given',
    { ...resumeArgs, fixFirst: [defectWithoutDraft], deltaFrom: resumeTip }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(unjudgeableOutside) }, ['sync', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /earlier commits/]],
]

for (const [behaviour, args, answers, expectedAgents, expectedTip, reasonParts] of scopeStops) {
  test(behaviour, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.deepEqual(launchedAgents.slice(-expectedAgents.length), expectedAgents)
    assert.ok(!launchedAgents.some(label => /^(fix-[2-9])$/.test(label)), 'no fixer follows the scope check')
    assert.deepEqual([result.status, result.stage, result.outside, result.tip], ['awaiting-head', 'scope', listedOutside, expectedTip])
    assert.match(result.reason, newRunWithBothChoices)
    assert.doesNotMatch(result.reason, /resume/i)
    for (const part of reasonParts) assert.ok(typeof part === 'string' ? result.reason.includes(part) : part.test(result.reason), `${part}: ${result.reason}`)
    if (!reasonParts.some(part => typeof part === 'string')) assert.doesNotMatch(result.reason, /deltaFrom/)
    assert.deepEqual(result.history.at(-1), { by: 'scope', outside: listedOutside, tip: expectedTip })
  })
}

test('AC-scope-stop-not-bounce: an empty outside_claim after a fixer goes to review unchanged', async () => {
  const { launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFixFor })
  assert.deepEqual(launchedAgents.slice(1, 4), ['fix-1', 'scope-1', 'r1-review'])
})

test('AC-carried-batch-checked-after: a resume carrying fixFirst over inherited outside commits runs no scope check before the batch, and the check after it decides', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'scope-resume': outsideClaim(['board.py']), 'fix-1': aFixFor, 'scope-1': outsideClaim([]), ...reachesTheEnd, 'ci-0': greenCi(resumeFixedTip) })
  assert.ok(!launchedAgents.includes('scope-resume'))
  assert.deepEqual(launchedAgents.slice(0, 4), ['sync', 'fix-1', 'scope-1', 'r1-review'])
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('AC-scope-stop-folds-nothing: a scope stop after a batch with fold-ins reports none of them as folded', async () => {
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(unjudgeableOutside) })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(result.folded, [])
})

const stopsWithoutClaim = [
  ['the builder', builtLane, { build: built, 'scope-0': { outside_claim: null } }, 'scope-0'],
  ['a fixer', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] }, 'scope-1': { outside_claim: null } }, 'scope-1'],
]

for (const [step, args, answers, scopeLabel] of stopsWithoutClaim) {
  test(`AC-no-claim-no-pass: a null outside_claim after ${step} stops the lane with a reason before any review`, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.deepEqual([result.status, result.stage], ['failed', 'scope'])
    assert.match(result.reason, /no live claim/)
    assert.equal(launchedAgents.at(-1), scopeLabel)
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

const carriedFindings = [{ path: 'src/cli.py', change: 'pass the new argument', reason: 'it calls the changed signature' }]

test('a build together with pr and tip is refused at input', async () => {
  const { result, launchedAgents } = await runLane({ ...builtLane, pr: 2, tip: resumeTip })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.deepEqual(launchedAgents, [])
})

test('AC-resume-with-findings-reviews-the-whole-lane: resuming with carried findings gives the review and the gate the whole lane', async () => {
  const fixFirst = carriedFindings.map(({ path, change, reason }) => ({ ...finding(path, change), evidence: reason, kind: 'defect' }))
  const answers = { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': APPROVE, 'r1-gate': { ...APPROVE, codexExit: 0 }, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) }
  const { result, agentCalls } = await runLane({ ...resumeArgs, risk: 'material', fixFirst }, answers)
  assert.equal(result.status, 'ready-to-land')
  for (const label of ['r1-review', 'r1-gate']) assert.ok(agentCalls[label].prompt.includes('the whole lane: git diff origin/main...HEAD'), label)
})

test('AC-sync-in-worktree: every git command the sync agent is handed carries the worktree', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  const prompt = agentCalls.sync.prompt.slice(agentCalls.sync.prompt.indexOf('Bring the lane up to date'))
  for (const command of ['git fetch origin', 'git merge-base --is-ancestor origin/main HEAD', 'git merge origin/main', 'git push', 'git merge --abort', 'git status --porcelain']) {
    assert.ok(prompt.includes(command.replace('git ', "git -C '/w' ")), `${command}: ${prompt}`)
  }
  assert.doesNotMatch(prompt, /\bgit (?!-C '\/w' )/)
})

test('AC-sync-in-worktree: the ledger conflict path pushes from the worktree too', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, ledgers: ['LEDGER.md'] })
  const ledgerSentence = agentCalls.sync.prompt.match(/Conflicts only in the append-only ledgers:[^.]*\./)[0]
  assert.ok(ledgerSentence.includes("git -C '/w' push"), ledgerSentence)
})

test('AC-watcher-in-repo: the CI watcher enters the worktree when repo is unset and names the repo when it is set', async () => {
  const reachCi = { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }
  const unset = await runLane(resumeArgs, reachCi)
  const watcherPrompt = unset.agentCalls['ci-0'].prompt
  for (const command of ['gh pr view', "timeout 540 gh pr checks", 'gh run view']) {
    assert.ok(watcherPrompt.includes(`cd '/w' && ${command}`), `${command}: ${watcherPrompt}`)
  }
  assert.match(watcherPrompt, /cd '\/w' && timeout 540 gh pr checks \d+ --watch --fail-fast --interval 90/)
  assert.doesNotMatch(watcherPrompt, /gh run rerun/)
  const set = await runLane({ ...resumeArgs, repo: 'owner/name' }, reachCi)
  assert.match(set.agentCalls['ci-0'].prompt, /gh pr view \d+ -R owner\/name/)
  assert.match(set.agentCalls['ci-0'].prompt, /timeout 540 gh pr checks \d+ -R owner\/name --watch/)
  assert.doesNotMatch(set.agentCalls['ci-0'].prompt, /cd '\/w'/)
})

test('AC-sync-in-worktree: the sync prompt separates the no-op sentence from the merge sentence', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  assert.ok(agentCalls.sync.prompt.includes('change nothing. Otherwise'), agentCalls.sync.prompt)
})

test('AC-scratch-and-load: the builder and fixer know the scratch path and the tester re-reads the load after the lock', async () => {
  const replay = webauthReplay
  const args = { ...replay.args, scratch: '/drive-scratch' }
  const { agentCalls } = await runLane(args, answersWith(replay, { kind: 'test-gap', mutation: true }))
  for (const label of ['build', 'fix-1']) assert.match(agentCalls[label].prompt, /pidfiles and evidence under \/drive-scratch/)
  assert.match(agentCalls['e2e-0'].prompt, /Before you queue, prepare and check everything that needs no server or browser.*waits inside the lock, up to 300 seconds.*ends without starting a stack/)
})

const stepsThatMustPush = [
  ['the builder', builtLane, { build: built }, 'scope-0', resumeTip],
  ['an accepted fix batch', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, regression: [] } }, 'scope-1', resumeFixedTip],
  ['a fix batch that only merged main', { ...resumeArgs, fixFirst: [conflictsWithMain] }, { 'fix-1': mergeOnlyFix }, 'scope-1', mergedOnlyTip],
]

const pushedByName = /^cd '\/w' && python3 -c '[^']*"git","push","origin",branch[^']*' scope 1 'b' '[\w-]+'$/

for (const [step, args, answers, scopeLabel, stepTip] of stepsThatMustPush) {
  test(`AC-remote-carries-tip: after ${step} the scope agent is handed one command line whose printer pushes the lane branch by name, never by force`, async () => {
    const { agentCalls } = await runLane(args, answers)
    const prompt = agentCalls[scopeLabel].prompt
    assert.match(prompt.split('\n').at(-1), pushedByName)
    assert.ok(prompt.endsWith(` '${scopeLabel}-${stepTip}'`), prompt)
    assert.doesNotMatch(prompt, /--force| -f\b|\bgit push origin '?\+/)
  })

  for (const [spelling, remote] of [['the full tip', stepTip], ['an abbreviation of the tip', stepTip.slice(0, 7)]]) {
    test(`AC-remote-carries-tip: a remote that prints ${spelling} after ${step} goes on past the push unchanged`, async () => {
      const { result, launchedAgents } = await runLane(args, { ...answers, [scopeLabel]: { remote_tip: remote } })
      assert.notEqual(result.stage, 'push')
      assert.ok(launchedAgents.indexOf(scopeLabel) < launchedAgents.length - 1, launchedAgents.join())
    })
  }

  const pushOutcomesThatCannotCarryTheTip = [
    ['a rejected push', '! [rejected] b -> b (non-fast-forward)', { push_error: '! [rejected] b -> b (non-fast-forward)' }],
    ['a push that failed with only its error output', "fatal: unable to access 'https://example.invalid/r.git'", { push_error: "fatal: unable to access 'https://example.invalid/r.git'" }],
    ['another commit on the remote', 'ffffffffffffffffffffffffffffffffffffffff', { remote_tip: 'ffffffffffffffffffffffffffffffffffffffff' }],
    ['nothing on the remote', '', { remote_tip: '' }],
  ]
  for (const [outcome, printed, answer] of pushOutcomesThatCannotCarryTheTip) {
    test(`AC-push-stops-loud: ${outcome} after ${step} stops the lane at push naming the tip and what came back, before any review`, async () => {
      const { result, launchedAgents } = await runLane(args, { ...answers, [scopeLabel]: answer })
      assert.deepEqual([result.status, result.stage], ['failed', 'push'])
      assert.ok(result.reason.includes(stepTip), result.reason)
      assert.ok(result.reason.includes(printed), result.reason)
      assert.ok(!launchedAgents.some(label => label.includes('review')))
    })
  }
}

const aBuiltLaneWith = (scopeAnswer) => runLane(builtLane, { build: built, 'scope-0': scopeAnswer })
const stopsBeforeAnyReview = (result, launchedAgents, stage, rereads = ['scope-0-reread']) => {
  assert.deepEqual([result.status, result.stage], ['failed', stage])
  assert.deepEqual(launchedAgents, ['build', 'scope-0', ...rereads])
}

test('AC-scope-relay: the scope agent returns one printed line and nothing the model derives', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  const schema = agentCalls['scope-0'].options.schema
  assert.deepEqual([schema.required, Object.keys(schema.properties), schema.properties.printed.type], [['printed'], ['printed'], 'string'])
})

test('AC-scope-relay: the scope agent runs the printer from inside the lane worktree', async () => {
  const { agentCalls } = await runLane(builtLane, { build: built })
  assert.match(agentCalls['scope-0'].prompt.split('\n').at(-1), /^cd '\/w' && python3 -c '/)
})

const outsideClaimWhenEdited = ['board.py', 'docs/a b.md']
const editedLines = [
  ['incident 1: the agent omitted the outside_claim value', line => line.replace(/"outside_claim":\[[^\]]*\],/, '')],
  ['incident 2: the agent answered "" for a non-empty outside_claim', line => line.replace(/"outside_claim":\[[^\]]*\]/, '"outside_claim":""')],
  ['incident 2: the agent answered [] for a non-empty outside_claim', line => line.replace(/"outside_claim":\[[^\]]*\]/, '"outside_claim":[]')],
  ['a path of the outside_claim was dropped', line => line.replace('"board.py",', '')],
  ['the exit status of the remote command was edited', line => line.replace('"remote":{"code":0', '"remote":{"code":1')],
]

for (const [edit, edited] of editedLines) {
  test(`AC-scope-relay: ${edit} fails the CRC check and quotes the line`, async () => {
    let printed
    const { result, launchedAgents } = await aBuiltLaneWith({ outside_claim: outsideClaimWhenEdited, edit: line => (printed = edited(line)) })
    assert.notEqual(printed, undefined)
    stopsBeforeAnyReview(result, launchedAgents, 'scope')
    assert.match(result.reason, /CRC/)
    assert.ok(result.reason.includes(printed), result.reason)
  })
}

const nonceMismatches = [
  ['another label', 'scope-resume-', ''],
  ['another tip', 'scope-0-', 'ffffffffffffffffffffffffffffffffffffffff'],
]

for (const [difference, labelPart, tipPart] of nonceMismatches) {
  test(`AC-scope-relay: a well-formed line printed for ${difference} fails the nonce check and quotes the line`, async () => {
    const nonce = `${labelPart}${tipPart || built.tip}`
    const { result, launchedAgents } = await aBuiltLaneWith({ nonce })
    stopsBeforeAnyReview(result, launchedAgents, 'scope')
    assert.match(result.reason, /nonce/)
    assert.ok(result.reason.includes(nonce), result.reason)
  })
}

test('AC-scope-relay: a line the sync printer printed for the scope nonce fails at scope and quotes the line', async () => {
  const { result, launchedAgents } = await aBuiltLaneWith({ printerMode: 'sync' })
  stopsBeforeAnyReview(result, launchedAgents, 'scope')
  assert.match(result.reason, /lacks the push entry/)
  assert.match(result.reason, /the printed line: \{"crc"/)
})

const linesThatAreNotRelayLines = [
  ['an empty answer', ''],
  ['aco error output', 'ERROR: no claim store'],
  ['the old outside_claim text', '["board.py"]'],
  ['a line with an uppercase crc', '{"crc":"ABCDEF01","v":{}}'],
  ['a line with a short crc', '{"crc":"abcdef0","v":{}}'],
]

for (const [description, printed] of linesThatAreNotRelayLines) {
  test(`AC-scope-relay: ${description} stops the lane at scope before any review`, async () => {
    const { result, launchedAgents } = await aBuiltLaneWith({ printed })
    stopsBeforeAnyReview(result, launchedAgents, 'scope')
    assert.match(result.reason, /relay line/)
    assert.ok(result.reason.includes(printed), result.reason)
  })
}

test('AC-scope-relay: a scope step that returns no result stops the lane at scope', async () => {
  const { result, launchedAgents } = await aBuiltLaneWith(null)
  stopsBeforeAnyReview(result, launchedAgents, 'scope', [])
  assert.match(result.reason, /returned no result/)
})

for (const text of ['claimed', { a: 1 }, [1], true]) {
  test(`AC-answer-not-aco: the value ${JSON.stringify(text)} is not aco's outside_claim and stops the lane at scope naming it`, async () => {
    const { result, launchedAgents } = await aBuiltLaneWith({ outside_claim: text })
    stopsBeforeAnyReview(result, launchedAgents, 'scope', [])
    assert.ok(result.reason.includes(JSON.stringify(text)), result.reason)
  })
}

const failedBriefs = [
  ['aco brief that printed no answer', { brief_error: 'aco: no claim store here' }],
  ['aco brief that also printed a valid answer', { brief_error: 'aco: warning, store locked', outside_claim: [] }],
]

for (const [command, answer] of failedBriefs) {
  test(`AC-failed-command-own-field: a failed ${command} stops the lane at scope naming its error output, before any review`, async () => {
    const { result, launchedAgents } = await aBuiltLaneWith({ remote_tip: built.tip, ...answer })
    stopsBeforeAnyReview(result, launchedAgents, 'scope', [])
    assert.ok(result.reason.includes(answer.brief_error), result.reason)
  })
}

test('AC-scope-relay: a list longer than the printer cap names the paths it carries and how many more there are', async () => {
  const paths = Array.from({ length: 53 }, (_, index) => `src/module-${String(index).padStart(2, '0')}.py`)
  const { result } = await aBuiltLaneWith({ outside_claim: paths })
  assert.deepEqual([result.status, result.stage, result.outside], ['awaiting-head', 'scope', paths.slice(0, 50)])
  assert.match(result.reason, /and 3 more/)
})

test('AC-scratch-and-load: the sync prompt does not carry the drive facts', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, scratch: '/drive-scratch' })
  assert.doesNotMatch(agentCalls.sync.prompt, /drive-scratch/)
})

const syncedTip = 'd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0'
const reachesTheEndAt = (tip) => ({ ...reachesTheEnd, 'r0-review': APPROVE, 'ci-0': greenCi(tip) })

const otherCommit = 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5'
const mainCommit = 'f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6'

for (const [what, parents, writesHistory] of [['moved the branch', [otherCommit], true], ['merged main onto the held tip', [resumeTip, mainCommit], false]]) {
  test(`AC-sync-tip-relayed: a resume whose sync ${what} reviews and reports the relayed tip, and ${writesHistory ? 'names both tips' : 'writes no'} history`, async () => {
    const answers = { ...reachesTheEndAt(syncedTip), sync: { head: syncedTip, parents } }
    const { result, launchedAgents } = await runLane(resumeArgs, answers)
    assert.ok(launchedAgents.includes('r0-review'), launchedAgents.join())
    assert.equal(result.tip, syncedTip)
    const moved = result.history.find(entry => entry.by === 'sync')
    assert.deepEqual(moved && [moved.after, moved.from, moved.tip], writesHistory ? [0, resumeTip, syncedTip] : undefined)
  })
}

test('AC-sync-tip-relayed: an up-to-date lane keeps its tip and writes no history', async () => {
  const { result } = await runLane(resumeArgs, reachesTheEndAt(resumeTip))
  assert.equal(result.tip, resumeTip)
  assert.equal(result.history.some(entry => entry.by === 'sync'), false)
})

const relayFailures = [
  ['the agent returned no result', null, undefined],
  ['incident 3: a head edited to the merge base fails the CRC check', { edit: (line) => line.replace(resumeTip, mainCommit) }, /fails its CRC check/],
  ['a line carrying another nonce', { nonce: `sync-${otherCommit}` }, /carries the nonce sync-e5e5/],
  ['the agent printed no line', { printed: 'fatal: not a git repository' }, /is not a relay line/],
  ['git rev-parse HEAD failed', { head_code: 128 }, /reports a failed git command/, 'readable'],
  ['the main check failed with 128', { main_code: 128 }, /reports a failed git command/, 'readable'],
]

for (const [what, scenario, reasonPattern, lineIs] of relayFailures) {
  test(`AC-sync-relay-failures: a sync where ${what} fails the lane at sync`, async () => {
    const { result, launchedAgents } = await runLane(resumeArgs, { sync: scenario })
    assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
    if (scenario) {
      assert.match(result.reason, reasonPattern)
      assert.ok(result.reason.includes('the printed line: '), result.reason)
    }
    assert.deepEqual(launchedAgents, scenario && lineIs !== 'readable' ? ['sync', 'sync-reread'] : ['sync'])
  })
}

test('AC-sync-relay-failures: a failure quotes the line the agent printed', async () => {
  const printed = 'fatal: not a git repository'
  const { result } = await runLane(resumeArgs, { sync: { printed } })
  assert.ok(result.reason.endsWith(`the printed line: ${printed}`), result.reason)
})

for (const [what, note, reason] of [['with a note', 'conflict in board.py', 'conflict in board.py'], ['without a note', undefined, `the lane tip ${resumeTip} does not contain origin/main, and the sync named no cause`]]) {
  test(`AC-sync-conflict-relayed: a sync whose lane does not contain origin/main escalates at sync ${what}`, async () => {
    const { result, launchedAgents } = await runLane(resumeArgs, { sync: { main_code: 1, note } })
    assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'sync', reason])
    assert.deepEqual(launchedAgents, ['sync'])
  })
}

test('AC-sync-tip-relayed: the sync agent is handed one relay command line and answers only the printed line and a note', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  const { prompt, options } = agentCalls.sync
  assert.match(prompt.split('\n').at(-1), new RegExp(`^cd '/w' && python3 -c '[^']*"merge-base","--is-ancestor"[^']*' sync 'sync-${resumeTip}'$`))
  assert.deepEqual(Object.keys(options.schema.properties), ['printed', 'note'])
  assert.deepEqual(options.schema.required, ['printed'])
  assert.doesNotMatch(prompt, /stoppedOnConflict|merged true/)
})

const generated = { 'quality/baseline.toml': 'uv run quality baseline write .' }
const generatedSentence = /A conflict in a generated file is not resolved by hand: take either side, resolve the other conflicts, then run its command from the worktree on the merged tree, `git add` its path, and commit the merge once\./

for (const [what, generatedArg] of [['an array', ['quality/baseline.toml']], ['an empty command', { 'quality/baseline.toml': '' }], ['a non-string command', { 'quality/baseline.toml': 7 }]]) {
  test(`generated-input: generated given as ${what} fails at input`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, generated: generatedArg })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

test('generated-sync: the sync prompt tells the agent to regenerate a generated file on the merged tree and keeps -C on every git command', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, generated })
  const prompt = agentCalls.sync.prompt
  assert.match(prompt, generatedSentence)
  assert.ok(prompt.includes('quality/baseline.toml: uv run quality baseline write .'), prompt)
  assert.doesNotMatch(prompt.slice(prompt.indexOf('Bring the lane up to date')), /\bgit (?!-C '\/w' )/)
})

test('generated-facts: the builder and the fixer prompts carry the generated sentence and the command', async () => {
  const { agentCalls: builderCalls } = await runLane({ ...builtLane, generated }, { build: built })
  const { agentCalls: fixerCalls } = await runLane({ ...resumeArgs, generated, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  for (const prompt of [builderCalls.build.prompt, fixerCalls['fix-1'].prompt]) {
    assert.match(prompt, generatedSentence)
    assert.ok(prompt.includes('uv run quality baseline write .'), prompt)
  }
})

test('generated-failure: the sync prompt tells the agent to abort and put the output in note when the command fails, and a lane without main escalates at sync with that note', async () => {
  const note = 'uv run quality baseline write . exited 1: boom'
  const { agentCalls, result } = await runLane({ ...resumeArgs, generated }, { sync: { main_code: 1, note } })
  assert.match(agentCalls.sync.prompt, /command fails or leaves its path dirty or unmerged[^.]*merge --abort[^.]*put the command and its output in note/)
  assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'sync', note])
})

test('generated-absent: without generated no prompt mentions generated files', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  assert.doesNotMatch(agentCalls.sync.prompt, /generated/)
})

test('reread-report-path: a re-read that fails again still names the report path the review carried', async () => {
  const reportPath = '/scratch/r0-gate-out.json'
  const contradictoryCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 0, note: 'Verdict was REVISE, not failed' }
  const { result } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'r0-gate': { ...contradictoryCourier, reportPath }, 'r0-gate-reread': contradictoryCourier })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.ok(result.reason.includes(reportPath), result.reason)
})

test('resume-wording: the shared-red stop names a new run with pr and tip, not a resume', async () => {
  const check = (name, bucket) => ({ name, bucket })
  const sharedRed = 'quality / hygiene'
  const red = {
    head: resumeTip, green: false, requiredChecks: ['quality / verdict'],
    checks: [check('quality / verdict', 'pass'), check(sharedRed, 'fail')],
    failing: [{ where: sharedRed, kind: 'defect', text: `${sharedRed} fails`, rule: `CI check ${sharedRed}`, evidence: 'boom' }],
    baseChecks: [{ name: sharedRed, status: 'completed', conclusion: 'failure' }],
  }
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': { ...unchangedFix, resolved: [satisfied(tidy)] }, 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': red })
  assert.match(result.reason, /new run with pr and tip and fixFirst/)
  assert.doesNotMatch(result.reason, /resume with/)
})

test('AC-lane-shared-line-named: the builder and fixer prompts say the lane-shared: line of aco brief lists the files inside the scope', async () => {
  const { agentCalls: builderCalls } = await runLane(builtLane, { build: built })
  const { agentCalls: fixerCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  for (const prompt of [builderCalls.build.prompt, fixerCalls['fix-1'].prompt]) assert.match(prompt, /`aco brief <item>` prints it on its `lane-shared:` line/)
})

test('the sync prompt keeps every git -C command inside a backticked span', async () => {
  const variants = [resumeArgs, { ...resumeArgs, ledgers: ['LEDGER.md'] }, { ...resumeArgs, generated: { 'out.json': 'make out' } }]
  for (const args of variants) {
    const { agentCalls } = await runLane(args)
    const prose = agentCalls.sync.prompt.slice(agentCalls.sync.prompt.indexOf('Bring the lane up to date')).replace(/`[^`]*`/g, '')
    assert.doesNotMatch(prose, /git -C/, prose)
  }
})

const outsideFiles = ['src/skat/table/lobby.py', 'tests/test_board.py']
const endsGreenAt = (tip) => ({ 'e2e-0': PASS, 'ci-0': greenCi(tip) })

test('AC-outside-facts: the builder and the fixer prompts tell them to edit a path outside the claim, list it, and leave exclusive values alone', async () => {
  const { agentCalls: builderCalls } = await runLane(builtLane, { build: built })
  const { agentCalls: fixerCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  for (const prompt of [builderCalls.build.prompt, fixerCalls['fix-1'].prompt]) {
    assert.match(prompt, /needs a path outside the claim scope, edit it and list it with the reason/)
    assert.match(prompt, /Never touch a value another lane holds exclusively/)
    assert.doesNotMatch(prompt, /edit nothing there/)
  }
})

const outsidePathsPass = [
  ['after the build', builtLane, { build: built, 'scope-0': outsideClaim(outsideFiles), 'r0-review': APPROVE, ...endsGreenAt(resumeTip) }, ['build', 'scope-0', 'r0-review']],
  ['after a review fix', resumeArgs, { 'r0-review': reviseOnce, 'fix-1': aFixFor, 'scope-1': outsideClaim(outsideFiles), 'r1-review': APPROVE, ...endsGreenAt(resumeFixedTip) }, ['r0-review', 'fix-1', 'scope-1', 'r1-review']],
  ['after a carried fix', { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(outsideFiles), 'r1-review': APPROVE, ...endsGreenAt(resumeFixedTip) }, ['fix-1', 'scope-1', 'r1-review']],
  ['on a continued run', resumeArgs, { 'scope-resume': outsideClaim(outsideFiles), 'r0-review': APPROVE, ...endsGreenAt(resumeTip) }, ['scope-resume', 'r0-review']],
]

for (const [when, args, answers, expectedAgents] of outsidePathsPass) {
  test(`AC-outside-paths-pass: outside paths ${when} do not stop the lane and come back with the rescope action`, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.ok(launchedAgents.join(' ').includes(expectedAgents.join(' ')), launchedAgents.join(' '))
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.deepEqual(result.pathsOutsideClaim, outsideFiles)
    assert.ok(result.history.some(entry => entry.by === 'scope' && entry.passedOutside && outsideFiles.every(path => entry.outside.includes(path))), 'history records the paths')
    const rescopeActions = result.requiredHeadActions.filter(action => action.includes('aco rescope'))
    assert.equal(rescopeActions.length, 1)
    assert.ok(rescopeActions[0].includes(`aco rescope ${args.item} ${outsideFiles.map(path => `--add '${path}'`).join(' ')}\``), rescopeActions[0])
    assert.ok(!rescopeActions[0].includes('--whole'), rescopeActions[0])
  })
}

test('AC-outside-paths-pass: a lane whose outside list is empty returns no outside paths and no rescope action', async () => {
  const { result } = await runLane(resumeArgs, { 'r0-review': APPROVE, ...endsGreenAt(resumeTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.pathsOutsideClaim, [])
  assert.ok(!result.requiredHeadActions.some(action => action.includes('aco rescope')))
})

test('AC-outside-paths-pass: a path the newest scope check no longer lists is dropped from the paths and the rescope action', async () => {
  const answers = { build: built, 'scope-0': outsideClaim(outsideFiles), 'r0-review': reviseOnce, 'fix-1': aFixFor, 'scope-1': outsideClaim([outsideFiles[0]]), 'r1-review': APPROVE, ...endsGreenAt(resumeFixedTip) }
  const { result } = await runLane(builtLane, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.pathsOutsideClaim, [outsideFiles[0]])
  const [action] = result.requiredHeadActions.filter(entry => entry.includes('aco rescope'))
  assert.ok(action.includes(`--add '${outsideFiles[0]}'`) && !action.includes(outsideFiles[1]), action)
})

test('AC-outside-paths-pass: a fixer that reverts every outside path leaves no rescope action', async () => {
  const answers = { build: built, 'scope-0': outsideClaim(outsideFiles), 'r0-review': reviseOnce, 'fix-1': aFixFor, 'scope-1': outsideClaim([]), 'r1-review': APPROVE, ...endsGreenAt(resumeFixedTip) }
  const { result } = await runLane(builtLane, answers)
  assert.deepEqual(result.pathsOutsideClaim, [])
  assert.ok(!result.requiredHeadActions.some(action => action.includes('aco rescope')))
})

test('AC-outside-paths-pass: a directory among the outside paths adds --whole to the rescope action', async () => {
  const { result } = await runLane(resumeArgs, { 'scope-resume': outsideClaim(['docs/']), 'r0-review': APPROVE, ...endsGreenAt(resumeTip) })
  const [action] = result.requiredHeadActions.filter(entry => entry.includes('aco rescope'))
  assert.ok(action.includes(`--add 'docs/' --whole "`), action)
})

test('AC-outside-paths-pass: a single quote in an outside path is escaped in the rescope action', async () => {
  const { result } = await runLane(resumeArgs, { 'scope-resume': outsideClaim(["docs/it's.md"]), 'r0-review': APPROVE, ...endsGreenAt(resumeTip) })
  const [action] = result.requiredHeadActions.filter(entry => entry.includes('aco rescope'))
  assert.ok(action.includes(`--add 'docs/it'\\''s.md'`), action)
})

test('AC-outside-paths-pass: more than three outside paths add --whole to the rescope action', async () => {
  const fourFiles = [...outsideFiles, 'tests/test_a.py', 'tests/test_b.py']
  const { result } = await runLane(resumeArgs, { 'scope-resume': outsideClaim(fourFiles), 'r0-review': APPROVE, ...endsGreenAt(resumeTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  const [action] = result.requiredHeadActions.filter(entry => entry.includes('aco rescope'))
  assert.ok(action.includes(`${fourFiles.map(path => `--add '${path}'`).join(' ')} --whole "`), action)
})
