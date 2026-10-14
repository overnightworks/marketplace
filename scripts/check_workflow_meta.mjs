// The Workflow tool refuses a script whose `meta` is not a pure literal
// (string concatenation, a template literal, a name), so a workflow that
// parses fine still cannot start. This walks each meta object token by token
// and accepts only strings, numbers, true/false/null, keys and punctuation.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const META_DECLARATION = 'export const meta = {'
const LITERAL_TOKEN = /\s+|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|[A-Za-z_$][\w$]*(?=\s*:)|[{}[\],:]/y
const NESTING = { '{': 1, '[': 1, '}': -1, ']': -1 }
// After the object only a semicolon, the end of the file, or a line break into
// a new statement may follow; anything else would extend the initializer.
const DECLARATION_END = /(?:[^\S\n]|\/\/.*$)*(?:;|$(?![^])|\n(?:\s|\/\/.*$)*(?:$(?![^])|(?!(?:in|instanceof)\b)[A-Za-z_$]))/my

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
  const end = new RegExp(DECLARATION_END)
  end.lastIndex = token.lastIndex
  if (!end.test(source)) return `meta is not a pure literal near: ${source.slice(token.lastIndex, token.lastIndex + 40)}`
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
