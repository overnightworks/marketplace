// Pins that the branch floor passes at or above its percentage, fails below it and fails when the report holds no such file.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/check_branch_floor.mjs'

const report = ['a/one.js:4:3', 'a/two.js:2:1', 'b/other.js:10:0']
  .map(entry => entry.split(':'))
  .map(([file, found, hit]) => `TN:\nSF:${file}\nBRF:${found}\nBRH:${hit}\nend_of_record\n`)
  .join('')
const reportFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'branch-floor-')), 'lcov.info')
fs.writeFileSync(reportFile, report)

// Runs the check in this process, so the coverage gate on scripts/ sees it.
function check(floor, files) {
  mock.method(console, 'log', () => {})
  const errors = []
  mock.method(console, 'error', (message) => errors.push(message))
  process.exitCode = undefined
  main([reportFile, String(floor), files])
  const code = process.exitCode ?? 0
  process.exitCode = undefined
  return { code, errors }
}

afterEach(() => mock.restoreAll())

test('the floor holds when the files measure exactly its percentage', () => {
  assert.equal(check(66.66, 'a/').code, 0)
})

test('the floor fails when the files measure below its percentage', () => {
  const { code, errors } = check(75, 'a/')
  assert.equal(code, 1)
  assert.match(errors[0], /below its branch-coverage floor of 75 %/)
})

test('the check fails when the report holds no file of the path', () => {
  const { code, errors } = check(0, 'missing/')
  assert.equal(code, 1)
  assert.match(errors[0], /holds no branches of missing\//)
})
