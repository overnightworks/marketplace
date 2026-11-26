// The finding and follow-up schemas every reviewer, tester and fixer answers in.
// A finding carries the rule it breaks and the evidence for it, so a fixer never acts on a bare assertion. Its kind
// decides what proves the fix: a defect's test fails before it, a test-gap's test fails under a named mutation.
const FINDING_KINDS = ['defect', 'test-gap', 'docs']
const FINDING = {
  type: 'object',
  required: ['where', 'kind', 'text', 'rule', 'evidence'],
  properties: {
    where: { type: 'string', description: 'file:line, or the check or scenario name' },
    kind: { type: 'string', enum: FINDING_KINDS, description: 'defect: the code breaks a rule or its promise; test-gap: a behaviour without a test, the code is right and only the test pinning it is missing; docs: only text is wrong' },
    text: { type: 'string' },
    rule: { type: 'string', description: 'the contract sentence, spec criterion, repository rule or check it breaks' },
    evidence: { type: 'string', description: 'what was observed: the code, the output, the failing log lines' },
    repro: { type: 'string', description: 'a command that shows it, when there is one' },
    testDraft: { type: 'string', description: 'path of a drafted failing test, when the finding can be automated stably' },
  },
}
const FOLLOWUP = {
  type: 'object',
  required: ['where', 'text', 'owner'],
  properties: {
    where: { type: 'string' }, text: { type: 'string' }, owner: { type: 'string', description: 'owning item #n, or "distributor"' },
    stage: { type: 'string', enum: FINDING_STAGE_NAMES, description: 'the stage that raised it; the lane sets it on every follow-up it reports' },
    inPlace: { type: 'boolean', description: `true when ${IN_PLACE_RULE}: the lane's fixer resolves it in place; the head's foldIn leaves it out, since naming a follow-up there counts as in place` },
  },
}
// A reviewer or tester must classify every follow-up it reports; the head's foldIn input check reads FOLLOWUP, which leaves inPlace out of its string fields.
const REPORTED_FOLLOWUP = { ...FOLLOWUP, required: [...FOLLOWUP.required, 'inPlace'] }
