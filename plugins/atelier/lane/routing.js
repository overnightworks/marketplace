// Prints the one Routing line of a lane from its routing table, its history and its fix rounds, and starts no agent.
export async function laneRouting(A) {
  // The Routing line aco reads (aco's specs/lane-record.spec.md owns the grammar), built from what the lane used; the head pastes it as is.
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

  const locationOf = (text) => neutralised(text.split(' ').map(pathAndLine).find(Boolean) ?? text)

  // The findings of the lane's history by location and stage, each with the number that share them (laneRecord's counting, with the location a Routing line prints).
  const blockingLocations = (history) => blockingStages(history).map(({ text, stage, count }) => ({ where: locationOf(text), stage, count }))

  const countParts = (count) => Array.from({ length: Math.ceil(count / COUNT_LIMIT) }, (_, part) => Math.min(COUNT_LIMIT, count - part * COUNT_LIMIT))
  const printedEntry = (count, location, stage) => {
    const times = count > 1 ? `${count}× ` : ''
    const place = location ? `${location} ` : ''
    return `${times}${place}→ ${stage}`
  }

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

  function stagesText() {
    const choices = stageChoices(A)
    return RECORD_STAGES.map(stage => `${stage} ${choices[stage]}`).join('; ')
  }

  const rest = [`Routing: ${stagesText()}. Fix rounds: ${A.rounds}.`, A.experiment && ` Experiment: ${A.experiment}.`, ' Blocking: '].filter(Boolean).join('')
  return rest + blockingText(blockingLocations(A.history), rest)
}
