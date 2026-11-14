// The lane workflow reports CI green only from the printed check values of the tip, never from the CI agent's word.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, partReplaced, runCommandLine, installFake, resumeArgs, resumeFix, mergeOnlyFix, mainMovedTip, defectWithoutDraft, PASS, APPROVE, greenCi, tidy } from './lane_workflow_harness.mjs'

const tip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const lane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip }
const alreadySatisfied = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
const reachesCi = { 'fix-1': alreadySatisfied, 'r1-review': { verdict: 'APPROVE', blocking: [], followups: [] }, 'e2e-0': { verdict: 'PASS', blocking: [], followups: [], cells: [{ cell: 'c', result: 'held', command: 'run', exit: '0' }] } }
const required = 'quality / verdict'
const check = (name, bucket) => ({ name, bucket })
const ciAnswer = (checks, extra = {}) => ({ head: tip, green: true, failing: [], checks, requiredChecks: [required], ...extra })
const driveCi = (ci, args = lane, read, more = {}) => runLane({ ...args, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ci, ...(read && { 'ci-read-0': read }), ...more })

const unproven = [
  ['a pending check', [check(required, 'pass'), check('Python: tests', 'pending')], /Python: tests/],
  ['a red check among several passing ones', [check(required, 'pass'), check('a', 'pass'), check('b', 'fail'), check('c', 'pass')], /b/],
  ['a red check together with a pending one', [check(required, 'pass'), check('b', 'fail'), check('c', 'pending')], /b/],
  ['a cancelled check', [check(required, 'pass'), check('b', 'cancel')], /b/],
  ['a required check missing from the listing', [check('Python: tests', 'pass')], /quality \/ verdict/],
  ['a required check listed as pending', [check(required, 'pending')], /quality \/ verdict/],
  ['a required check listed as skipping', [check(required, 'skipping')], /quality \/ verdict/],
  ['a red check and a required check missing', [check('Python: tests', 'fail')], /Python: tests[\s\S]*quality \/ verdict/],
  ['a red check and a required check pending', [check('b', 'fail'), check(required, 'pending')], /"b"[\s\S]*quality \/ verdict/],
  ['an empty listing', [], /no checks/i],
]
for (const [what, checks, reason] of unproven) {
  test(`AC-ci-listing-proof: ${what} fails the lane at ci although the agent says green`, async () => {
    const { result, launchedAgents } = await driveCi(ciAnswer(checks))
    assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
    assert.match(result.reason, reason)
    assert.equal(result.history.at(-1).by, 'ci-0')
    assert.equal(result.history.at(-1).verdict, 'RED')
    assert.ok(!launchedAgents.includes('fix-2'))
  })
}

test('ci-relay-line: a printed rules exit code fails the lane at ci naming the exit and the printed error and launches no fixer', async () => {
  const { result, launchedAgents } = await driveCi(ciAnswer([check(required, 'pass')]), lane, { rules_code: 1, rules_error: 'HTTP 403: forbidden' })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /exited 1: HTTP 403: forbidden/)
  assert.equal(result.history.at(-1).by, 'ci-0')
  assert.equal(result.history.at(-1).verdict, 'RED')
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-relay-line: a watcher answer carrying requiredChecksError null reaches ready-to-land when the printed line proves green', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { requiredChecksError: 'null' }))
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('ci-relay-line: the head the watcher answers does not count, the printed head does', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')]), lane, { pr_head: 'd0d0d0d' })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /d0d0d0d/)
})

test('ci-relay-line: the checks the watcher copies do not count, the printed listing does', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')]), lane, { checks: [check(required, 'pass'), check('Python: tests', 'fail')] })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /Python: tests/)
})

test('ci-relay-line: a failed gh pr view fails the lane at ci naming its exit and error', async () => {
  const { result, launchedAgents } = await driveCi(ciAnswer([check(required, 'pass')]), lane, { view_code: 1, view_error: 'no pull requests found' })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /gh pr view exited 1: no pull requests found/)
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-relay-line: a nonzero gh pr checks exit leaves a green watcher unproven, naming the exit and the printed error', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')]), lane, { checks_code: 1, checks_error: "no checks reported on the 'b' branch" })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /gh pr checks exited 1: no checks reported on the 'b' branch/)
})

test('ci-relay-line: a nonzero gh pr checks exit with a red watcher still reaches a fixer with its quoted entries', async () => {
  const failing = [{ where: 'Python: tests', kind: 'defect', text: 'fails', rule: 'CI check Python: tests', evidence: 'boom' }]
  const { agentCalls } = await driveCi(ciAnswer([], { green: false, failing }), lane, { checks_code: 1, checks_error: 'no checks reported' })
  assert.match(agentCalls['fix-2'].prompt, /Python: tests/)
})

for (const [what, mishandling] of [['an edited line', { edit: (line) => line.replace('"shared":[]', '"shared":["x"]') }], ['a wrong nonce', { nonce: 'ci-0-other' }]]) {
  test(`ci-relay-line: ${what} fails the lane at ci and the watcher's word is not used instead`, async () => {
    const { result } = await driveCi(ciAnswer([check(required, 'pass')]), lane, mishandling)
    assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
    assert.match(result.reason, /relay line/)
  })
}

test('ci-relay-line: with repo set the printer is told the repository, without it the worktree repository', async () => {
  const withRepo = await driveCi(ciAnswer([check(required, 'pass')]), { ...lane, repo: 'o/n' })
  const without = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.match(withRepo.agentCalls['ci-read-0'].prompt, / ci 1 'o\/n' 'ci-0-/)
  assert.match(without.agentCalls['ci-read-0'].prompt, / ci 1 '' 'ci-0-/)
})

const proven = [
  ['a clean listing', [check(required, 'pass'), check('a', 'pass')]],
  ['a skipping check', [check(required, 'pass'), check('a', 'skipping')]],
]
for (const [what, checks] of proven) {
  test(`AC-ci-listing-proof: ${what} reaches ready-to-land`, async () => {
    const { result } = await driveCi(ciAnswer(checks))
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(result.history.at(-1).verdict, 'GREEN')
  })
}

test('AC-ci-listing-proof: a conflicting pull request answered with empty arrays and green false still goes to a fixer', async () => {
  const failing = [{ where: 'mergeable', kind: 'defect', text: 'conflicts', rule: 'GitHub runs no CI on a conflicting pull request', evidence: 'CONFLICTING' }]
  const { launchedAgents } = await driveCi({ head: tip, green: false, failing, checks: [], requiredChecks: [], baseChecks: [] })
  assert.ok(launchedAgents.includes('fix-2'))
})

test('AC-ci-listing-proof: green false with a failing finding still goes to a fixer', async () => {
  const failing = [{ where: 'Python: tests', kind: 'defect', text: 'fails', rule: 'CI check Python: tests', evidence: 'boom' }]
  const { launchedAgents } = await driveCi(ciAnswer([check('Python: tests', 'fail')], { green: false, failing }))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('AC-ci-listing-proof: a red watcher answer without findings reaches the fixer with one finding per failed check of the printed listing', async () => {
  const failed = ['quality / check', 'quality / sonar', 'quality / verdict']
  const { agentCalls } = await driveCi(ciAnswer(failed.map(name => check(name, 'fail')), { green: false, failing: [] }))
  for (const name of failed) assert.match(agentCalls['fix-2'].prompt, new RegExp(`CI check ${name}`))
})

test('AC-ci-listing-proof: green false with all checks passing does not become ready-to-land', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { green: false }))
  assert.notEqual(result.status, 'ready-to-land')
  assert.equal(result.history.at(-1).verdict, 'RED')
})

test('ci-relay-line: the CI brief keeps the registration wait, the re-watch rule and the rules read for pacing only, and returns no listing', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]), { ...lane, repo: 'o/n' })
  const brief = agentCalls['ci-0'].prompt
  assert.match(brief, /repos\/o\/n\/rules\/branches/)
  assert.match(brief, / -R o\/n/)
  assert.doesNotMatch(brief, /cd '\/w'/)
  assert.match(brief, /neither what you read nor its error is returned or judged/)
  assert.match(brief, /watch again; re-watching shares the cap/)
  assert.doesNotMatch(brief, /requiredChecksError|baseChecks|into checks|as head/)
})

test('AC-ci-listing-proof: without repo the CI brief runs the rules read in the worktree', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.match(agentCalls['ci-0'].prompt, /cd '\/w' && gh api repos\/\{owner\}\/\{repo\}\/rules\/branches/)
})

const drivePassingCi = (options) => runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ciAnswer([check(required, 'pass')]) }, options)

test('a CI part that throws fails the lane at ci naming the error', async () => {
  const { result } = await drivePassingCi({ transform: partReplaced('laneCi', "throw new Error('the child exploded')") })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /the child exploded/)
})

const redOnHead = (name) => ({ where: name, kind: 'defect', text: `${name} fails`, rule: `CI check ${name}`, evidence: 'boom' })
let runId = 0
const run = (name, conclusion, completedAt = '2026-11-13T10:00:00Z') => ({ id: ++runId, name, status: conclusion ? 'completed' : 'in_progress', conclusion, completed_at: conclusion ? completedAt : null })
const redCi = (names, baseChecks) => ciAnswer([check(required, 'pass'), ...names.map(name => check(name, 'fail'))], { green: false, failing: names.map(redOnHead), ...(baseChecks ? { baseChecks } : {}) })

test('ci-shared-red: a check red on head and on the base launches no fixer and goes to the head naming it', async () => {
  const { result, launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'failure')]))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /quality \/ hygiene/)
  assert.match(result.reason, /fixFirst/)
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-shared-red: a check red on head but green on the base still gets its fixer', async () => {
  const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'success')]))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('ci-shared-red: a shared red together with a red of the lane own sends only the own red to the fixer and does not stop the lane', async () => {
  const { result, agentCalls } = await driveCi(redCi(['quality / hygiene', 'Python: tests'], [run('quality / hygiene', 'failure'), run('Python: tests', 'success')]))
  assert.notEqual(result.status, 'awaiting-head')
  assert.match(agentCalls['fix-2'].prompt, /Python: tests/)
  assert.doesNotMatch(agentCalls['fix-2'].prompt, /quality \/ hygiene/)
})

test('ci-shared-red: findings quoted as path:line under a shared check stay out of the fixer while another check own findings go in', async () => {
  const sonarFinding = { where: 'src/a.py:4', kind: 'defect', text: 'duplicated lines', rule: 'python:S1192', evidence: 'sonar src/a.py:4' }
  const sharedJob = { ...redJob('quality / sonar', 'Run sonar'), findings: [sonarFinding] }
  const ownJob = redJob('quality / check', 'Run check', ['11', '23'])
  const baseChecks = [run('quality / sonar', 'failure'), run('quality / check', 'success')]
  const answer = ciAnswer([check(required, 'pass'), check('quality / sonar', 'fail'), check('quality / check', 'fail')], { green: false, failing: [sonarFinding, ...ownJob.findings], red: [sharedJob, ownJob], baseChecks })
  const { agentCalls } = await driveCi(answer)
  assert.match(agentCalls['fix-2'].prompt, /quality \/ check/)
  assert.doesNotMatch(agentCalls['fix-2'].prompt, /src\/a\.py:4/)
})

const sonarFinding = { where: 'src/a.py:4', kind: 'defect', text: 'duplicated lines', rule: 'python:S1192', evidence: 'sonar src/a.py:4' }
const sonarRed = (changedFiles) => {
  const sonarJob = { ...redJob('quality / sonar', 'Run sonar'), findings: [sonarFinding] }
  return ciAnswer([check(required, 'pass'), check('quality / sonar', 'fail')], { green: false, failing: [sonarFinding], red: [sonarJob], baseChecks: [run('quality / sonar', 'failure')], changedFiles })
}

test('ci-own-finding: a finding in a file the lane changed reaches the fixer although its check is red on the base', async () => {
  const { result, agentCalls } = await driveCi(sonarRed(['src/a.py']))
  assert.notEqual(result.status, 'awaiting-head')
  assert.match(agentCalls['fix-2'].prompt, /src\/a\.py:4/)
})

test('ci-own-finding: a finding of the same check in a file the lane did not change stays shared with the base', async () => {
  const { result, launchedAgents } = await driveCi(sonarRed(['src/other.py']))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-run-wait: the ci brief tells the watcher to read the head workflow runs and keep watching while one is open', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.match(agentCalls['ci-0'].prompt, /gh run list --commit/)
})

for (const [what, baseChecks] of [['an empty baseChecks', []], ['no baseChecks', undefined], ['a base run of the same name still pending', [run('quality / hygiene', null)]], ['a name missing on the base', [run('other', 'failure')]]]) {
  test(`ci-shared-red: ${what} runs CI fixing as before`, async () => {
    const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], baseChecks))
    assert.ok(launchedAgents.includes('fix-2'))
  })
}

test('ci-shared-red: a base check whose latest completed run passed is no shared red, even when an earlier run failed', async () => {
  const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'failure', '2026-11-13T10:00:00Z'), run('quality / hygiene', 'success', '2026-11-13T11:00:00Z')]))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('ci-shared-red: a base check whose latest completed run failed is shared red, whatever the order of the listing', async () => {
  const { result, launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'failure', '2026-11-13T11:00:00Z'), run('quality / hygiene', 'success', '2026-11-13T10:00:00Z')]))
  assert.equal(result.status, 'awaiting-head')
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-shared-red: two runs completed at the same second: the higher id is the latest', async () => {
  const failed = run('quality / hygiene', 'failure')
  const passed = run('quality / hygiene', 'success')
  const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], [passed, failed]))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('ci-shared-red: a shared red with a blocking end-to-end finding gives the fixer only the end-to-end finding', async () => {
  const e2eFinding = { where: 'flow.py:3', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
  const answers = { ...reachesCi, 'e2e-0': { verdict: 'FAIL', blocking: [e2eFinding], followups: [] }, 'ci-0': redCi(['quality / hygiene'], [run('quality / hygiene', 'failure')]) }
  const { agentCalls } = await runLane({ ...lane, foldIn: [tidy] }, answers)
  const brief = agentCalls['fix-2'].prompt
  assert.match(brief, /flow\.py:3/)
  assert.doesNotMatch(brief, /quality \/ hygiene/)
})

test('ci-shared-red: base runs spread over several pages are all searched for the failure', async () => {
  const { result } = await driveCi(redCi(['quality / hygiene'], [run('a', 'success'), run('b', 'success'), run('quality / hygiene', 'failure')]))
  assert.equal(result.status, 'awaiting-head')
})

const registrationLoopOf = (brief) => brief.match(/for i in \$\(seq 1 5\); do .*?; done/)[0]

for (const [what, args, prefix] of [['without repo', lane, "cd '/w' && "], ['with repo', { ...lane, repo: 'o/n' }, '']]) {
  test(`ci-registration-wait: ${what} the registration wait stands after the conflicting-PR sentence and before the watch`, async () => {
    const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]), args)
    const brief = agentCalls['ci-0'].prompt
    const countCommand = `${prefix}for i in $(seq 1 5); do [ "$(gh pr checks 1${args.repo ? ' -R o/n' : ''} --json name --jq length 2>/dev/null)" -gt 0 ]`
    const at = brief.indexOf(countCommand)
    assert.ok(at > brief.indexOf('CONFLICTING'), 'the wait follows the conflicting-PR sentence')
    assert.ok(at < brief.indexOf('--watch'), 'the wait precedes the watch')
    assert.match(brief, /no CI checks ran on the head commit/)
  })
}

const runRegistrationLoop = (neverRegisters, scratch) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-loop-'))
  const counter = path.join(dir, 'calls')
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\necho x >> '${counter}'\n${neverRegisters ? 'echo 0' : `[ "$(wc -l < '${counter}')" -ge 3 ] && echo 2 || exit 1`}\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const result = spawnSync('bash', ['-c', scratch], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })
  return { status: result.status, tries: fs.readFileSync(counter, 'utf8').split('\n').filter(Boolean).length }
}

test('ci-registration-wait: the loop ends at the first positive check count', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.deepEqual(runRegistrationLoop(false, registrationLoopOf(agentCalls['ci-0'].prompt)), { status: 0, tries: 3 })
})

test('ci-registration-wait: the loop stops after 5 tries with status 0 when no check ever registers', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.deepEqual(runRegistrationLoop(true, registrationLoopOf(agentCalls['ci-0'].prompt)), { status: 0, tries: 5 })
})

const lockBusy = { verdict: 'failed', lockBusy: true, blocking: [], followups: [] }
const loadWaits = [
  ['green', ciAnswer([check(required, 'pass')]), /green/],
  ['unreadable', { problem: 'lane-ci failed: boom' }, /not readable/],
]
for (const [what, ci, state] of loadWaits) {
  test(`load-wait: the load staying high twice with CI ${what} go to the head at test and launch no fixer`, async () => {
    const { result, launchedAgents } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': lockBusy, 'e2e-1': lockBusy, 'ci-0': ci, 'ci-1': ci })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'test'])
    assert.match(result.reason, /^load wait:/)
    assert.match(result.reason, state)
    assert.match(result.reason, /pr and tip/)
    assert.ok(!launchedAgents.some(agent => agent.startsWith('fix-2')))
  })
}

const cell = (result) => ({ cell: `a ${result} cell`, result, command: 'node run.mjs', exit: result === 'held' ? '0' : '1' })
const testerAnswer = (cells) => ({ ...reachesCi['e2e-0'], cells })
const withoutHeldCell = [
  ['no cells at all', []],
  ['only cells that were not driven', [cell('not driven'), cell('not driven')]],
  ['only failed cells', [cell('failed')]],
]
for (const [what, cells] of withoutHeldCell) {
  test(`a tester PASS with ${what} fails the lane at test`, async () => {
    const { result } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': testerAnswer(cells), 'ci-0': ciAnswer([check(required, 'pass')]) })
    assert.deepEqual([result.status, result.stage], ['failed', 'test'])
    assert.match(result.reason, /a PASS without driven cells/)
  })
}

test('the cells of a tester PASS reach the result history, held, failed and not driven alike', async () => {
  const cells = [cell('held'), cell('failed'), cell('not driven')]
  const { result } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': testerAnswer(cells), 'ci-0': ciAnswer([check(required, 'pass')]) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.history.find(entry => entry.by === 'e2e-0').cells, cells)
})

// A lane whose only red is the verdict of declared loosenings: the printer reads that job log through a fake gh.
const verdictLink = 'https://github.com/o/n/actions/runs/11/job/22'
const loosenLine = (text) => `verdict\tUNKNOWN STEP\t2026-11-08T04:00:00.0000000Z \u001b[31m${text}\u001b[0m`
const loosened = [loosenLine('! red · only declared loosenings · only the operator merges it · 3s'), loosenLine('next: quality merge o/n#905')]
const door = /merge door[\s\S]*quality merge o\/n#905/
const fakeGhWithLog = (t, { logLines, logCode = 0 }) => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-ci-gh-'))
  t.after(() => fs.rmSync(bin, { recursive: true }))
  const calls = path.join(bin, 'calls')
  fs.writeFileSync(path.join(bin, 'log'), logLines.join('\n'))
  installFake(bin, 'gh', `#!/bin/sh
echo "$*" >> '${calls}'
case "$1 $2" in
  "pr view") printf '{"baseRefName":"main","headRefOid":"%s","files":[]}' "$FAKE_PR_HEAD" ;;
  "pr checks") printf '%s' "$FAKE_CHECKS" ;;
  "run view") [ ${logCode} = 0 ] || { echo 'HTTP 410: logs expired' >&2; exit ${logCode}; }; cat '${path.join(bin, 'log')}' ;;
  *) printf '[]' ;;
esac
`)
  return { bin, calls }
}
const printingWith = (bin, checks, head = tip) => (prompt) => ({
  printed: runCommandLine(prompt.split('\n').at(-1).replace(/^cd '[^']*' && /, ''), { cwd: os.tmpdir(), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_PR_HEAD: head, FAKE_CHECKS: JSON.stringify(checks) } }),
})
const redVerdict = [{ name: required, bucket: 'fail', link: verdictLink }, { name: 'Python: tests', bucket: 'pass', link: 'https://github.com/o/n/actions/runs/11/job/23' }]
const verdictFailing = [{ where: required, kind: 'defect', text: 'red', rule: 'CI check quality / verdict', evidence: 'red' }]
const verdictRedCi = ciAnswer([], { green: false, failing: verdictFailing })

test('ci-operator-door: a verdict red by declared loosenings alone ends the lane awaiting-head at ci with the quality merge command and no fixer', async (t) => {
  const { bin, calls } = fakeGhWithLog(t, { logLines: loosened })
  const { result, launchedAgents } = await driveCi(verdictRedCi, lane, printingWith(bin, redVerdict))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, door)
  assert.ok(!launchedAgents.includes('fix-2'))
  assert.match(fs.readFileSync(calls, 'utf8'), /run view --job 22 .*--log/)
})

test('ci-operator-door: the two log lines in the other order, with the next line first, end the same way', async (t) => {
  const { bin } = fakeGhWithLog(t, { logLines: [...loosened].reverse() })
  const { result } = await driveCi(verdictRedCi, lane, printingWith(bin, redVerdict))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, door)
})

test('ci-operator-door: the relay line carries neither log text nor escape bytes', async (t) => {
  const { bin } = fakeGhWithLog(t, { logLines: loosened })
  const { agentCalls } = await driveCi(verdictRedCi, lane, printingWith(bin, redVerdict))
  const line = printingWith(bin, redVerdict)(agentCalls['ci-read-0'].prompt).printed
  assert.doesNotMatch(line, /UNKNOWN STEP|u001b|declared/)
})

const notTheDoor = [
  ['a verdict log without the loosenings line', { logLines: [loosenLine('! red · 2 findings · 3s')] }, redVerdict],
  ['a verdict log whose read failed', { logLines: [], logCode: 1 }, redVerdict],
  ['a loosenings log without a merge command', { logLines: [loosened[0]] }, redVerdict],
  ['another red check next to the verdict', { logLines: loosened }, [...redVerdict, { name: 'Python: tests', bucket: 'fail', link: 'https://github.com/o/n/actions/runs/11/job/24' }]],
  ['a merge line whose owner is shell text, not a command shape', { logLines: [loosened[0], loosenLine('next: quality merge o/r$(id);`x`#9')] }, redVerdict],
  ['a verdict that is red without a job link', { logLines: loosened }, [{ name: required, bucket: 'fail', link: '' }]],
]
for (const [what, gh, checks] of notTheDoor) {
  test(`ci-operator-door: ${what} still goes to a fixer`, async (t) => {
    const { bin } = fakeGhWithLog(t, gh)
    const { launchedAgents } = await driveCi(verdictRedCi, lane, printingWith(bin, checks))
    assert.ok(launchedAgents.includes('fix-2'))
  })
}

test('ci-operator-door: a log that names the loosenings of another check than the verdict is never read', async (t) => {
  const { bin, calls } = fakeGhWithLog(t, { logLines: loosened })
  const checks = [{ name: required, bucket: 'pass', link: verdictLink }, { name: 'Python: tests', bucket: 'fail', link: 'https://github.com/o/n/actions/runs/11/job/23' }]
  const { launchedAgents } = await driveCi(ciAnswer([], { green: false, failing: verdictFailing }), lane, printingWith(bin, checks))
  assert.ok(launchedAgents.includes('fix-2'))
  assert.ok(!fs.existsSync(calls) || !/run view/.test(fs.readFileSync(calls, 'utf8')))
})

test('ci-operator-door: a blocking end-to-end finding sends the lane to the fixer even when the only red is the operator door', async (t) => {
  const { bin } = fakeGhWithLog(t, { logLines: loosened })
  const blocked = { verdict: 'FAIL', blocking: [{ where: 'x', text: 't', rule: 'r', evidence: 'e', kind: 'defect' }], followups: [], cells: [{ cell: 'c', result: 'failed', command: 'run', exit: '1' }] }
  const { launchedAgents } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': blocked, 'ci-0': verdictRedCi, 'ci-read-0': printingWith(bin, redVerdict) })
  assert.ok(launchedAgents.includes('fix-2'))
})

const redJob = (name, failingStep, ids = ['11', '22']) => ({ name, link: `https://github.com/o/n/actions/runs/${ids[0]}/job/${ids[1]}`, runId: ids[0], jobId: ids[1], failingStep, findings: [redOnHead(name)] })
const redWatch = (jobs, checks = jobs.map(job => check(job.name, 'fail'))) => ciAnswer([check(required, 'pass'), ...checks], { green: false, failing: jobs.flatMap(job => job.findings), red: jobs })
const rerunLabels = (launchedAgents) => launchedAgents.filter(label => label.startsWith('ci-0-rerun'))

test('ci-setup-failure: two red checks are both handed to the fixer and nothing is re-run', async () => {
  const { agentCalls, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Run the node tests'), redJob('Python: tests', 'Run the python tests', ['11', '23'])]))
  assert.match(agentCalls['fix-2'].prompt, /Node: tests/)
  assert.match(agentCalls['fix-2'].prompt, /Python: tests/)
  assert.deepEqual(rerunLabels(launchedAgents), [])
})

for (const [what, step] of [['a test step', 'Run the node tests'], ['an unreadable step', null], ['a step whose name only contains a setup step name', 'Set up job and run tests']]) {
  test(`ci-setup-failure: a job that failed in ${what} is reported at once without a second agent call`, async () => {
    const { agentCalls, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', step)]))
    assert.match(agentCalls['fix-2'].prompt, /Node: tests fails/)
    assert.deepEqual(rerunLabels(launchedAgents), [])
  })
}

test('ci-setup-failure: a setup failure next to a test failure is reported at once without a re-run', async () => {
  const { launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Set up job'), redJob('Python: tests', 'Run the python tests', ['11', '23'])]))
  assert.deepEqual(rerunLabels(launchedAgents), [])
})

test('ci-setup-failure: a setup failure is re-run once with --job and a changed link takes the second finding', async () => {
  const second = { ...redOnHead('Node: tests'), text: 'Node: tests fails again after the re-run' }
  const rerun = { link: 'https://github.com/o/n/actions/runs/11/job/99', bucket: 'fail', findings: [second] }
  const { agentCalls, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Set up job')]), lane, undefined, { 'ci-0-rerun-1': rerun })
  assert.deepEqual(rerunLabels(launchedAgents), ['ci-0-rerun-1'])
  assert.match(agentCalls['ci-0-rerun-1'].prompt, /gh run rerun 11 --job 22/)
  assert.match(agentCalls['fix-2'].prompt, /fails again after the re-run/)
  assert.doesNotMatch(agentCalls['fix-2'].prompt, /Node: tests fails\b(?! again)/)
})

test('ci-setup-failure: a setup failure whose re-run link is unchanged keeps the first finding', async () => {
  const job = redJob('Node: tests', 'Set up job')
  const rerun = { link: job.link, bucket: 'pass', findings: [] }
  const { agentCalls } = await driveCi(redWatch([job]), lane, undefined, { 'ci-0-rerun-1': rerun })
  assert.match(agentCalls['fix-2'].prompt, /Node: tests fails/)
})

test('ci-setup-failure: a setup failure whose re-run passes under a changed link reaches ready-to-land', async () => {
  const job = redJob('Node: tests', 'Set up job')
  const rerun = { link: 'https://github.com/o/n/actions/runs/11/job/99', bucket: 'pass', findings: [] }
  const { result } = await driveCi(redWatch([job], [check('Node: tests', 'pass')]), lane, undefined, { 'ci-0-rerun-1': rerun })
  assert.equal(result.status, 'ready-to-land', result.reason)
})

test('ci-setup-failure: a re-run agent that ends without a result keeps the first finding', async () => {
  const { agentCalls } = await driveCi(redWatch([redJob('Node: tests', 'Set up job')]))
  assert.match(agentCalls['fix-2'].prompt, /Node: tests fails/)
})

const flakeFix = (...wheres) => ({ head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], blocked: false, disputed: wheres.map(where => ({ where, text: `${where} fails`, counterEvidence: 'the same job passes on main; the failing test is not in the diff' })) })
const reranPass = { link: 'https://github.com/o/n/actions/runs/11/job/99', bucket: 'pass', findings: [] }

test('ci-flake-rerun: every CI finding disputed with nothing committed re-runs the job, goes on when it passes and keeps the flake in the follow-ups', async () => {
  const { result, agentCalls, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Run the node tests')]), lane, undefined, { 'fix-2': flakeFix('Node: tests'), 'ci-1-rerun-1': reranPass, 'ci-read-1': { checks: [check(required, 'pass'), check('Node: tests', 'pass')] } })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.match(agentCalls['ci-1-rerun-1'].prompt, /gh run rerun 11 --job 22/)
  assert.ok(!launchedAgents.includes('ci-1'))
  assert.deepEqual(result.disputed, [])
  assert.match(result.followups.map(f => f.text).join('\n'), /Node: tests fails[\s\S]*the same job passes on main/)
})

test('ci-flake-rerun: a red after the re-run goes to the head', async () => {
  const rerunRed = { link: 'https://github.com/o/n/actions/runs/11/job/99', bucket: 'fail', findings: [redOnHead('Node: tests')] }
  const { result, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Run the node tests')]), lane, undefined, { 'fix-2': flakeFix('Node: tests'), 'ci-1-rerun-1': rerunRed })
  assert.equal(result.status, 'awaiting-head', result.reason)
  assert.equal(result.stage, 'fix')
  assert.equal(result.disputed.length, 1)
  assert.deepEqual(launchedAgents.filter(label => label.startsWith('ci-1-rerun')), ['ci-1-rerun-1'])
})

test('ci-flake-rerun: a disputed own flake next to a shared red re-runs only the own job and, once it passes, ends at ci with the shared reason', async () => {
  const sharedJob = redJob('quality / hygiene', 'Run hygiene', ['11', '23'])
  const ownJob = redJob('Node: tests', 'Run the node tests')
  const baseChecks = [run('quality / hygiene', 'failure'), run('Node: tests', 'success')]
  const stillShared = { checks: [check(required, 'pass'), check('quality / hygiene', 'fail'), check('Node: tests', 'pass')], base_runs: baseChecks }
  const { result, agentCalls } = await driveCi(ciAnswer([check(required, 'pass'), check('quality / hygiene', 'fail'), check('Node: tests', 'fail')], { green: false, failing: [...sharedJob.findings, ...ownJob.findings], red: [sharedJob, ownJob], baseChecks }), lane, undefined, { 'fix-2': flakeFix('Node: tests'), 'ci-1-rerun-1': reranPass, 'ci-read-1': stillShared })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /quality \/ hygiene/)
  assert.match(agentCalls['ci-1-rerun-1'].prompt, /gh run rerun 11 --job 22/)
  assert.doesNotMatch(agentCalls['ci-1-rerun-1'].prompt, /--job 23/)
})

test('ci-flake-rerun: a dispute of only some CI findings goes to the head without a re-run', async () => {
  const { result, launchedAgents } = await driveCi(redWatch([redJob('Node: tests', 'Run the node tests'), redJob('Python: tests', 'Run the python tests', ['11', '23'])]), lane, undefined, { 'fix-2': flakeFix('Node: tests') })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'fix'])
  assert.deepEqual(launchedAgents.filter(label => label.includes('rerun')), [])
})

test('ci-flake-rerun: a disputed non-CI finding goes to the head without a re-run', async () => {
  const dispute = flakeFix('x.py:1')
  const { result, launchedAgents } = await runLane({ ...lane, fixFirst: [{ ...defectWithoutDraft, where: 'x.py:1' }] }, { 'fix-1': dispute })
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'fix'])
  assert.deepEqual(launchedAgents.filter(label => label.includes('rerun')), [])
})

// The fixer starts at once when CI is red; the tester is awaited only when CI has nothing of its own to fix.
const roundTip = (round) => String(round).repeat(40)
const roundRed = (round, extra = () => {}) => () => { extra(); return { head: roundTip(round), green: false, failing: [{ ...defectWithoutDraft, where: `t.py:${round}` }] } }
const roundFix = (round) => ({ ...mergeOnlyFix, head: roundTip(round), parents: [round === 1 ? resumeArgs.tip : roundTip(round - 1), mainMovedTip] })
const heldTester = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve, answer: () => promise } }
const testerLabels = (launchedAgents) => launchedAgents.filter(label => /^e2e-\d+$/.test(label))
const ciWatches = (launchedAgents) => launchedAgents.filter(label => /^ci-\d+$/.test(label))
const tolerates = { timeout: 5000 }

test('ci-fixer-at-once: CI red for several rounds starts a fixer each round and issues exactly one tester call', tolerates, async () => {
  const tester = heldTester()
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer,
    'ci-0': roundRed(0), 'ci-1': roundRed(1), 'ci-2': roundRed(2), 'ci-3': roundRed(3, () => tester.resolve(PASS)), 'ci-4': greenCi(roundTip(4)),
    'fix-1': roundFix(1), 'fix-2': roundFix(2), 'fix-3': roundFix(3), 'fix-4': roundFix(4),
  }
  const { result, launchedAgents } = await runLane({ ...resumeArgs, budgets: { ci: 5 } }, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0'])
  assert.deepEqual(launchedAgents.filter(label => /^fix-\d+$/.test(label)), ['fix-1', 'fix-2', 'fix-3', 'fix-4'])
})

test('ci-fixer-at-once: a tester answering with blocking findings after two CI-only fix rounds puts them into the next fix batch', tolerates, async () => {
  const tester = heldTester()
  const late = { where: 'flow.py:9', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer, 'e2e-1': PASS,
    'ci-0': roundRed(0), 'ci-1': roundRed(1), 'ci-2': roundRed(2, () => tester.resolve({ verdict: 'FAIL', blocking: [late], followups: [] })), 'ci-3': greenCi(roundTip(3)),
    'fix-1': roundFix(1), 'fix-2': roundFix(2), 'fix-3': { ...resumeFix, head: roundTip(3), parents: [roundTip(2)], files: ['flow.py'], regression: [{ finding: 1, test: 't.py::t', failedBefore: true, passesAfter: true }] },
    'r1-review': APPROVE, 'r2-review': APPROVE, 'r3-review': APPROVE, 'ci-4': greenCi(roundTip(3)),
  }
  const { agentCalls, launchedAgents, result } = await runLane(resumeArgs, answers)
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /flow\.py:9/)
  assert.doesNotMatch(agentCalls['fix-2'].prompt, /flow\.py:9/)
  assert.match(agentCalls['fix-3'].prompt, /flow\.py:9/)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0', 'e2e-1'])
})

const lateFinding = { where: 'flow.py:9', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
const lateFix = { ...resumeFix, head: roundTip(3), parents: [roundTip(2)], files: ['flow.py'], regression: [{ finding: 1, test: 't.py::t', failedBefore: true, passesAfter: true }] }

test('ci-budget-key: a fix round with red CI that carries a tester finding charges the ci budget', tolerates, async () => {
  const tester = heldTester()
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer, 'e2e-1': PASS,
    'ci-0': roundRed(0), 'ci-1': roundRed(1), 'ci-2': roundRed(2, () => tester.resolve({ verdict: 'FAIL', blocking: [lateFinding], followups: [] })), 'ci-3': greenCi(roundTip(3)),
    'fix-1': roundFix(1), 'fix-2': roundFix(2), 'fix-3': lateFix,
    'r1-review': APPROVE, 'r2-review': APPROVE, 'r3-review': APPROVE, 'ci-4': greenCi(roundTip(3)),
  }
  const { result } = await runLane({ ...resumeArgs, budgets: { ci: 5 } }, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(result.spent.ci, 3)
  assert.equal(result.spent.test, 0)
})

test('ci-budget-key: a fix round with green CI that carries only a tester finding charges the test budget', tolerates, async () => {
  const answers = {
    'r0-review': APPROVE, 'e2e-0': { verdict: 'FAIL', blocking: [lateFinding], followups: [] }, 'e2e-1': PASS,
    'ci-0': greenCi(resumeArgs.tip), 'fix-1': { ...lateFix, parents: [resumeArgs.tip] }, 'r1-review': APPROVE, 'ci-1': greenCi(roundTip(3)),
  }
  const { result } = await runLane(resumeArgs, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(result.spent.test, 1)
  assert.equal(result.spent.ci, 0)
})

test('ci-budget-key: a fix round with red CI but no failing entry and no tester finding charges the ci budget', tolerates, async () => {
  const answers = {
    'r0-review': APPROVE, 'e2e-0': PASS,
    'ci-0': { head: resumeArgs.tip, green: false, failing: [] }, 'fix-1': roundFix(1), 'r1-review': APPROVE, 'ci-1': greenCi(roundTip(1)),
  }
  const { result } = await runLane(resumeArgs, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.equal(result.spent.ci, 1)
  assert.equal(result.spent.test, 0)
})

test('ci-fixer-at-once: CI green with a tester PASS holding a cell ends ready-to-land after one tester and one CI watch', tolerates, async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeArgs.tip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual([testerLabels(launchedAgents), ciWatches(launchedAgents)], [['e2e-0'], ['ci-0']])
})

test('ci-fixer-at-once: a lock-busy tester is retried inline without another CI watch', tolerates, async () => {
  const { result, launchedAgents } = await runLane(resumeArgs, { 'r0-review': APPROVE, 'e2e-0': lockBusy, 'e2e-1': PASS, 'ci-0': greenCi(resumeArgs.tip), 'ci-1': greenCi(resumeArgs.tip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0', 'e2e-1'])
  assert.deepEqual(ciWatches(launchedAgents), ['ci-0'])
})

test('ci-fixer-at-once: a tester PASS on a tip a later fix changed in production starts a new tester before ready-to-land', tolerates, async () => {
  const tester = heldTester()
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer, 'e2e-1': PASS,
    'ci-0': roundRed(0), 'ci-1': roundRed(1, () => tester.resolve(PASS)), 'ci-2': greenCi(roundTip(2)),
    'fix-1': { ...resumeFix, head: roundTip(1), files: ['src/x.py'], regression: [] }, 'r1-review': APPROVE, 'fix-2': roundFix(2),
  }
  const { result, launchedAgents } = await runLane(resumeArgs, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0', 'e2e-1'])
  assert.equal(result.tip, roundTip(2))
})

test('ci-fixer-at-once: a lock-busy tester does not hold a red CI back from the fixer', tolerates, async () => {
  const retry = heldTester()
  const answers = {
    'r0-review': APPROVE, 'e2e-0': lockBusy, 'e2e-1': retry.answer,
    'ci-0': roundRed(0), 'ci-1': () => { retry.resolve(PASS); return greenCi(roundTip(1)) }, 'ci-read-1': { pr_head: roundTip(1), checks: greenCi(roundTip(1)).checks, required: ['quality / verdict'] }, 'fix-1': roundFix(1),
  }
  const { result, launchedAgents } = await runLane(resumeArgs, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.ok(launchedAgents.includes('fix-1'))
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0', 'e2e-1'])
})

test('ci-fixer-at-once: a retry that is lock-busy again while CI is red again goes to the head with the red check named', tolerates, async () => {
  const answers = { 'r0-review': APPROVE, 'e2e-0': lockBusy, 'e2e-1': lockBusy, 'ci-0': roundRed(0), 'ci-1': roundRed(1), 'fix-1': roundFix(1) }
  const { result, launchedAgents } = await runLane(resumeArgs, answers)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'test'])
  assert.match(result.reason, /red[\s\S]*t\.py:1/)
  assert.ok(launchedAgents.includes('fix-1'))
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-fixer-at-once: a follow-up of a tester that settles after a fix moved the tip is raised before the returned tip', tolerates, async () => {
  const tester = heldTester()
  const followup = { where: 'late.py:1', text: 'tidy it', kind: 'follow-up' }
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer,
    'ci-0': roundRed(0), 'ci-1': () => { tester.resolve({ ...PASS, followups: [followup] }); return greenCi(roundTip(1)) },
    'ci-read-1': { pr_head: roundTip(1), checks: greenCi(roundTip(1)).checks, required: ['quality / verdict'] }, 'fix-1': roundFix(1),
  }
  const { result } = await runLane(resumeArgs, answers)
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.raisedBeforeTip.map(f => f.where), ['late.py:1'])
})

test('ci-operator-door: a tester PASS on an older production tip does not open the door before a tester ran on the current tip', tolerates, async (t) => {
  const { bin } = fakeGhWithLog(t, { logLines: loosened })
  const tester = heldTester()
  const doorCi = (round) => ({ head: roundTip(round), green: false, failing: verdictFailing, checks: redVerdict })
  const answers = {
    'r0-review': APPROVE, 'e2e-0': tester.answer, 'e2e-1': PASS,
    'ci-0': roundRed(0), 'ci-1': () => { tester.resolve(PASS); return doorCi(1) }, 'ci-2': doorCi(1),
    'ci-read-1': printingWith(bin, redVerdict, roundTip(1)), 'ci-read-2': printingWith(bin, redVerdict, roundTip(1)),
    'fix-1': { ...resumeFix, head: roundTip(1), files: ['src/x.py'], regression: [] }, 'r1-review': APPROVE,
  }
  const { result, launchedAgents } = await runLane(resumeArgs, answers)
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, door)
  assert.deepEqual(testerLabels(launchedAgents), ['e2e-0', 'e2e-1'])
})
