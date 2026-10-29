// The lane workflow reports CI green only from the copied check listing of the tip, never from the CI agent's word.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane } from './lane_workflow_harness.mjs'

const tip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'
const lane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip }
const tidy = { where: 'x.py:1', text: 'tidy the import order', kind: 'follow-up (fix in place)' }
const alreadySatisfied = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
const reachesCi = { 'fix-1': alreadySatisfied, 'r1-review': { verdict: 'APPROVE', blocking: [], followups: [] }, 'e2e-0': { verdict: 'PASS', blocking: [], followups: [], cells: [{ cell: 'c', result: 'held', command: 'run', exit: '0' }] } }
const required = 'quality / verdict'
const check = (name, bucket) => ({ name, bucket })
const ciAnswer = (checks, extra = {}) => ({ head: tip, green: true, failing: [], checks, requiredChecks: [required], ...extra })
const driveCi = (ci, args = lane) => runLane({ ...args, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ci })

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
  test(`#266 AC-ci-listing-proof: ${what} fails the lane at ci although the agent says green`, async () => {
    const { result, launchedAgents } = await driveCi(ciAnswer(checks))
    assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
    assert.match(result.reason, reason)
    assert.equal(result.history.at(-1).by, 'ci-0')
    assert.equal(result.history.at(-1).verdict, 'RED')
    assert.ok(!launchedAgents.includes('fix-2'))
  })
}

test('#266 AC-ci-listing-proof: a required check error fails the lane at ci naming the error and launches no fixer', async () => {
  const { result, launchedAgents } = await driveCi(ciAnswer([check(required, 'pass')], { requiredChecksError: 'HTTP 403: forbidden' }))
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /HTTP 403: forbidden/)
  assert.equal(result.history.at(-1).by, 'ci-0')
  assert.equal(result.history.at(-1).verdict, 'RED')
  assert.ok(!launchedAgents.includes('fix-2'))
})

const proven = [
  ['a clean listing', [check(required, 'pass'), check('a', 'pass')]],
  ['a skipping check', [check(required, 'pass'), check('a', 'skipping')]],
]
for (const [what, checks] of proven) {
  test(`#266 AC-ci-listing-proof: ${what} reaches ready-to-land`, async () => {
    const { result } = await driveCi(ciAnswer(checks))
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(result.history.at(-1).verdict, 'GREEN')
  })
}

test('#266 AC-ci-listing-proof: a conflicting pull request answered with empty arrays and green false still goes to a fixer', async () => {
  const failing = [{ where: 'mergeable', kind: 'defect', text: 'conflicts', rule: 'GitHub runs no CI on a conflicting pull request', evidence: 'CONFLICTING' }]
  const { launchedAgents } = await driveCi({ head: tip, green: false, failing, checks: [], requiredChecks: [], baseChecks: [] })
  assert.ok(launchedAgents.includes('fix-2'))
})

test('#266 AC-ci-listing-proof: green false with a failing finding still goes to a fixer', async () => {
  const failing = [{ where: 'Python: tests', kind: 'defect', text: 'fails', rule: 'CI check Python: tests', evidence: 'boom' }]
  const { launchedAgents } = await driveCi(ciAnswer([check('Python: tests', 'fail')], { green: false, failing }))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('#266 AC-ci-listing-proof: green false with all checks passing does not become ready-to-land', async () => {
  const { result } = await driveCi(ciAnswer([check(required, 'pass')], { green: false }))
  assert.notEqual(result.status, 'ready-to-land')
  assert.equal(result.history.at(-1).verdict, 'RED')
})

test('#266 AC-ci-listing-proof: with repo set the CI brief names the repository and the worktree cd is gone', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]), { ...lane, repo: 'o/n' })
  const brief = agentCalls['ci-0'].prompt
  assert.match(brief, /repos\/o\/n\/rules\/branches/)
  assert.match(brief, / -R o\/n/)
  assert.doesNotMatch(brief, /cd '\/w'/)
})

test('#266 AC-ci-listing-proof: without repo the CI brief runs the listing and rules commands in the worktree', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.match(agentCalls['ci-0'].prompt, /cd '\/w' && gh api repos\/\{owner\}\/\{repo\}\/rules\/branches/)
})

test('#266 AC-ci-listing-proof: the CI brief carries the API-error rule, the conflicting-PR empty arrays and the re-watch rule', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  const brief = agentCalls['ci-0'].prompt
  assert.match(brief, /requiredChecksError/)
  assert.match(brief, /never `\[\]`/)
  assert.match(brief, /checks: \[\] and requiredChecks: \[\] and baseChecks: \[\]/)
  assert.match(brief, /watch again before you copy the listing/)
  assert.match(brief, /--json name,bucket/)
})

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_CI_PROTOCOL = (\d+)$/m)?.[1])
const drivePassingCi = (options) => runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ciAnswer([check(required, 'pass')]) }, { ...options, child: 'atelier:lane-ci' })

test('#311 lane-ci-protocol: a child with another protocol number fails the lane at ci naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result, launchedAgents } = await drivePassingCi({ transformChild: (source) => source.replace(/^const LANE_CI_PROTOCOL = \d+$/m, `const LANE_CI_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
  assert.ok(!launchedAgents.includes('ci-0'))
})

test('#311 lane-ci-protocol: a call without the pull request number fails the lane at ci naming the missing args', async () => {
  const { result } = await drivePassingCi({ alterChildArgs: ({ pr: _pr, worktree: _worktree, ...rest }) => rest })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /missing args: .*pr.*worktree/)
})

test('#311 lane-ci-protocol: a child that throws fails the lane at ci naming the error', async () => {
  const { result } = await drivePassingCi({ transformChild: () => "throw new Error('the child exploded')" })
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /the child exploded/)
})

test('#311 lane-ci-protocol: lane.js and lane-ci.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-ci')), protocolOf(readWorkflow('lane')))
})

test('#311 lane-ci-protocol: the ci agent is launched by the lane-ci child, not by lane.js', async () => {
  const { launchedByChild, launchedAgents } = await drivePassingCi({})
  assert.deepEqual(launchedByChild['atelier:lane-ci'], ['ci-0'])
  assert.ok(launchedAgents.includes('ci-0'))
})

const redOnHead = (name) => ({ where: name, kind: 'defect', text: `${name} fails`, rule: `CI check ${name}`, evidence: 'boom' })
const run = (name, conclusion) => ({ name, status: conclusion ? 'completed' : 'in_progress', conclusion })
const redCi = (names, baseChecks) => ciAnswer([check(required, 'pass'), ...names.map(name => check(name, 'fail'))], { green: false, failing: names.map(redOnHead), ...(baseChecks ? { baseChecks } : {}) })

test('#286 ci-shared-red: a check red on head and on the base launches no fixer and goes to the head naming it', async () => {
  const { result, launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'failure')]))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /quality \/ hygiene/)
  assert.match(result.reason, /fixFirst/)
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('#286 ci-shared-red: a check red on head but green on the base still gets its fixer', async () => {
  const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'success')]))
  assert.ok(launchedAgents.includes('fix-2'))
})

test('#286 ci-shared-red: a shared red together with a red of the lane own goes to the head, naming the shared one', async () => {
  const { result, launchedAgents } = await driveCi(redCi(['quality / hygiene', 'Python: tests'], [run('quality / hygiene', 'failure'), run('Python: tests', 'success')]))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /quality \/ hygiene/)
  assert.ok(!launchedAgents.includes('fix-2'))
})

for (const [what, baseChecks] of [['an empty baseChecks', []], ['no baseChecks', undefined], ['a base run of the same name still pending', [run('quality / hygiene', null)]], ['a name missing on the base', [run('other', 'failure')]]]) {
  test(`#286 ci-shared-red: ${what} runs CI fixing as before`, async () => {
    const { launchedAgents } = await driveCi(redCi(['quality / hygiene'], baseChecks))
    assert.ok(launchedAgents.includes('fix-2'))
  })
}

test('#286 ci-shared-red: a rerun on the base with one failure counts as shared', async () => {
  const { result, launchedAgents } = await driveCi(redCi(['quality / hygiene'], [run('quality / hygiene', 'success'), run('quality / hygiene', 'failure')]))
  assert.equal(result.status, 'awaiting-head')
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('#286 ci-shared-red: a shared red with a blocking end-to-end finding gives the fixer only the end-to-end finding', async () => {
  const e2eFinding = { where: 'flow.py:3', kind: 'defect', text: 'the flow loses data', rule: 'no data loss', evidence: 'repro' }
  const answers = { ...reachesCi, 'e2e-0': { verdict: 'FAIL', blocking: [e2eFinding], followups: [] }, 'ci-0': redCi(['quality / hygiene'], [run('quality / hygiene', 'failure')]) }
  const { agentCalls } = await runLane({ ...lane, foldIn: [tidy] }, answers)
  const brief = agentCalls['fix-2'].prompt
  assert.match(brief, /flow\.py:3/)
  assert.doesNotMatch(brief, /quality \/ hygiene/)
})

test('#286 ci-shared-red: the CI brief asks the watcher for the base check runs before the conflicting-path sentence', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  const brief = agentCalls['ci-0'].prompt
  assert.ok(brief.indexOf('baseChecks') > 0 && brief.indexOf('baseChecks') < brief.indexOf('On the conflicting pull request path'))
  assert.match(brief, /check-runs --paginate/)
})

test('#311 lane-ci-protocol: an answer without a head sha fails the lane at ci naming what came back', async () => {
  const { result } = await driveCi({})
  assert.deepEqual([result.status, result.stage], ['failed', 'ci'])
  assert.match(result.reason, /without a head sha: \{/)
})

test('#311 lane-ci-protocol: the refusal shows each protocol value with its type', async () => {
  const { result } = await drivePassingCi({ alterChildArgs: (args) => ({ ...args, protocol: '1' }) })
  assert.match(result.reason, /"1"/)
})

const registrationLoopOf = (brief) => brief.match(/for i in \$\(seq 1 20\); do .*?; done/)[0]

for (const [what, args, prefix] of [['without repo', lane, "cd '/w' && "], ['with repo', { ...lane, repo: 'o/n' }, '']]) {
  test(`#329 ci-registration-wait: ${what} the registration wait stands after the conflicting-PR sentence and before the watch`, async () => {
    const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]), args)
    const brief = agentCalls['ci-0'].prompt
    const countCommand = `${prefix}for i in $(seq 1 20); do [ "$(gh pr checks 1${args.repo ? ' -R o/n' : ''} --json name --jq length 2>/dev/null)" -gt 0 ]`
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

test('#329 ci-registration-wait: the loop ends at the first positive check count', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.deepEqual(runRegistrationLoop(false, registrationLoopOf(agentCalls['ci-0'].prompt)), { status: 0, tries: 3 })
})

test('#329 ci-registration-wait: the loop stops after 20 tries with status 0 when no check ever registers', async () => {
  const { agentCalls } = await driveCi(ciAnswer([check(required, 'pass')]))
  assert.deepEqual(runRegistrationLoop(true, registrationLoopOf(agentCalls['ci-0'].prompt)), { status: 0, tries: 20 })
})

const lockBusy = { verdict: 'failed', lockBusy: true, blocking: [], followups: [] }
const lockQueue = [
  ['green', ciAnswer([check(required, 'pass')]), /green/],
  ['red', redCi(['Python: tests']), /red[\s\S]*Python: tests/],
  ['unreadable', { failure: 'lane-ci failed: boom' }, /not readable/],
]
for (const [what, ci, state] of lockQueue) {
  test(`#357 lock-queue: two busy probe locks with CI ${what} go to the head at test and launch no fixer`, async () => {
    const { result, launchedAgents } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': lockBusy, 'e2e-1': lockBusy, 'ci-0': ci, 'ci-1': ci })
    assert.deepEqual([result.status, result.stage], ['awaiting-head', 'test'])
    assert.match(result.reason, /^lock queue:/)
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
  test(`#369 a tester PASS with ${what} fails the lane at test`, async () => {
    const { result } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': testerAnswer(cells), 'ci-0': ciAnswer([check(required, 'pass')]) })
    assert.deepEqual([result.status, result.stage], ['failed', 'test'])
    assert.match(result.reason, /a PASS without driven cells/)
  })
}

test('#369 the cells of a tester PASS reach the result history, held, failed and not driven alike', async () => {
  const cells = [cell('held'), cell('failed'), cell('not driven')]
  const { result } = await runLane({ ...lane, foldIn: [tidy] }, { ...reachesCi, 'e2e-0': testerAnswer(cells), 'ci-0': ciAnswer([check(required, 'pass')]) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  assert.deepEqual(result.history.find(entry => entry.by === 'e2e-0').cells, cells)
})
