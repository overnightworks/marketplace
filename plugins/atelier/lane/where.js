// A finding's `where` leaves the lane (history, follow-ups, routing line, pull request body) as a path relative to the worktree root:
// an agent may return an absolute path, which would carry the operator's home directory into a public text.
const withoutTrailingSlashes = (path) => {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  return path.slice(0, end)
}
export const repoRelative = (where, worktree) => {
  const root = `${withoutTrailingSlashes(worktree)}/`
  if (typeof where !== 'string') return where
  return where.startsWith(root) ? where.slice(root.length) : where.replace(/^\.\//, '')
}
const relativeEntries = (entries, worktree) => entries?.map(entry => ({ ...entry, where: repoRelative(entry.where, worktree) }))
// An agent answer with its findings under blocking, followups, failing or red[].findings, each made relative.
export const relativeAnswer = (answer, worktree) => {
  if (!answer) return answer
  const relative = {}
  for (const key of ['blocking', 'followups', 'failing']) if (Array.isArray(answer[key])) relative[key] = relativeEntries(answer[key], worktree)
  if (Array.isArray(answer.red)) relative.red = answer.red.map(red => ({ ...red, findings: relativeEntries(red.findings, worktree) }))
  return { ...answer, ...relative }
}
