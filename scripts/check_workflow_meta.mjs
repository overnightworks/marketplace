// The Workflow tool refuses a script whose `meta` is not a pure literal
// (string concatenation, a template literal, a name), so a workflow that
// parses fine still cannot start. This walks each meta object token by token
// and accepts only strings, numbers, true/false/null, keys and punctuation.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const META_DECLARATION = 'export const meta = {'
const LITERAL_TOKEN = /\s+|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|[A-Za-z_$][\w$]*(?=\s*:)|[{}[\],:]/y
const NESTING = { '{': 1, '[': 1, '}': -1, ']': -1 }

/** Returns why the script's meta is not a pure literal, or null when it is. */
export function metaLiteralProblem(source) {
  const declaration = source.indexOf(META_DECLARATION)
  if (declaration < 0) return `no ${META_DECLARATION} ... }`
  const token = new RegExp(LITERAL_TOKEN)
  token.lastIndex = declaration + META_DECLARATION.length - 1
  let depth = 0
  do {
    const at = token.lastIndex
    const match = token.exec(source)
    if (!match) return `meta is not a pure literal near: ${source.slice(at, at + 40)}`
    depth += NESTING[match[0]] || 0
  } while (depth > 0)
  return null
}

function main(files) {
  let failed = false
  for (const file of files) {
    const problem = metaLiteralProblem(fs.readFileSync(file, 'utf8'))
    if (problem) { console.error(`${file}: ${problem}`); failed = true }
  }
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
