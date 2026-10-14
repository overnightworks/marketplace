// The Workflow tool refuses a script whose `meta` is not a pure literal
// (string concatenation, a template literal, a name), so a workflow that
// parses fine still cannot start. This walks each meta object token by token
// and accepts only strings, numbers, true/false/null, keys and punctuation.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const META_DECLARATION = 'export const meta = {'
// Each kind of token a pure literal may contain, named so the alternation
// below stays readable; a single regex literal for all of them is unreadable.
const LITERAL_TOKEN_KINDS = {
  whitespace: /\s+/,
  lineComment: /\/\/[^\n]*/,
  singleQuotedString: /'(?:[^'\\\n]|\\.)*'/,
  doubleQuotedString: /"(?:[^"\\\n]|\\.)*"/,
  number: /-?\d+(?:\.\d+)?/,
  constant: /true|false|null/,
  key: /[A-Za-z_$][\w$]*(?=\s*:)/,
  punctuation: /[{}[\],:]/,
}
const LITERAL_TOKEN = new RegExp(Object.values(LITERAL_TOKEN_KINDS).map(kind => kind.source).join('|'), 'y')
const NESTING = { '{': 1, '[': 1, '}': -1, ']': -1 }
const SAME_LINE_TRIVIA = /(?:[^\S\n]|\/\/[^\n]*)*/y
const ANY_TRIVIA = /(?:\s|\/\/[^\n]*)*/y
// A binary operator spelled as a word would still extend the initializer.
const STATEMENT_START = /^(?!(?:in|instanceof)\b)[A-Za-z_$]/

/** Returns why the script's meta is not a pure literal, or null when it is. */
export function metaLiteralProblem(source) {
  const declaration = source.indexOf(META_DECLARATION)
  if (declaration < 0) return `no ${META_DECLARATION} ... }`
  const objectEnd = endOfLiteralObject(source, declaration + META_DECLARATION.length - 1)
  if (objectEnd.problemAt !== undefined) return notPureLiteralNear(source, objectEnd.problemAt)
  if (!endsDeclaration(source, objectEnd.at)) return notPureLiteralNear(source, objectEnd.at)
  return null
}

function endOfLiteralObject(source, openingBrace) {
  const token = new RegExp(LITERAL_TOKEN)
  token.lastIndex = openingBrace
  let depth = 0
  do {
    const at = token.lastIndex
    const match = token.exec(source)
    if (!match) return { problemAt: at }
    depth += NESTING[match[0]] ?? 0
  } while (depth > 0)
  return { at: token.lastIndex }
}

// After the object only a semicolon, the end of the file, or a line break into
// a new statement may follow; anything else would extend the initializer.
function endsDeclaration(source, objectEnd) {
  const next = skipTrivia(SAME_LINE_TRIVIA, source, objectEnd)
  if (next === source.length || source[next] === ';') return true
  if (source[next] !== '\n') return false
  const statement = skipTrivia(ANY_TRIVIA, source, next)
  return statement === source.length || STATEMENT_START.test(source.slice(statement))
}

function skipTrivia(trivia, source, from) {
  const skipper = new RegExp(trivia)
  skipper.lastIndex = from
  skipper.exec(source)
  return skipper.lastIndex
}

function notPureLiteralNear(source, at) {
  return `meta is not a pure literal near: ${source.slice(at, at + 40)}`
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
