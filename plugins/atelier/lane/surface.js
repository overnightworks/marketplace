// Design advice for a lane that changes a surface: nothing here blocks a landing. The count is what the scope check relays from `aco brief --json`
// (the length of touched_surfaces); it is undefined before the first check and null when the key is absent or malformed, which means unknown.
const DESIGN_SKILL = 'atelier:design-interface'
let surfaces
const noteSurfaces = (relayed) => { surfaces = Number.isInteger(relayed) ? relayed : null }
const surfaced = () => surfaces > 0

// The sentence the builder and the fixers are briefed with, leading space included, or nothing.
function surfaceFacts() {
  if (surfaces === undefined) return ` After each commit, until \`aco brief ${A.item} --json\` lists a path under touched_surfaces, check it; once it does, load the ${DESIGN_SKILL} skill before changing what a person sees there.`
  return surfaced() ? ` This lane changes a surface: load the ${DESIGN_SKILL} skill before changing what a person sees there.` : ''
}

// The tester's paragraph, opening with a line break, while the lane changes a surface.
const surfaceTesterFacts = () => !surfaced() ? '' : `\nThis lane changes a surface. Only after every cell is judged, capture each changed view in a real browser at the two widths the ${DESIGN_SKILL} skill names (the repository's own UI rules may name others) and judge it against that skill. ` +
  `Bound each capture on its own; a capture never decides a cell or the run's exit. Run it inside your probe-run drive, or in a probe-run of its own when no live drive runs, on an instance you start from ${A.worktree}, never the operator's live stack. ` +
  `Report it in design: capture is captured, test-only (every touched surface path is a test or fixture file) or gap (with a note); each observation is advice for a person, never a blocking finding.`

const DESIGN_RESULT = {
  type: 'object', required: ['capture'], description: 'only when the lane changes a surface',
  properties: {
    capture: { type: 'string', enum: ['captured', 'test-only', 'gap'] }, note: { type: 'string', description: 'why a capture is a gap' },
    observations: { type: 'array', items: { type: 'object', required: ['where', 'text'], properties: { where: { type: 'string', description: 'the view and width' }, text: { type: 'string' } } } },
  },
}

// The tester's history entry and follow-ups for its design report; a surface lane that reports none is recorded as not reported, and no observation is ever in place or blocking.
function designRecord(answer, onSurface, tip) {
  if (!onSurface) return { entry: {}, followups: [] }
  const { capture = 'not reported', note, observations = [] } = answer.design || {}
  return { entry: { design: { capture, ...(note && { note }) } }, followups: observations.map(o => ({ where: o.where, text: o.text, owner: 'distributor', inPlace: false, stage: 'test', tip })) }
}
