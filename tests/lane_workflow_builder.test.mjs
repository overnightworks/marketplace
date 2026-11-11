// The builder runs as the lane-build child under a protocol number; a refusal or a crash fails the lane at build naming it.
import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, built, cleanCheck, resumeTip, resumeFix, resumeFixedTip, secondFix, unchangedFix, APPROVE, PASS, greenCi } from './lane_workflow_harness.mjs'

const readWorkflow = (name) => fs.readFileSync(new URL(`../plugins/atelier/workflows/${name}.js`, import.meta.url), 'utf8')
const protocolOf = (source) => Number(source.match(/^const LANE_BUILD_PROTOCOL = (\d+)$/m)?.[1])
const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
const driveBuilder = (options) => runLane(builtLane, { build: built }, { ...options, child: 'atelier:lane-build' })

test('lane-build-protocol: a child with another protocol number fails the lane at build naming both numbers', async () => {
  const parentNumber = protocolOf(readWorkflow('lane'))
  const { result } = await driveBuilder({ transformChild: (source) => source.replace(/^const LANE_BUILD_PROTOCOL = \d+$/m, `const LANE_BUILD_PROTOCOL = ${parentNumber + 1}`) })
  assert.deepEqual([result.status, result.stage], ['failed', 'build'])
  assert.match(result.reason, new RegExp(`${parentNumber}[\\s\\S]*${parentNumber + 1}|${parentNumber + 1}[\\s\\S]*${parentNumber}`))
})

test('lane-build-protocol: lane.js and lane-build.js hold the same protocol number', () => {
  assert.ok(Number.isInteger(protocolOf(readWorkflow('lane'))))
  assert.equal(protocolOf(readWorkflow('lane-build')), protocolOf(readWorkflow('lane')))
})

const findingsCheck = (...findings) => ({ command: 'quality check', exit: 1, findings })
const notRun = { area: 'dependencies', message: 'advisory archive download timed out' }
const couldNotRunCheck = (couldNotRun, ...findings) => ({ command: 'quality check', exit: 2, findings, couldNotRun })
const builderReports = [
  ['a clean report', cleanCheck, []],
  ['the statement that the repository has no quality gate', { noQualityGate: 'the repository has no quality/config.toml' }, []],
  ['findings', findingsCheck('tests/big_test.py: 829 lines, past the 800 ceiling'), ['tests/big_test.py: 829 lines']],
  ['an exit status past 0 without a named finding', { command: 'quality check', exit: 2, findings: [] }, ['the check exited 2 and named no findings']],
  ['no report', undefined, ['the check was not reported']],
  ['a report without its findings list', { command: 'quality check', exit: 0 }, ['the check was not reported']],
  ['the statement that an area could not run and no finding from the others', couldNotRunCheck(notRun), []],
  ['the statement that an area could not run beside a finding from the others', couldNotRunCheck(notRun, 'tests/big_test.py: 829 lines'), ['tests/big_test.py: 829 lines']],
  ['a could-not-run statement without its area', couldNotRunCheck({ message: notRun.message }), ['the check was not reported']],
  ['a could-not-run statement without its message', couldNotRunCheck({ area: notRun.area }), ['the check was not reported']],
  ['a could-not-run statement with a blank area', couldNotRunCheck({ area: ' ', message: notRun.message }), ['the check was not reported']],
  ['a could-not-run statement beside the statement that there is no quality gate', { noQualityGate: 'no quality/config.toml', couldNotRun: notRun }, ['the check was not reported']],
]

for (const [what, check, expectedFindings] of builderReports) {
  test(`a builder tip with ${what} ${expectedFindings.length ? 'goes to a fixer before any review or CI' : 'goes on to review'}`, async () => {
    const afterFix = { 'fix-1': resumeFix, 'r1-review': APPROVE, 'ci-0': greenCi(resumeFixedTip) }
    const withoutFix = { 'r0-review': APPROVE, 'ci-0': greenCi(resumeTip) }
    const { result, launchedAgents, agentCalls } = await runLane(builtLane, { build: { ...built, check }, 'e2e-0': PASS, ...(expectedFindings.length ? afterFix : withoutFix) })
    assert.equal(result.status, 'ready-to-land')
    assert.equal(launchedAgents.includes('fix-1'), expectedFindings.length > 0)
    if (expectedFindings.length) assert.ok(launchedAgents.indexOf('fix-1') < launchedAgents.indexOf('r1-review'), launchedAgents.join())
    expectedFindings.forEach(text => assert.ok(agentCalls['fix-1'].prompt.includes(text), text))
  })
}

const notRunNamed = (entry) => entry.checkCouldNotRun && { by: entry.by, ...entry.checkCouldNotRun }

test('a builder tip whose check could not run an area goes to review with no fixer, no charge, and the result names the area and the message', async () => {
  const answers = { build: { ...built, check: couldNotRunCheck(notRun) }, 'r0-review': APPROVE, 'ci-0': greenCi(resumeTip), 'e2e-0': PASS }
  const { result, launchedAgents } = await runLane(builtLane, answers)
  assert.equal(result.status, 'ready-to-land')
  assert.ok(!launchedAgents.some(label => label.startsWith('fix-')), launchedAgents.join())
  assert.deepEqual(result.spent, { review: 0, test: 0, ci: 0, total: 0 })
  assert.deepEqual(result.history.map(notRunNamed).filter(Boolean), [{ by: 'build', ...notRun }])
  assert.ok(result.requiredHeadActions.some(action => action.includes(notRun.area) && action.includes(notRun.message)), result.requiredHeadActions.join('\n'))
})

test('a fixer whose check could not run an area starts no further fixer and the result names the area and the message', async () => {
  const answers = { build: { ...built, check: findingsCheck('tests/big_test.py: 829 lines') }, 'fix-1': { ...resumeFix, check: couldNotRunCheck(notRun) }, 'r1-review': APPROVE, 'ci-0': greenCi(resumeFixedTip), 'e2e-0': PASS }
  const { result, launchedAgents } = await runLane(builtLane, answers)
  assert.equal(result.status, 'ready-to-land')
  assert.ok(!launchedAgents.includes('fix-2'), launchedAgents.join())
  assert.equal(result.spent.total, 1)
  assert.deepEqual(result.history.map(notRunNamed).filter(Boolean), [{ by: 'fix-1', ...notRun }])
})

test('a fixer whose check could not run an area but found a finding in the others is followed by another fixer', async () => {
  const answers = { build: { ...built, check: findingsCheck('first') }, 'fix-1': { ...resumeFix, check: couldNotRunCheck(notRun, 'second') }, 'fix-2': { ...secondFix, check: cleanCheck }, 'r2-review': APPROVE, 'ci-0': greenCi(secondFix.head), 'e2e-0': PASS }
  const { result, agentCalls } = await runLane(builtLane, answers)
  assert.equal(result.status, 'ready-to-land')
  assert.ok(agentCalls['fix-2'].prompt.includes('second'))
})

test('the facts of the builder and the fixer say when the check could not run and what to report then', async () => {
  const { agentCalls } = await runLane(builtLane, { build: { ...built, check: findingsCheck('x') }, 'fix-1': resumeFix })
  for (const label of ['build', 'fix-1']) assert.match(agentCalls[label].prompt, /failed to run[^.]*never for a finding[^.]*run the areas that can run[^.]*couldNotRun/s)
  const reportProperties = agentCalls.build.options.schema.properties.check.properties
  assert.deepEqual(reportProperties.couldNotRun.required, ['area', 'message'])
})

const unchangedFixerReports = [
  ['a missing builder report and a fixer that reports clean', undefined, cleanCheck, true],
  ['an exit 2 builder report and a fixer that reports clean', { command: 'quality check', exit: 2, findings: [] }, cleanCheck, true],
  ['a builder finding and a fixer that reports no quality gate', findingsCheck('tests/big_test.py: 829 lines'), { noQualityGate: 'the repository has no quality/config.toml' }, true],
  ['a builder finding and a fixer whose check could not run an area', findingsCheck('tests/big_test.py: 829 lines'), couldNotRunCheck(notRun), true],
  ['a builder finding and a fixer whose could-not-run statement names no area', findingsCheck('tests/big_test.py: 829 lines'), couldNotRunCheck({ message: notRun.message }), false],
  ['a missing builder report and a fixer that reports none either', undefined, undefined, false],
  ['a builder finding and a fixer that reports it again', findingsCheck('tests/big_test.py: 829 lines'), findingsCheck('tests/big_test.py: 829 lines'), false],
]

for (const [what, builderCheck, fixerCheck, goesOn] of unchangedFixerReports) {
  test(`a fixer that changes nothing ${goesOn ? 'goes on to review' : 'stops the lane'} for ${what}`, async () => {
    const answers = { build: { ...built, check: builderCheck }, 'fix-1': { ...unchangedFix, check: fixerCheck }, 'r1-review': APPROVE, 'ci-0': greenCi(resumeTip), 'e2e-0': PASS }
    const { result, launchedAgents } = await runLane(builtLane, answers)
    if (goesOn) {
      assert.equal(result.status, 'ready-to-land')
      assert.ok(launchedAgents.includes('r1-review'), launchedAgents.join())
    } else {
      assert.deepEqual([result.status, result.stage, result.reason], ['failed', 'fix', 'the fixer changed nothing'])
    }
  })
}

test('findings the builder and its fixers never clear end the lane on the ci budget, with no review', async () => {
  const answers = { build: { ...built, check: findingsCheck('first') }, 'fix-1': { ...resumeFix, check: findingsCheck('second') }, 'fix-2': { ...secondFix, check: findingsCheck('third') } }
  const { result, launchedAgents } = await runLane({ ...builtLane, budgets: { ci: 2 } }, answers)
  assert.deepEqual([result.status, result.stage, result.reason], ['ci-red', 'ci', 'ci budget spent'])
  assert.deepEqual(result.lastBlocking.map(f => f.text), ['third'])
  assert.ok(!launchedAgents.some(label => /^r\d+-review$/.test(label) || label === 'fix-3'), launchedAgents.join())
})

test('the builder schema and the fixer schema both require a check report', async () => {
  const { agentCalls } = await runLane(builtLane, { build: { ...built, check: findingsCheck('x') }, 'fix-1': resumeFix })
  assert.ok(agentCalls.build.options.schema.required.includes('check'))
  assert.ok(agentCalls['fix-1'].options.schema.required.includes('check'))
  assert.deepEqual(agentCalls['fix-1'].options.schema.properties.check, agentCalls.build.options.schema.properties.check)
})
