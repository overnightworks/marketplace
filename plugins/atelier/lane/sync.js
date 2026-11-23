// A merge conflict the sync could not resolve by its own rules (ledgers, generated files) becomes a finding for a fresh fixer, the way CI's conflict finding does.
const SYNC_CONFLICT_RULE = 'the lane contains origin/main before its review'
const TREE_LINE = /^[0-9a-f]{40}$/
const isSyncConflictFinding = (f) => f.where === 'mergeable' && f.rule === SYNC_CONFLICT_RULE
const conflictedPathsOf = (blocking) => blocking.filter(isSyncConflictFinding).flatMap(f => f.paths ?? [])

// The conflict of the sync's merge-tree read, or null when the sync keeps its escalation: no conflict read (an error, a clean merge, a first line that is no tree),
// or every conflicted path is one the sync's own rules resolve and the list is complete.
function syncConflictOf(values, covered) {
  const read = values.conflict
  if (read?.code !== 1 || !TREE_LINE.test(read.tree || '') || !read.paths?.length) return null
  const cut = read.count > read.paths.length
  return !cut && read.paths.every(path => covered.includes(path)) ? null : { paths: read.paths, cut }
}

const syncConflictFinding = ({ paths, cut }) => ({ where: 'mergeable', kind: 'defect', text: `the lane conflicts with origin/main in ${paths.join(', ')}${cut ? ' and more' : ''}`, rule: SYNC_CONFLICT_RULE, evidence: paths.join(', '), paths })

// The sentences that make a reviewer read a merge fix as the merge it is: each conflicted path against both sides, and every other path the merge commits change.
function mergeReading({ conflicted, merged, mergedCut, generatedPaths }) {
  if (!conflicted.length) return ''
  const others = merged.filter(path => !conflicted.includes(path) && !generatedPaths.includes(path))
  return ` The fix merges origin/main, which conflicted in ${conflicted.join(', ')}: for each of those paths check that main's change survives (git diff M^1 M -- <path>) and that the lane's survives (git diff M^2 M -- <path>), M being the merge commit; a lost intent or behaviour neither side had is blocking.` +
    others.map(path => ` The merge commit also changes ${path}; check that it keeps main's change and adds no behaviour.`).join('') +
    (mergedCut ? ' The list of paths the merge commits change is cut at 50: read the rest with git log --first-parent --merges --remerge-diff --name-only --format=.' : '')
}
