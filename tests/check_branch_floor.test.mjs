// Pins that the branch floor passes at or above its percentage, fails below it, fails when the report holds no such file
// and covers only files under the given path.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/check_branch_floor.mjs', import.meta.url))
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-floor-'))
const report = ['a/one.js:4:3', 'a/two.js:2:1', 'b/other.js:10:0', 'xa/three.js:2:0']
  .map(entry => entry.split(':'))
  .map(([file, found, hit]) => `TN:\nSF:${path.join(workdir, file)}\nBRF:${found}\nBRH:${hit}\nend_of_record\n`)
  .join('')
fs.writeFileSync(path.join(workdir, 'lcov.info'), report)

function check(floor, files) {
  const run = spawnSync(process.execPath, [script, 'lcov.info', String(floor), files], { cwd: workdir, encoding: 'utf8' })
  return { code: run.status, out: run.stdout, errors: run.stderr }
}

test('the floor holds when the files measure exactly its percentage', () => {
  const { code, out } = check(66.66, 'a/')
  assert.equal(code, 0)
  assert.match(out, /4 of 6 branches, 66\.67 %/)
})

test('the floor fails when the files measure below its percentage', () => {
  const { code, errors } = check(75, 'a/')
  assert.equal(code, 1)
  assert.match(errors, /below its branch-coverage floor of 75 %/)
})

test('the check fails when the report holds no file of the path', () => {
  const { code, errors } = check(0, 'missing/')
  assert.equal(code, 1)
  assert.match(errors, /holds no branches of missing\//)
})

test('a single file path covers only that file', () => {
  assert.match(check(0, 'a/one.js').out, /3 of 4 branches/)
})
