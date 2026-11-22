// A failing finding that sits in a file the lane changed reaches the fixer; one that sits in a file it did not change stays shared with a base that is red too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, redJob, lane, required, check, ciAnswer, driveCi } from './lane_workflow_harness.mjs'


const sonarFinding = { where: 'src/a.py:4', kind: 'defect', text: 'duplicated lines', rule: 'python:S1192', evidence: 'sonar src/a.py:4' }
const sonarRed = (changedFiles, failing = [sonarFinding]) => {
  const sonarJob = { ...redJob('quality / sonar', 'Run sonar'), findings: [sonarFinding] }
  return ciAnswer([check(required, 'pass'), check('quality / sonar', 'fail')], { green: false, failing, red: [sonarJob], baseChecks: [run('quality / sonar', 'failure')], changedFiles })
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

const watcherCopy = { ...sonarFinding, text: 'duplicated string literal', evidence: 'the watcher quoted another line' }

test('ci-shared-red: a failing finding with the red job finding where and rule but another text stays shared and launches no fixer', async () => {
  const { result, launchedAgents } = await driveCi(sonarRed(['src/other.py'], [watcherCopy]))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
  assert.match(result.reason, /quality \/ sonar/)
  assert.ok(!launchedAgents.includes('fix-2'))
})

test('ci-own-finding: a differing copy of a shared finding in a changed file reaches the fixer', async () => {
  const { result, launchedAgents } = await driveCi(sonarRed(['src/a.py'], [watcherCopy]))
  assert.notEqual(result.status, 'awaiting-head')
  assert.ok(launchedAgents.includes('fix-2'))
})

test('ci-path-digest: a printer run that received the finding paths the lane sent is trusted without a reread', async () => {
  const { launchedAgents } = await driveCi(sonarRed(['src/a.py']))
  assert.ok(!launchedAgents.includes('ci-read-0-reread'))
})

test('ci-path-digest: a printer run whose command lost a finding path is reread, and the reread keeps the own finding for the fixer', async () => {
  const { launchedAgents, agentCalls } = await driveCi(sonarRed(['src/a.py']), lane, { typedCommand: (line) => line.replace("'src/a.py'", "''") })
  assert.ok(launchedAgents.includes('ci-read-0-reread'))
  assert.match(agentCalls['fix-2'].prompt, /src\/a\.py:4/)
})

const manyFiles = (count) => Array.from({ length: count }, (_, index) => `src/file${index + 1}.py`)
const findingIn = (where) => ({ ...sonarFinding, where, evidence: `sonar ${where}` })
const sonarRedIn = (where, changedFiles) => {
  const finding = findingIn(where)
  return ciAnswer([check(required, 'pass'), check('quality / sonar', 'fail')], { green: false, failing: [finding], red: [{ ...redJob('quality / sonar', 'Run sonar'), findings: [finding] }], baseChecks: [run('quality / sonar', 'failure')], changedFiles })
}

test('ci-own-finding: a finding in the 130th of 150 changed files counts as own although its check is red on the base', async () => {
  const files = manyFiles(150)
  const { result, agentCalls } = await driveCi(sonarRedIn(files[129], files))
  assert.notEqual(result.status, 'awaiting-head')
  assert.match(agentCalls['fix-2'].prompt, /src\/file130\.py/)
})

test('ci-own-finding: a finding in a file after the first hundred that the lane did not change stays shared', async () => {
  const { result } = await driveCi(sonarRedIn('src/other.py', manyFiles(150)))
  assert.deepEqual([result.status, result.stage], ['awaiting-head', 'ci'])
})

test('ci-own-finding: the relayed line does not grow with the number of changed files', async () => {
  const lineLengths = []
  const measured = { edit: (printed) => { lineLengths.push(printed.length); return printed } }
  for (const count of [3, 150]) {
    const files = manyFiles(count)
    await driveCi(sonarRedIn(files[2], files), lane, measured)
  }
  assert.equal(lineLengths[1], lineLengths[0])
})
