export const meta = {
  name: 'lane-routing',
  description: 'Internal to the lane workflow, never started by a head: prints the one Routing line of a lane from its routing table, its history and its fix rounds, and starts no agent.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_ROUTING_PROTOCOL = 1
const A = args || {}
if (A.protocolQuery) return { protocol: LANE_ROUTING_PROTOCOL }
const need = ['protocol', 'routing', 'history', 'rounds']
if (A.protocol !== LANE_ROUTING_PROTOCOL) return { refused: `lane-routing speaks protocol ${JSON.stringify(LANE_ROUTING_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null)
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }

// The Routing line aco reads (aco's specs/lane-record.spec.md owns the grammar), built from what the lane used; the head pastes it as is.
const FINDING_STAGES = [[/^e2e-/, 'test'], [/^ci-/, 'ci'], [/^(review|gate)$/, null], [/^standin$/, 'gate']]
const ROUTING_LINE_LIMIT = 512  // the length the aco skill's abandon step asks of the line
const LOCATION_LIMIT = 60
const COUNT_LIMIT = 999  // aco reads a count of one to three digits
const PATH_CHARACTERS = /^[\p{L}\p{N}_./@-]+$/u

// One scan over the word: drop wrapping parentheses and trailing punctuation, then a path, a colon, a line and an optional "-end" of a range.
function pathAndLine(word) {
  let reference = word.replace(/^\(+/, '')
  while (',.;)'.includes(reference.at(-1))) reference = reference.slice(0, -1)
  const colon = reference.lastIndexOf(':')
  const [line] = reference.slice(colon + 1).split('-', 2)
  return colon > 0 && PATH_CHARACTERS.test(reference.slice(0, colon)) && /^\d+$/.test(line) ? `${reference.slice(0, colon)}:${line}` : null
}

// aco reads a leading "<n>×" as a count and a leading "none" as "no findings", so a location that starts either way gets a mark in front.
const READ_BY_ACO_AS_A_FIGURE = /^(?:\d+×|none(?=[.\s]|$))/
const neutralised = (location) => READ_BY_ACO_AS_A_FIGURE.test(location) ? `~${location}` : location

const stageOf = (reviewer) => FINDING_STAGES.map(([pattern, name]) => pattern.test(reviewer) ? name ?? reviewer : null).find(Boolean)
const locationOf = (text) => neutralised(text.split(' ').map(pathAndLine).find(Boolean) ?? text)

// The findings of one history entry by location and stage, each with the number of findings that share them.
function findingsOfEntry(entry, stage) {
  const found = new Map()
  for (const where of entry.blocking) {
    const text = String(where).replace(/[\s;→]+/g, ' ').trim()
    const key = JSON.stringify([text, stage])
    found.set(key, { where: locationOf(text), stage, count: (found.get(key)?.count ?? 0) + 1 })
  }
  return found
}

// Distinct findings of one round that share a text each count; a finding that comes back in a later round counts once, as often as the most it was raised in one round.
function blockingStages(history) {
  const found = new Map()
  for (const entry of history) {
    const stage = Array.isArray(entry.blocking) ? stageOf(entry.by) : null
    if (!stage) continue
    findingsOfEntry(entry, stage).forEach((finding, key) => {
      if (finding.count > (found.get(key)?.count ?? 0)) found.set(key, finding)
    })
  }
  return [...found.values()]
}

const countParts = (count) => Array.from({ length: Math.ceil(count / COUNT_LIMIT) }, (_, part) => Math.min(COUNT_LIMIT, count - part * COUNT_LIMIT))
const printedEntry = (count, location, stage) => `${count > 1 ? `${count}× ` : ''}${location ? `${location} ` : ''}→ ${stage}`

// Findings that print the same shortened location and stage share one counted entry "<n>× <location> → <stage>".
function groupedEntries(findings, locationLength) {
  const groups = new Map()
  for (const { where, stage, count } of findings) {
    const location = where.slice(0, locationLength).trimEnd()
    const key = JSON.stringify([location, stage])
    groups.set(key, { location, stage, count: (groups.get(key)?.count ?? 0) + count })
  }
  return [...groups.values()].flatMap(({ location, stage, count }) => countParts(count).map(part => printedEntry(part, location, stage)))
}

// The longest locations whose grouped entries fit the room; when no location fits, one counted entry per stage word is all that is left.
function blockingText(findings, rest) {
  if (!findings.length) return 'none'
  const room = ROUTING_LINE_LIMIT - rest.length
  for (let locationLength = LOCATION_LIMIT; locationLength > 0; locationLength--) {
    const printed = groupedEntries(findings, locationLength).join('; ')
    if (printed.length <= room) return printed
  }
  return groupedEntries(findings, 0).join('; ')
}

const choiceOf = (role) => `${A.routing[role].model}/${A.routing[role].effort}`
const ran = (key) => A.history.some(entry => entry.by === key || entry.by?.startsWith(`${key}-`))
const gateRoleRun = () => [['standin', 'review'], ['gate', 'gate']].find(([key]) => ran(key))?.[1] ?? null
const choiceOrNone = (role) => role ? choiceOf(role) : 'none'

function stagesText() {
  const stages = [
    `build ${choiceOf('build')}`,
    `fix ${choiceOrNone(A.fixRole)}`,
    `review ${choiceOf('review')}`,
    `test ${choiceOrNone(ran('e2e') ? 'test' : null)}`,
    `gate ${choiceOrNone(gateRoleRun())}`,
    `land ${choiceOf('mechanical')}`,
  ]
  return stages.join('; ')
}

const rest = [`Routing: ${stagesText()}. Fix rounds: ${A.rounds}.`, A.experiment && ` Experiment: ${A.experiment}.`, ' Blocking: '].filter(Boolean).join('')
return rest + blockingText(blockingStages(A.history), rest)
