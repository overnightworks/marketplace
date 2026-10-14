// Pins the CI guard that refuses a workflow whose meta the Workflow tool would reject.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { metaLiteralProblem } from '../scripts/check_workflow_meta.mjs'

const literalMetas = [
  ['strings, numbers, booleans and null', `export const meta = { name: 'lane', whenToUse: "one string", turns: 3, ratio: -1.5, ok: true, no: false, none: null }`],
  ['nested objects, arrays and comments', `export const meta = {\n  // why\n  inputs: [{ key: 'a' }, { key: 'b' }],\n}\nconst later = 'a' + 'b'`],
]
for (const [shape, source] of literalMetas) {
  test(`accepts a meta made of ${shape}`, () => {
    assert.equal(metaLiteralProblem(source), null)
  })
}

const nonLiteralMetas = [
  ['string concatenation', `export const meta = { whenToUse: 'a' + 'b' }`],
  ['a template literal', 'export const meta = { whenToUse: `a` }'],
  ['a referenced name', `export const meta = { whenToUse: WHEN }`],
  ['a function call', `export const meta = { whenToUse: describe() }`],
]
for (const [expression, source] of nonLiteralMetas) {
  test(`refuses a meta containing ${expression}`, () => {
    assert.match(metaLiteralProblem(source), /not a pure literal/)
  })
}

test('refuses a script without an exported meta object', () => {
  assert.match(metaLiteralProblem(`const meta = { name: 'x' }`), /no export const meta/)
})

test('every shipped workflow carries a pure literal meta', () => {
  const workflows = new URL('../plugins/atelier/workflows/', import.meta.url)
  for (const file of fs.readdirSync(workflows).filter(name => name.endsWith('.js'))) {
    assert.equal(metaLiteralProblem(fs.readFileSync(new URL(file, workflows), 'utf8')), null, file)
  }
})
