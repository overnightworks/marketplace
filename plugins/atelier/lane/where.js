// A finding's `where` leaves the lane (history, follow-ups, routing line, pull request body) as a path relative to the repository root:
// an agent may return an absolute path, which would carry the operator's home directory into a public text.
const withoutTrailingSlashes = (path) => {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  return path.slice(0, end)
}
// A path starts where no word, dot, slash or dash precedes it.
const PATH_BOUNDARY = String.raw`(?<![\w./-])`
const escapedForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
// Every occurrence of a root followed by a slash goes, and a bare root reads as `.`, wherever it stands in the text: the roots are the worktree and, once the lane has read them, its symlink-resolved path and the main checkout.
export const repoRelative = (where, roots) => {
  if (typeof where !== 'string') return where
  const prefixes = [...new Set(roots.map(withoutTrailingSlashes).filter(Boolean))].sort((a, b) => b.length - a.length)
  const stripped = where.replace(new RegExp(String.raw`${PATH_BOUNDARY}(?:${prefixes.map(escapedForPattern).join('|')})(?:/|(?![\w./-]))`, 'g'), (match) => match.endsWith('/') ? '' : '.')
  return stripped.replace(/^\.\//, '')
}
// Every absolute path in a text, whichever root it lies under, reads `<path>`.
export const withoutAbsolutePaths = (text) => text.replace(new RegExp(String.raw`${PATH_BOUNDARY}/[^\s"'<>,}\]]+`, 'g'), '<path>')
export const relativeEntries = (entries, roots) => entries?.map(entry => ({ ...entry, where: repoRelative(entry.where, roots) }))
// An agent answer with its findings under blocking, followups, failing or red[].findings, each made relative.
export const relativeAnswer = (answer, roots) => {
  if (!answer) return answer
  const relative = {}
  for (const key of ['blocking', 'followups', 'failing']) if (Array.isArray(answer[key])) relative[key] = relativeEntries(answer[key], roots)
  if (Array.isArray(answer.red)) relative.red = answer.red.map(red => ({ ...red, findings: relativeEntries(red.findings, roots) }))
  return { ...answer, ...relative }
}
