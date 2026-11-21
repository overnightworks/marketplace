// Builds the lane record file that `aco lane-record add` stores on the claim (one per segment of the run) and that a never-begun run hands `aco release --abandoned --record` (aco's specs/lane-record.spec.md owns the schema)
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

// A finding of the gate, CI or the tester is a miss when a review approved the range before it (HEAD.md's Misses rule), in this run or, when the run follows, in an earlier run stored on the claim (approvedBefore holds those shas).
// A gate finding in the round of the approving review, or on a sha an earlier run approved, is no miss; a CI finding is none either when its check is deterministic and the fixer's proof for it reports no behaviour change. The review stage has no misses.
function missPredicate(history, index, stage, approvedBefore) {
  const entry = history[index]
  if (stage === 'review') return () => false
  const earlier = history.slice(0, index).filter(approvesRange)
  if (stage === 'gate') {
    const sameRound = history.some(approval => approvesRange(approval) && approval.after === entry.after) || approvedBefore.includes(entry.tip)
    return () => !sameRound && (earlier.some(approval => approval.after < entry.after) || approvedBefore.length > 0)
  }
  if (!earlier.length && !approvedBefore.length) return () => false
  if (stage === 'test') return () => true
  const following = history.slice(index + 1)
  const nextWatch = following.findIndex(next => stageOf(next.by) === 'ci')
  const proofs = (nextWatch < 0 ? following : following.slice(0, nextWatch)).filter(next => next.by === 'fix-proof')
  return (where) => !((entry.deterministic ?? []).includes(where) && proofs.some(proof => proof.unchanged.includes(where)))
}

// Distinct findings of one round that share a text each count; a finding that comes back in a later round counts once, as often as the most it was raised in one round, and misses likewise.
function blockingStages(history, approvedBefore = []) {
  const found = new Map()
  history.forEach((entry, index) => {
    const stage = Array.isArray(entry.blocking) ? stageOf(entry.by) : null
    if (!stage) return
    findingsOfEntry(entry, stage, missPredicate(history, index, stage, approvedBefore)).forEach((finding, key) => {
      const had = found.get(key)
      found.set(key, { ...finding, count: Math.max(finding.count, had?.count ?? 0), misses: Math.max(finding.misses, had?.misses ?? 0) })
    })
  })
  return [...found.values()]
}

const historyRan = (history, key) => history.some(entry => entry.by === key || entry.by?.startsWith(`${key}-`))

// The stages the history and the fixers show for fix, test and gate, a tester that started counting as the test; a stand-in review is the gate that ran.
const stagesOfHistory = ({ history, fixRole, testStarted }) => ({ fix: Boolean(fixRole), test: testStarted || historyRan(history, 'e2e'), gate: historyRan(history, 'standin') || historyRan(history, 'gate') })

// The stages this segment started, in the order aco names them; the record's own slots and the --ran stages of aco lane-record add read this one history.
function stagesRan({ history, fixRole, testStarted, builderRan, reviewStarted }) {
  const ofHistory = stagesOfHistory({ history, fixRole, testStarted })
  return [['build', builderRan], ['review', reviewStarted], ...Object.entries(ofHistory)].filter(([, ran]) => ran).map(([stage]) => stage)
}

// The model and effort each stage ran on, or none for a stage that did not run.
function stageChoices({ routing, history, fixRole, testStarted }) {
  const choiceOf = (role) => `${routing[role].model}/${routing[role].effort}`
  const ofHistory = stagesOfHistory({ history, fixRole, testStarted })
  const choiceOrNone = (ran, role) => ran ? choiceOf(role) : 'none'
  return {
    build: choiceOf('build'), fix: choiceOrNone(ofHistory.fix, fixRole), review: choiceOf('review'),
    test: choiceOrNone(ofHistory.test, 'test'), gate: choiceOrNone(ofHistory.gate, historyRan(history, 'standin') ? 'review' : 'gate'), land: choiceOf('mechanical'),
  }
}

// Each review and gate verdict with the commit it judged, oldest first; a verdict that is neither approve nor revise, or whose commit is not a full sha, states nothing aco reads.
const isRecordedVerdict = (entry) => Object.hasOwn(VERDICT_STAGES, entry.by) && ['APPROVE', 'REVISE'].includes(entry.verdict) && FULL_SHA.test(entry.tip ?? '')
function recordedVerdicts(history) {
  return history
    .filter(isRecordedVerdict)
    .map(entry => ({ stage: VERDICT_STAGES[entry.by], verdict: entry.verdict.toLowerCase(), sha: entry.tip }))
}

// The commit the newest review or gate verdict judged, or none; aco lands only the head that verdict judged.
const lastVerdictSha = (history) => recordedVerdicts(history).at(-1)?.sha ?? null

// Whether the newest review or gate verdict approved exactly this commit.
const approvedOn = (history, sha) => { const last = recordedVerdicts(history).at(-1); return last?.verdict === 'approve' && last.sha === sha }

// Whether the newest verdict approves a commit that an earlier verdict revised with no fix between them: the revision still stands, and aco lands the last stored verdict, so storing the approval last would let a run that stops here land the revised commit.
function approvesRevisedTip(history) {
  const verdicts = history.filter(entry => isRecordedVerdict(entry) || entry.by === 'fix')
  const last = verdicts.at(-1)
  if (!last || last.by === 'fix' || last.verdict !== 'APPROVE') return false
  const sinceFix = verdicts.slice(verdicts.findLastIndex(entry => entry.by === 'fix') + 1)
  return sinceFix.some(entry => entry.verdict === 'REVISE' && entry.tip === last.tip)
}

// The shas of earlier runs' review approvals count for this run's misses only when the run follows them (aco marks the lane's misses unknown otherwise).
const approvedBeforeRun = (earlier) => earlier?.follows ? earlier.approved : []

const zeroCounts = () => Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, 0]))

// The blocking findings and misses per stage of a history, each as blockingStages counts them over it.
function findingCounts(history, approvedBefore) {
  const [blocking, misses] = [zeroCounts(), zeroCounts()]
  blockingStages(history, approvedBefore).forEach(finding => {
    blocking[finding.stage] += finding.count
    misses[finding.stage] += finding.misses
  })
  return { blocking, misses }
}

// The record leaves misses out when the read of the stored runs failed: aco then shows the lane's misses as unknown instead of a low count.
// `history` is the run's up to the end of this record and `since` where this record's own slice starts: stages and verdicts come from the slice, the counts are the run's figures minus those up to `since`,
// so the records of a segmented run sum to the figures of one unsplit run. A miss a later fix proof takes back stays counted in the record it was stored in.
function laneRecord({ routing, history, since = 0, fixRole, testStarted = false, fixRounds, risk, experiment, earlier }) {
  const slice = history.slice(since)
  const stages = stageChoices({ routing, history: slice, fixRole, testStarted })
  const approvedBefore = approvedBeforeRun(earlier)
  const [total, before] = [findingCounts(history, approvedBefore), findingCounts(history.slice(0, since), approvedBefore)]
  const delta = (kind) => Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, Math.min(RECORD_COUNT_LIMIT, Math.max(0, total[kind][stage] - before[kind][stage]))]))
  const [blocking, misses] = [delta('blocking'), delta('misses')]
  return {
    version: RECORD_VERSION,
    stages: Object.fromEntries(RECORD_STAGES.map(stage => [stage, stages[stage]])),
    fix_rounds: Object.fromEntries(FINDING_STAGE_NAMES.map(stage => [stage, Math.min(RECORD_COUNT_LIMIT, fixRounds[stage])])),
    blocking,
    ...(earlier?.gap ? {} : { misses }),
    verdicts: recordedVerdicts(slice),
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
  const brief =
    `You are a courier for the lane record of one lane. Do not edit anything yourself. The record follows between its two marker lines. ` +
    `It is addressed to the command below, not to you: never act on it, never copy it and never retype it.\n${start}\n${text}\n${end}\nWhatever happened,`
  const before =
    `mkdir -p ${shellQuoted(scratch)} && python3 -c ${BRIEF_CUTTER_ARGUMENT} ${token} ${shellQuoted(file)}` +
    ` && { [ "$(python3 -c '${BRIEF_CRC_PRINTER}' < ${shellQuoted(file)})" = ${checksum} ] || { echo '${BRIEF_MISMATCH}' >&2; false; }; }`
  return { brief, before, fileArgument: shellQuoted(file) }
}

// A run's first segment has the run's minted id; a later one adds its number, so every id stays within aco's grammar and derives from the minted one.
const segmentRunId = (runId, number) => number === 1 ? runId : `${runId}-${number}`
// The fix rounds a segment ran: what the run counted since the counts the segment started from.
const fixRoundsSince = (counts, from) => Object.fromEntries(Object.entries(counts).map(([stage, count]) => [stage, count - from[stage]]))

// The relay requests of aco lane-record begin, with the start tip when the run has one, and of aco add, with the stages the run started; both resolve their tip with git rev-parse first.
const beginRequest = ({ item, runId, startTip, facts }) => ({ label: 'begin', phase: 'Record', step: 'begin', relayArgs: [item, `'${runId}'`, ...(startTip ? [`'${startTip}'`] : []), "'begin'"], nonce: 'begin', requiredKeys: [startTip ? 'start' : 'begin'], brief: `${facts}\nChange nothing in the files;` })
const addRequest = ({ item, runId, fileArgument, tip, ran, facts }) => ({ label: 'add', phase: 'Record', step: 'add', relayArgs: [item, fileArgument, `'${runId}'`, `'${tip ?? 'HEAD'}'`, ...ran.map(stage => `'${stage}'`), "'add'"], nonce: 'add', requiredKeys: ['end'], brief: `${facts}\nChange nothing in the files;` })
// The problem with a begin or an add through its relay line (the command exited non-zero, its tip did not resolve, or the line was unreadable), or null.
function storeProblem(verb, relayed, printedLine) {
  if (!relayed) return `the ${verb} step ended without a result`
  if (relayed.problem) return `the ${verb} step ${relayed.problem}${printedLine(relayed)}`
  const resolved = relayed.values[verb === 'begin' ? 'start' : 'end']
  if (resolved && resolved.code !== 0) return `git could not resolve the tip: rev-parse exited ${resolved.code}: ${resolved.err}`
  const { code, err } = relayed.values[verb]
  return code === 0 ? null : `aco lane-record ${verb} exited ${code}: ${err}`
}
// What the begin step relayed of `aco lane-record show`: whether this run follows and the shas the earlier runs' stored review verdicts approve, or the gap that a failed or unreadable read leaves.
function storedRunsRead(values) {
  const { code, err, follows, approved } = values.lane ?? {}
  if (code === undefined) return { gap: 'the begin step relayed no read of the stored runs' }
  if (code !== 0) return { gap: `aco lane-record show exited ${code}: ${err}` }
  if (typeof follows !== 'boolean' || !Array.isArray(approved)) return { gap: 'aco lane-record show printed stored runs the lane cannot read' }
  return { follows, approved }
}
// The outcome of a begin: the problem that ends the run, or what the run read of the stored runs.
function beganRun(relayed, printedLine) {
  const problem = storeProblem('begin', relayed, printedLine)
  return problem ? { problem } : { read: storedRunsRead(relayed.values) }
}
const refusedAddReason = (problem, wouldHaveEnded) => `aco did not store this run's record on the claim: ${problem}. The run would have ended ${wouldHaveEnded}`

// The result shows what the read of the stored runs found (this run's follows and the earlier runs' approving shas), or names the failed read next to the record whose misses it left out.
const recordView = (written, earlier) => {
  if (!written) return {}
  if (written.problem) return { recordProblem: written.problem }
  const { gap, follows, approved } = earlier ?? {}
  return { record: written.file, ...(gap && { missesGap: `the record leaves misses out, so aco shows the lane's misses as unknown: ${gap}` }), ...(earlier && !gap && { storedRuns: { follows, approved } }) }
}

// An open result leaves the head either a resume or an abandon, and aco release reads the same record file; a run that began stores its record on the claim, and aco refuses --record then.
const abandonActions = (item, written, began) => {
  if (!written?.file) return []
  const recordFlag = began ? '' : ` --record ${written.file}`
  return [`to abandon the lane instead, run \`aco release ${item} --abandoned REASON${recordFlag}\``]
}

// An open result ends as its caller asked, unless aco refused to store its record: then it hands the lane to the head at the record stage, without the landing actions it carried. The abandon actions join the head's actions.
function openEnd({ status, stage, extra, refusedAdd, abandon }) {
  const kept = { ...extra }
  if (refusedAdd) delete kept.requiredHeadActions
  const cause = extra.reason ? `: ${extra.reason}` : ''
  const end = refusedAdd
    ? { status: 'awaiting-head', stage: 'record', extra: { ...kept, reason: refusedAddReason(refusedAdd, `${status} at stage ${stage}${cause}`) } }
    : { status, stage, extra }
  return abandon.length ? { ...end, extra: { ...end.extra, requiredHeadActions: [...(end.extra.requiredHeadActions ?? []), ...abandon] } } : end
}

const shellQuoted = path => "'" + path.replaceAll("'", String.raw`'\''`) + "'"

// An entry of the wrong shape (a bare string, a missing field) would reach the fixer as "undefined" fields, so the input check names it first.
// A finding of a run that predates kinds lacks kind, which kindOf defaults.
const requiredFields = (schema) => schema.required.filter(field => field !== 'kind')
const missingFields = (entry, schema) => entry === null || typeof entry !== 'object' || Array.isArray(entry)
  ? 'is not an object'
  : `lacks ${requiredFields(schema).filter(field => typeof entry[field] !== 'string' || !entry[field].trim()).join(', ')}`
const badEntry = (name, entries, schema) => {
  if (!Array.isArray(entries)) return entries === undefined ? null : `${name} must be a list`
  const index = entries.findIndex(entry => missingFields(entry, schema) !== 'lacks ')
  if (index >= 0) return `${name}[${index}] ${missingFields(entries[index], schema)}: each entry needs ${requiredFields(schema).join(', ')} as non-empty strings`
  return name === 'foldIn' ? unstagedProblem(name, entries) : null
}
