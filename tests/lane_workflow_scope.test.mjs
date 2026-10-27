// Drives the atelier lane workflow script through the sync, push, claim scope and rescope rules with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi, finding, agentProvidersReplay, tidy, satisfied, unchangedFix, webauthReplay, answersWith, resumeTip, resumeFixedTip, defectWithoutDraft, resumeFix, resumeArgs, built, mergedOnlyTip, conflictsWithMain, mergeOnlyFix, reachesTheEnd } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

const outsideClaim = (paths) => ({ outside_claim: JSON.stringify(paths) })
const newRunWithBothChoices = /aco rescope[\s\S]*new run with pr and tip[\s\S]*fixFirst[\s\S]*revert[\s\S]*git log origin\/main\.\.\w+ -- board\.py/
const reviseOnce = { verdict: 'REVISE', blocking: [{ ...defectWithoutDraft, kind: 'docs' }], followups: [] }
const redCi = { head: resumeFixedTip, green: false, failing: [{ ...finding('ci', 'quality / verdict is red'), kind: 'defect' }], checks: [{ name: 'quality / verdict', bucket: 'fail' }], requiredChecks: ['quality / verdict'] }
const aFixFor = { ...resumeFix, regression: [] }

const scopeStops = [
  ['#316 AC-scope-stop-not-bounce: a review fixer that changed board.py ends awaiting-head at scope and names the tip before its fix as deltaFrom',
    resumeArgs, { 'r0-review': reviseOnce, 'fix-1': aFixFor, 'scope-1': outsideClaim(['board.py']) }, ['r0-review', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /no reviewer has seen/]],
  ['#316 AC-scope-stop-not-bounce: a CI fix outside the claim ends at scope with no fixer after it and names the unreviewed fix commits and the tip before the fix',
    resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': { ...redCi, head: resumeTip }, 'fix-1': aFixFor, 'scope-1': outsideClaim(['board.py']) }, ['e2e-0', 'ci-0', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /fix commits no reviewer has seen/]],
  ['#316 AC-scope-stop-not-bounce: a resume whose inherited commits are outside the claim ends at scope and names no deltaFrom',
    resumeArgs, { 'scope-resume': outsideClaim(['board.py']) }, ['sync', 'scope-resume'], resumeTip, [/earlier run/]],
  ['#316 AC-scope-stop-not-bounce: a resume with deltaFrom alone whose inherited commits are outside the claim names no deltaFrom',
    { ...resumeArgs, deltaFrom: resumeTip }, { 'scope-resume': outsideClaim(['board.py']) }, ['sync', 'scope-resume'], resumeTip, [/earlier run/]],
  ['#316 AC-scope-stop-not-bounce: a builder that left the claim scope ends at scope and names the merge-base as deltaFrom',
    builtLane, { build: built, 'scope-0': outsideClaim(['board.py']) }, ['build', 'scope-0'], resumeTip, ['deltaFrom the output of', /merge-base origin\/main/, /No reviewer has seen the build/]],
  ['#316 AC-scope-stop-not-bounce: a carried batch that ends outside the claim says the paths may come from earlier commits and names no deltaFrom',
    { ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(['board.py']) }, ['sync', 'fix-1', 'scope-1'], resumeFixedTip, [/earlier commits/]],
  ['#316 AC-scope-stop-not-bounce: a carried batch with deltaFrom that ends outside the claim names the deltaFrom the run was given',
    { ...resumeArgs, fixFirst: [defectWithoutDraft], deltaFrom: resumeTip }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(['board.py']) }, ['sync', 'fix-1', 'scope-1'], resumeFixedTip, [`deltaFrom ${resumeTip}`, /earlier commits/]],
]

for (const [behaviour, args, answers, expectedAgents, expectedTip, reasonParts] of scopeStops) {
  test(behaviour, async () => {
    const { result, launchedAgents } = await runLane(args, answers)
    assert.deepEqual(launchedAgents.slice(-expectedAgents.length), expectedAgents)
    assert.ok(!launchedAgents.some(label => /^(fix-[2-9])$/.test(label)), 'no fixer follows the scope check')
    assert.deepEqual([result.status, result.stage, result.outside, result.tip], ['awaiting-head', 'scope', ['board.py'], expectedTip])
    assert.match(result.reason, newRunWithBothChoices)
    assert.doesNotMatch(result.reason, /resume/i)
    for (const part of reasonParts) assert.ok(typeof part === 'string' ? result.reason.includes(part) : part.test(result.reason), `${part}: ${result.reason}`)
    if (!reasonParts.some(part => typeof part === 'string')) assert.doesNotMatch(result.reason, /deltaFrom/)
    assert.deepEqual(result.history.at(-1), { by: 'scope', outside: ['board.py'], tip: expectedTip })
  })
}

test('#316 AC-scope-stop-not-bounce: outside_claim [] after a fixer goes to review unchanged', async () => {
  const { launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFixFor })
  assert.deepEqual(launchedAgents.slice(1, 4), ['fix-1', 'scope-1', 'r1-review'])
})

test('#316 AC-carried-batch-checked-after: a resume carrying fixFirst over inherited outside commits runs no scope check before the batch, and the check after it decides', async () => {
  const { result, launchedAgents } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'scope-resume': outsideClaim(['board.py']), 'fix-1': aFixFor, 'scope-1': outsideClaim([]), ...reachesTheEnd, 'ci-0': greenCi(resumeFixedTip) })
  assert.ok(!launchedAgents.includes('scope-resume'))
  assert.deepEqual(launchedAgents.slice(0, 4), ['sync', 'fix-1', 'scope-1', 'r1-review'])
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('#316 AC-scope-stop-folds-nothing: a scope stop after a batch with fold-ins reports none of them as folded', async () => {
  const { result } = await runLane({ ...resumeArgs, foldIn: [tidy] }, { 'fix-1': aFixFor, 'scope-1': outsideClaim(['board.py']) })
  assert.equal(result.stage, 'scope')
  assert.deepEqual(result.folded, [])
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
  ['the builder', builtLane, { build: { ...built, rescope: rescopeRequest } }, 'build', { pr: 2, tip: resumeTip, unreviewed: true, lastBlocking: undefined }],
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
    if (stage === 'fix') assert.ok(result.history.some(entry => entry.tip === resumeFixedTip && !entry.reviewed))
    assert.ok(!launchedAgents.some(label => label.startsWith('scope-') && label !== 'scope-resume'))
    assert.ok(!launchedAgents.some(label => label.includes('review')))
  })
}

test('#131 AC-build-rescope-names-the-base: the build hand-back names the merge-base command with the worktree and the returned tip', async () => {
  const { result } = await runLane(builtLane, { build: { ...built, rescope: rescopeRequest } })
  assert.ok(result.reason.includes(`git -C '/w' merge-base origin/main ${resumeTip}`), result.reason)
  assert.ok(result.reason.includes("git -C '/w' fetch origin"), result.reason)
})

test('a build together with pr and tip is refused at input', async () => {
  const { result, launchedAgents } = await runLane({ ...builtLane, pr: 2, tip: resumeTip })
  assert.deepEqual([result.status, result.stage], ['failed', 'input'])
  assert.deepEqual(launchedAgents, [])
})

test('a build rescope stop without a pull request names a new run with build and not resumeFromRunId', async () => {
  const { result } = await runLane(builtLane, { build: { ...built, pr: 0, rescope: rescopeRequest } })
  assert.match(result.reason, /new run with build/)
  assert.doesNotMatch(result.reason, /resume/i)
})

test('a build rescope stop with a pull request names a new run with pr and tip', async () => {
  const { result } = await runLane(builtLane, { build: { ...built, rescope: rescopeRequest } })
  assert.match(result.reason, /new run with pr and tip and fixFirst/)
  assert.doesNotMatch(result.reason, /resume/i)
})

test('#131 AC-build-rescope-resume-reviews-the-build: resuming a build hand-back as its sentence says has the review and the gate judge deltaFrom..HEAD', async () => {
  const mergeBase = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
  const fixFirst = rescopeRequest.map(({ path, change, reason }) => ({ ...finding(path, change), evidence: reason, kind: 'defect' }))
  const answers = { 'fix-1': { ...resumeFix, regression: [] }, 'r1-review': APPROVE, 'r1-gate': { ...APPROVE, codexExit: 0 }, 'e2e-0': PASS, 'ci-0': greenCi(resumeFixedTip) }
  const { result, agentCalls } = await runLane({ ...resumeArgs, risk: 'material', fixFirst, deltaFrom: mergeBase }, answers)
  assert.equal(result.status, 'ready-to-land')
  for (const label of ['r1-review', 'r1-gate']) assert.ok(agentCalls[label].prompt.includes(`git diff ${mergeBase}..HEAD`), label)
})

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
test('#118 AC-answer-not-aco: a push that succeeded but an empty outside_claim stops at scope naming the omission', async () => {
  const { result, launchedAgents } = await runLane(builtLane, { build: built, 'scope-0': { remote_tip: built.tip, outside_claim: '' } })
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

const acoPrints = ['', 'null', '[]', '["a.py"]', '["a.py", "dir/b c.py"]', '["caf\\u00e9/\\u3042.py"]', '["a\\"b.py"]']

const slipsAndForeignText = [' ', '"claimed"', '{"a":1}', '[1]', '["a.py", 2]', 'true', 'not json', 'ERROR: no claim store', 'null null', '[] []']

for (const [printed, admitted] of [...acoPrints.map(text => [text, true]), ...slipsAndForeignText.map(text => [text, false])]) {
  test(`#118 AC-schema-admits-aco-only: the scope agent's schema ${admitted ? 'admits' : 'refuses'} ${JSON.stringify(printed)} as outside_claim`, async () => {
    const { properties } = await scopeSchemaOf()
    assert.equal(properties.outside_claim.type, 'string')
    assert.equal(new RegExp(properties.outside_claim.pattern).test(printed), admitted)
  })
}

test('#323 AC-failed-command-own-field: the schema requires all three fields, so a failed command is answered with empty strings for the others', async () => {
  const schema = await scopeSchemaOf()
  assert.equal(schema.properties.command_error.type, 'string')
  assert.deepEqual([...schema.required].sort(), ['command_error', 'outside_claim', 'remote_tip'])
  assert.ok(new RegExp(schema.properties.outside_claim.pattern).test(''))
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

const syncedTip = 'd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0'
const reachesTheEndAt = (tip) => ({ ...reachesTheEnd, 'r0-review': APPROVE, 'ci-0': greenCi(tip) })

for (const merged of [false, true]) {
  test(`#267 AC-sync-tip-adopted: a resume whose sync answers merged ${merged} with another tip reviews and reports that tip`, async () => {
    const answers = { ...reachesTheEndAt(syncedTip), sync: { merged, tip: syncedTip, stoppedOnConflict: false } }
    const { result, launchedAgents } = await runLane(resumeArgs, answers)
    assert.ok(launchedAgents.includes('r0-review'), launchedAgents.join())
    assert.equal(result.tip, syncedTip)
  })
}

test('#267 AC-sync-tip-adopted: a sync tip that is not a sha fails the lane at sync', async () => {
  const { result } = await runLane(resumeArgs, { sync: { merged: false, tip: 'not a sha', stoppedOnConflict: false } })
  assert.deepEqual([result.status, result.stage], ['failed', 'sync'])
})

test('#267 AC-sync-tip-adopted: a moved branch with merged false names both tips in the history', async () => {
  const { result } = await runLane(resumeArgs, { ...reachesTheEndAt(syncedTip), sync: { merged: false, tip: syncedTip, stoppedOnConflict: false } })
  const moved = result.history.find(entry => entry.by === 'sync')
  assert.deepEqual([moved.from, moved.tip], [resumeTip, syncedTip])
})

const generated = { 'quality/baseline.toml': 'uv run quality baseline write .' }
const generatedSentence = /A conflict in a generated file is not resolved by hand: take either side, resolve the other conflicts, then run its command from the worktree on the merged tree, `git add` its path, and commit the merge once\./

for (const [what, generatedArg] of [['an array', ['quality/baseline.toml']], ['an empty command', { 'quality/baseline.toml': '' }], ['a non-string command', { 'quality/baseline.toml': 7 }]]) {
  test(`#298 generated-input: generated given as ${what} fails at input`, async () => {
    const { result, launchedAgents } = await runLane({ ...resumeArgs, generated: generatedArg })
    assert.deepEqual([result.status, result.stage], ['failed', 'input'])
    assert.deepEqual(launchedAgents, [])
  })
}

test('#298 generated-sync: the sync prompt tells the agent to regenerate a generated file on the merged tree and keeps -C on every git command', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, generated })
  const prompt = agentCalls.sync.prompt
  assert.match(prompt, generatedSentence)
  assert.ok(prompt.includes('quality/baseline.toml: uv run quality baseline write .'), prompt)
  assert.doesNotMatch(prompt.slice(prompt.indexOf('Bring the lane up to date')), /\bgit (?!-C '\/w' )/)
})

test('#298 generated-facts: the builder and the fixer prompts carry the generated sentence and the command', async () => {
  const { agentCalls: builderCalls } = await runLane({ ...builtLane, generated }, { build: built })
  const { agentCalls: fixerCalls } = await runLane({ ...resumeArgs, generated, fixFirst: [defectWithoutDraft] }, { 'fix-1': resumeFix })
  for (const prompt of [builderCalls.build.prompt, fixerCalls['fix-1'].prompt]) {
    assert.match(prompt, generatedSentence)
    assert.ok(prompt.includes('uv run quality baseline write .'), prompt)
  }
})

test('#298 generated-failure: the sync prompt tells the agent to abort and return stoppedOnConflict when the command fails, and that answer escalates at sync', async () => {
  const note = 'uv run quality baseline write . exited 1: boom'
  const { agentCalls, result } = await runLane({ ...resumeArgs, generated }, { sync: { merged: false, tip: resumeTip, stoppedOnConflict: true, note } })
  assert.match(agentCalls.sync.prompt, /command fails or leaves its path dirty or unmerged[^.]*merge --abort[^.]*stoppedOnConflict true[^.]*output/)
  assert.deepEqual([result.status, result.stage, result.reason], ['escalated', 'sync', note])
})

test('#298 generated-absent: without generated no prompt mentions generated files', async () => {
  const { agentCalls } = await runLane(resumeArgs)
  assert.doesNotMatch(agentCalls.sync.prompt, /generated/)
})

test('#298 resume-wording: a fixer rescope stop names a new run with pr and tip, not a resume', async () => {
  const { result } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': { ...resumeFix, rescope: rescopeRequest } })
  assert.match(result.reason, /new run with pr and tip and fixFirst/)
  assert.doesNotMatch(result.reason, /resume with/)
})

test('#298 reread-report-path: a re-read that fails again still names the report path the review carried', async () => {
  const reportPath = '/scratch/r0-gate-out.json'
  const contradictoryCourier = { verdict: 'failed', blocking: [], followups: [], codexExit: 0, note: 'Verdict was REVISE, not failed' }
  const { result } = await runLane(agentProvidersReplay.args, { ...agentProvidersReplay.answers, 'r0-gate': { ...contradictoryCourier, reportPath }, 'r0-gate-reread': contradictoryCourier })
  assert.deepEqual([result.status, result.stage], ['failed', 'review'])
  assert.ok(result.reason.includes(reportPath), result.reason)
})

test('#298 resume-wording: the shared-red stop names a new run with pr and tip, not a resume', async () => {
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
