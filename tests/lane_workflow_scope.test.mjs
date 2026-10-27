// Drives the atelier lane workflow script through the sync, push, claim scope and rescope rules with a stub agent runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, APPROVE, PASS, greenCi, finding, webauthReplay, answersWith, resumeTip, resumeFixedTip, defectWithoutDraft, resumeFix, resumeArgs, bouncedTip, bounceFix, built, mergedOnlyTip, conflictsWithMain, mergeOnlyFix, reachesTheEnd } from './lane_workflow_harness.mjs'

const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }

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
      assert.ok(reviewPrompt.includes('git diff origin/main...HEAD'), 'the review sees the whole lane')
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
