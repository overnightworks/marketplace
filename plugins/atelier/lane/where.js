// A finding's `where` leaves the lane (history, follow-ups, routing line, pull request body) as a path relative to the repository root:
// an agent may return an absolute path, which would carry the operator's home directory into a public text.
const withoutTrailingSlashes = (path) => {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  return path.slice(0, end)
}
const escapedForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Every occurrence of a root followed by a slash goes, wherever it stands in the text: the roots are the worktree and, once the lane has read them, its symlink-resolved path and the main checkout.
export const repoRelative = (where, roots) => {
  if (typeof where !== 'string') return where
  const prefixes = [...new Set(roots.map(withoutTrailingSlashes).filter(Boolean))].sort((a, b) => b.length - a.length)
  const stripped = where.replace(new RegExp(`(?<![\\w./-])(?:${prefixes.map(escapedForPattern).join('|')})/`, 'g'), '')
  return stripped.replace(/^\.\//, '')
}
export const relativeEntries = (entries, roots) => entries?.map(entry => ({ ...entry, where: repoRelative(entry.where, roots) }))
// An agent answer with its findings under blocking, followups, failing or red[].findings, each made relative.
export const relativeAnswer = (answer, roots) => {
  if (!answer) return answer
  const relative = {}
  for (const key of ['blocking', 'followups', 'failing']) if (Array.isArray(answer[key])) relative[key] = relativeEntries(answer[key], roots)
  if (Array.isArray(answer.red)) relative.red = answer.red.map(red => ({ ...red, findings: relativeEntries(red.findings, roots) }))
  return { ...answer, ...relative }
}
