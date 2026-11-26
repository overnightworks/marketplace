// Drives the atelier lane workflow script through the check that its worktree exists and has the lane branch checked out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runLane, resumedLane, partReplaced, builtLane } from './lane_workflow_harness.mjs'

const noAgentRan = (run) => ['build', 'sync', 'scope'].every(prefix => !run.launchedAgents.some(label => label.startsWith(prefix)))

for (const [name, lane] of [['a build', builtLane], ['a run on a pull request', resumedLane]]) {
  test(`${name} in a worktree with another branch checked out fails at input before any agent works`, async () => {
    const run = await runLane(lane, { branch: { branch: 'claude/other' } })
    assert.equal(run.result.status, 'failed')
    assert.equal(run.result.stage, 'input')
    assert.match(run.result.reason, /worktree \/w .*branch b .*found claude\/other/)
    assert.ok(noAgentRan(run))
  })

  test(`${name} in a worktree that does not exist fails at input with the same reason`, async () => {
    const run = await runLane(lane, { branch: { printed: "sh: 1: cd: can't cd to /w" } })
    assert.equal(run.result.status, 'failed')
    assert.equal(run.result.stage, 'input')
    assert.match(run.result.reason, /worktree \/w .*branch b .*found .*can't cd to \/w/)
    assert.ok(noAgentRan(run))
  })

  test(`${name} in a directory that is no git repository fails at input naming the git exit`, async () => {
    const run = await runLane(lane, { branch: { branch_code: 128 } })
    assert.equal(run.result.status, 'failed')
    assert.equal(run.result.stage, 'input')
    assert.match(run.result.reason, /worktree \/w .*branch b .*found git exited 128: .*not a git repository/)
    assert.ok(noAgentRan(run))
  })
}

test('a worktree with the lane branch checked out goes on to the builder', async () => {
  const run = await runLane(builtLane, { build: { pr: 2, tip: 'abcdef0', blocked: false } })
  assert.ok(run.launchedAgents.includes('build'))
})

test('a relay part that throws during the worktree check fails the lane at input', async () => {
  const run = await runLane(builtLane, {}, { transform: partReplaced('laneRelay', "throw new Error('the child exploded')") })
  assert.deepEqual([run.result.status, run.result.stage], ['failed', 'input'])
  assert.match(run.result.reason, /branch b/)
})
