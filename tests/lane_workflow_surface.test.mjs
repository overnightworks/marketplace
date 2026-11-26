// Drives the design advice of a lane that changes a surface: which agents are told, and that a design observation never blocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, resumeArgs, resumeFixedTip, resumeFix, APPROVE, PASS, greenCi, defectWithoutDraft, built, builtLane } from './lane_workflow_harness.mjs'

const SKILL = /atelier:design-interface/
const surfaceLane = { touched_surfaces: ['frontend/src/app.tsx'] }
const lanes = [
  ['a lane with touched surfaces', surfaceLane, true],
  ['a lane with an empty touched_surfaces', { touched_surfaces: [] }, false],
  ['a lane whose aco prints no touched_surfaces', {}, false],
]
const reviseOnce = { verdict: 'REVISE', blocking: [{ ...defectWithoutDraft, kind: 'docs' }], followups: [] }
const aFix = { ...resumeFix, regression: [] }
const passing = (design) => ({ ...PASS, ...(design && { design }) })
const finishes = (scope, e2e = PASS) => ({ build: built, 'scope-0': scope, 'r0-review': APPROVE, 'e2e-0': e2e, 'ci-0': greenCi(built.tip) })

for (const [name, scope, told] of lanes) {
  test(`the builder is told to check for a surface, and the tester and a later fixer only for ${name}`, async () => {
    const { agentCalls } = await runLane(builtLane, finishes(scope))
    assert.match(agentCalls.build.prompt, SKILL)
    assert.equal(SKILL.test(agentCalls['e2e-0'].prompt), told)
    const revised = await runLane(builtLane, { ...finishes(scope), 'r0-review': reviseOnce, 'fix-1': aFix, 'scope-1': scope, 'r1-review': APPROVE })
    assert.equal(SKILL.test(revised.agentCalls['fix-1'].prompt), told)
  })
}

test('a fixer carrying fixFirst, whose surface count is not yet known, is told to check for a surface', async () => {
  const { agentCalls } = await runLane({ ...resumeArgs, fixFirst: [defectWithoutDraft] }, { 'fix-1': aFix })
  assert.match(agentCalls['fix-1'].prompt, SKILL)
})

test('a design observation stays an in-place-false follow-up outside a CI fixer prompt and the run ends ready-to-land', async () => {
  const design = { capture: 'captured', observations: [{ where: 'settings view, narrow', text: 'the badge is only a colour' }] }
  const red = { head: resumeFixedTip, green: false, failing: [{ ...defectWithoutDraft, where: 'ci.yml', kind: 'defect' }] }
  const { result, agentCalls } = await runLane(resumeArgs, { 'scope-resume': surfaceLane, 'r0-review': APPROVE, 'e2e-0': passing(design), 'ci-0': { ...red, head: resumeArgs.tip }, 'fix-1': aFix, 'scope-1': surfaceLane, 'r1-review': APPROVE, 'ci-1': greenCi(resumeFixedTip) })
  assert.equal(result.status, 'ready-to-land', result.reason)
  const observed = result.followups.find(f => f.where === 'settings view, narrow')
  assert.deepEqual([observed.inPlace, observed.stage], [false, 'test'])
  assert.doesNotMatch(agentCalls['fix-1'].prompt, /badge is only a colour/)
})

for (const [behaviour, design, capture] of [
  ['a gap capture', { capture: 'gap', note: 'no browser' }, 'gap'],
  ['a test-only capture', { capture: 'test-only' }, 'test-only'],
  ['a missing design report', undefined, 'not reported'],
]) {
  test(`${behaviour} on a surface lane ends ready-to-land and is recorded as ${capture}`, async () => {
    const { result } = await runLane(resumeArgs, { 'scope-resume': surfaceLane, 'r0-review': APPROVE, 'e2e-0': passing(design), 'ci-0': greenCi(resumeArgs.tip) })
    assert.equal(result.status, 'ready-to-land', result.reason)
    assert.equal(result.history.find(entry => entry.by === 'e2e-0').design.capture, capture)
  })
}
