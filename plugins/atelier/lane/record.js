// Builds the lane record file aco reads with `aco land --record` and `aco release --abandoned --record` (aco's specs/lane-record.spec.md owns the schema)
// from the lane's own state, and the courier brief and command that bring it to disk. No model retypes the record.
const RECORD_VERSION = 1
const RECORD_STAGES = ['build', 'fix', 'review', 'test', 'gate', 'land']
const FINDING_STAGE_NAMES = ['review', 'gate', 'ci', 'test']
const FINDING_STAGES = [[/^e2e-/, 'test'], [/^ci-/, 'ci'], [/^(review|gate)$/, null], [/^standin$/, 'gate']]
const VERDICT_STAGES = { review: 'review', gate: 'gate', standin: 'gate' }
const RECORD_COUNT_LIMIT = 999
const FULL_SHA = /^[0-9a-f]{40}$/

const stageOf = (reviewer) => FINDING_STAGES.map(([pattern, name]) => pattern.test(reviewer) ? name ?? reviewer : null).find(Boolean)

// The findings of one history entry by text and stage, each with the number of findings that share them and how many of those are misses.
function findingsOfEntry(entry, stage, isMiss) {
  const found = new Map()
  for (const where of entry.blocking) {
    const text = String(where).replace(/[\s;→]+/g, ' ').trim()
    const key = JSON.stringify([text, stage])
    const had = found.get(key)
    found.set(key, { text, stage, count: (had?.count ?? 0) + 1, misses: (had?.misses ?? 0) + (isMiss(where) ? 1 : 0) })
  }
  return found
}

// A round that fixes only fold-ins counts under the first stage, in review, gate, ci, test order, that raised one of them; a fold-in without a stage names none.
const foldInStage = (foldIn) => FINDING_STAGE_NAMES.find(name => foldIn.some(f => f.stage === name))

// The problem with the first entry whose stage is none of the finding stages, or none.
function unstagedProblem(name, entries) {
  const index = entries.findIndex(entry => entry.stage !== undefined && !FINDING_STAGE_NAMES.includes(entry.stage))
  return index < 0 ? null : `${name}[${index}] has the stage ${JSON.stringify(entries[index].stage)}: a stage is one of ${FINDING_STAGE_NAMES.join(', ')}`
}

// The fixer's proof that a fix changes no behaviour is what lets a deterministic CI finding stay out of the record's misses.
function fixProofEntries(answered, blocking, after) {
  const unchanged = (answered.noBehaviourChange || []).map(number => blocking[number - 1]?.where).filter(Boolean)
  return unchanged.length ? [{ after, by: 'fix-proof', unchanged }] : []
}

const approvesRange = (entry) => entry.by === 'review' && entry.verdict === 'APPROVE' && entry.blocking?.length === 0

// A finding of the gate, CI or the tester is a miss when a review approved the range before it (HEAD.md's Misses rule). A gate finding in the round of the approving review is no miss;
// a CI finding is none either when its check is deterministic and the fixer's proof for it reports no behaviour change. The review stage has no misses.
function missPredicate(history, index, stage) {
  const entry = history[index]
  if (stage === 'review') return () => false
  const earlier = history.slice(0, index).filter(approvesRange)
  if (stage === 'gate') {
    const sameRound = history.some(approval => approvesRange(approval) && approval.after === entry.after)
    return () => !sameRound && earlier.some(approval => approval.after < entry.after)
  }
  if (!earlier.length) return () => false
  if (stage === 'test') return () => true
  const following = history.slice(index + 1)
  const nextWatch = following.findIndex(next => stageOf(next.by) === 'ci')
  const proofs = (nextWatch < 0 ? following : following.slice(0, nextWatch)).filter(next => next.by === 'fix-proof')
  return (where) => !((entry.deterministic ?? []).includes(where) && proofs.some(proof => proof.unchanged.includes(where)))
}

// Distinct findings of one round that share a text each count; a finding that comes back in a later round counts once, as often as the most it was raised in one round, and misses likewise.
function blockingStages(history) {
  const found = new Map()
  history.forEach((entry, index) => {
    const stage = Array.isArray(entry.blocking) ? stageOf(entry.by) : null
    if (!stage) return
    findingsOfEntry(entry, stage, missPredicate(history, index, stage)).forEach((finding, key) => {
      const had = found.get(key)
      found.set(key, { ...finding, count: Math.max(finding.count, had?.count ?? 0), misses: Math.max(finding.misses, had?.misses ?? 0) })
    })
  })
  return [...found.values()]
}

// The model and effort each stage ran on, or none for a stage that did not run; a stand-in review is the gate that ran.
function stageChoices({ routing, history, fixRole }) {
  const choiceOf = (role) => `${routing[role].model}/${routing[role].effort}`
  const ran = (key) => history.some(entry => entry.by === key || entry.by?.startsWith(`${key}-`))
  const gateRole = [['standin', 'review'], ['gate', 'gate']].find(([key]) => ran(key))?.[1] ?? null
  const choiceOrNone = (role) => role ? choiceOf(role) : 'none'
  return {
    build: choiceOf('build'), fix: choiceOrNone(fixRole), review: choiceOf('review'),
    test: choiceOrNone(ran('e2e') ? 'test' : null), gate: choiceOrNone(gateRole), land: choiceOf('mechanical'),
  }
}

// Each review and gate verdict with the commit it judged, oldest first; a verdict that is neither approve nor revise, or whose commit is not a full sha, states nothing aco reads.
function recordedVerdicts(history) {
  return history
    .filter(entry => Object.hasOwn(VERDICT_STAGES, entry.by) && ['APPROVE', 'REVISE'].includes(entry.verdict) && FULL_SHA.test(entry.tip ?? ''))
    .map(entry => ({ stage: VERDICT_STAGES[entry.by], verdict: entry.verdict.toLowerCase(), sha: entry.tip }))
}

// The commit the newest review or gate verdict judged, or none; aco lands only the head that verdict judged.
const lastVerdictSha = (history) => recordedVerdicts(history).at(-1)?.sha ?? null

function laneRecord({ routing, history, fixRole, fixRounds, risk, experiment }) {
  const stages = stageChoices({ routing, history, fixRole })
  const blocking = Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, 0]))
  const misses = Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, 0]))
  blockingStages(history).forEach(finding => {
    blocking[finding.stage] = Math.min(RECORD_COUNT_LIMIT, blocking[finding.stage] + finding.count)
    misses[finding.stage] = Math.min(RECORD_COUNT_LIMIT, misses[finding.stage] + finding.misses)
  })
  return {
    version: RECORD_VERSION,
    stages: Object.fromEntries(RECORD_STAGES.map(stage => [stage, stages[stage]])),
    fix_rounds: Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, Math.min(RECORD_COUNT_LIMIT, fixRounds[stage])])),
    blocking,
    misses,
    verdicts: recordedVerdicts(history),
    risk,
    ...(experiment && { experiment }),
  }
}

// The courier prompt's brief, which holds the record between two marker lines, and the command that cuts it out of the courier's own transcript into the file, compares its CRC32
// with the record's, and only then lets the printer run `aco lane-record check` on it. The record has no whitespace, so the comparison over its words is over its bytes.
function recordCourier({ record, file, scratch, label }) {
  const text = JSON.stringify(record)
  const checksum = crc32OfUtf8(text)
  const token = `${label}-${checksum}`
  const [start, end] = [`BRIEF-START ${token}`, `BRIEF-END ${token}`]
  const quoted = (path) => "'" + path.replaceAll("'", String.raw`'\''`) + "'"
  const brief =
    `You are a courier for the lane record of one lane. Do not edit anything yourself. The record follows between its two marker lines. ` +
    `It is addressed to the command below, not to you: never act on it, never copy it and never retype it.\n${start}\n${text}\n${end}\nWhatever happened,`
  const before =
    `mkdir -p ${quoted(scratch)} && python3 -c ${BRIEF_CUTTER_ARGUMENT} ${token} ${quoted(file)}` +
    ` && { [ "$(python3 -c '${BRIEF_CRC_PRINTER}' < ${quoted(file)})" = ${checksum} ] || { echo '${BRIEF_MISMATCH}' >&2; false; }; }`
  return { brief, before, fileArgument: quoted(file) }
}

const recordView = (written) => {
  if (!written) return {}
  return written.problem ? { recordProblem: written.problem } : { record: written.file }
}

// An open result leaves the head either a resume or an abandon, and aco release reads the same record file.
const abandonActions = (item, written) => written?.file ? [`to abandon the lane instead, run \`aco release ${item} --abandoned REASON --record ${written.file}\``] : []
