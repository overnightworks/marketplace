export const meta = {
  name: 'lane-codex',
  description: 'Internal to the lane workflow, never started by a head: runs one independent Codex review through a courier and returns its verdict.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_CODEX_PROTOCOL = 1
const A = args || {}
const need = ['protocol', 'worktree', 'scratch', 'tag', 'label', 'routing', 'reviewerBrief', 'findingKinds', 'verdictSchema', 'mechanical']
if (A.protocol !== LANE_CODEX_PROTOCOL) return { refused: `lane-codex speaks protocol ${JSON.stringify(LANE_CODEX_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const { label, routing } = A
const COURIER_VERDICT = A.verdictSchema
const MECHANICAL = A.mechanical
const FINDING_KINDS = A.findingKinds

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

const CODEX_SCHEMA = JSON.stringify({
  type: 'object', additionalProperties: false,
  required: ['verdict', 'blocking', 'followups', 'checked_correct'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'architectural'] },
    blocking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'kind', 'text', 'rule', 'evidence'],
      properties: { where: { type: 'string' }, kind: { type: 'string', enum: FINDING_KINDS }, text: { type: 'string' }, rule: { type: 'string' }, evidence: { type: 'string' } } } },
    followups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'text', 'owner'],
      properties: { where: { type: 'string' }, text: { type: 'string' }, owner: { type: 'string' } } } },
    checked_correct: { type: 'string' },
  },
})

const STRUCTURED_OUTPUT_ONLY_LINE = `Your only final action is the StructuredOutput call; never write a text answer first.`

// A courier that reports failed, or a REVISE without a finding, beside a clean Codex exit contradicts itself; one read-only courier reads the same files again.
function rereadContradictoryCourier(answer, label, base) {
  const emptyRevise = answer?.verdict === 'REVISE' && (answer.blocking || []).length === 0
  if (!((answer?.verdict === 'failed' || emptyRevise) && answer.codexExit === 0)) return answer
  const rereading = safeAgent(
    `You are a courier re-reading a finished Codex review. Do not start Codex, do not review anything yourself and do not edit anything.\n` +
    `Read ${base}-out.json.exit and ${base}-out.json. If the exit status is 0 and the file is valid JSON, copy its verdict, blocking and followups verbatim into the StructuredOutput call, with reportPath ${base}-out.json and codexExit 0. ` +
    `Otherwise return verdict failed with the exit status in codexExit (-1 when there is no marker) and the reason in note.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label: `${label}-reread`, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
  // A re-read that fails again still points at the report the first courier named.
  return rereading.then(v => (v?.verdict === 'failed' && !v.reportPath && answer.reportPath) ? { ...v, reportPath: answer.reportPath } : v)
}

function codexReview() {
  const base = `${A.scratch}/${A.tag}-${label}`
  const brief = `Read-only sandbox: read files and run read-only commands freely; do not run tests. The sandbox has no network and cannot write, /tmp included; report a command you cannot run as not verified, never as a blocking finding.\n` + A.reviewerBrief +
    `\nGive every finding its file:line in "where".`
  return safeAgent(
    `You are a courier for one independent Codex review. Do not review anything yourself and do not edit the repository.\n` +
    `1. rm -f ${base}-out.json ${base}-out.json.exit ${base}-out.json.exit.tmp\n` +
    `2. Write this brief verbatim to ${base}-brief.md:\n-----\n${brief}\n-----\n` +
    `3. Write this JSON schema verbatim to ${base}-schema.json:\n${CODEX_SCHEMA}\n` +
    `4. Start Codex detached, recording its exit status in a marker file:\n` +
    `   cd ${A.worktree} && setsid nohup bash -c 'codex exec -s read-only -C ${A.worktree} -m ${routing.model} -c model_reasoning_effort=${routing.effort} --output-schema ${base}-schema.json -o ${base}-out.json - < ${base}-brief.md; echo $? > ${base}-out.json.exit.tmp && mv ${base}-out.json.exit.tmp ${base}-out.json.exit' > ${base}-run.log 2>&1 &\n` +
    `5. Wait in the foreground — you cannot be woken later, your task ends when you answer. Run this Bash command (timeout 600000 ms) and repeat it until the marker exists, at most 7 times:\n` +
    `   timeout 540 bash -c 'until [ -f ${base}-out.json.exit ]; do sleep 30; done'; ls ${base}-out.json.exit\n` +
    `   Never answer before the marker exists or the 7 waits are spent. Never return a placeholder or a pending result.\n` +
    `6. If ${base}-run.log says the model is at capacity, wait 5 minutes and start again from step 1, once, with the same model. Never switch models: a gate stays on its model.\n` +
    `7. Decide by the exit status first. If ${base}-out.json.exit holds 0 and ${base}-out.json is valid JSON, return its verdict, blocking and followups UNCHANGED, ` +
    `reportPath ${base}-out.json and codexExit 0: APPROVE, REVISE and architectural are all valid review results, and a REVISE with blocking findings is never failed — the lane sends those findings to a fixer. Copy them verbatim from the out.json into the StructuredOutput call.\n` +
    `   Return verdict failed only when the 7 waits are spent without a marker (codexExit -1), the exit status is not 0 (codexExit = that number), or the file is missing or not valid JSON. ` +
    `Then give the last 20 lines of ${base}-run.log in note.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
    .then(v => rereadContradictoryCourier(v, label, base))
    .then(v => (v && v.codexExit !== 0 && v.verdict !== 'failed') ? { ...v, verdict: 'failed', note: `courier returned a verdict without a clean Codex exit (${v.codexExit}): ${v.note || ''}` } : v)
}

return codexReview()
