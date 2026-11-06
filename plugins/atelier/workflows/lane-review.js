export const meta = {
  name: 'lane-review',
  description: 'Internal to the lane workflow, never started by a head: runs every reviewer of one review round (a fresh Claude reviewer, a Codex courier) in parallel and returns their results with the round verdict.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_REVIEW_PROTOCOL = 2
const A = args || {}
const need = ['protocol', 'item', 'pr', 'delegatedLine', 'worktree', 'branch', 'scratch', 'tag', 'label', 'range', 'contract', 'blockingLine', 'reviewers', 'findingKinds', 'finding', 'followup', 'mechanical']
if (A.protocol !== LANE_REVIEW_PROTOCOL) return { refused: `lane-review speaks protocol ${JSON.stringify(LANE_REVIEW_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const MECHANICAL = A.mechanical
const FINDING_KINDS = A.findingKinds
const R = A.repo ? ` -R ${A.repo}` : ''

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

const VERDICT = {
  type: 'object',
  required: ['verdict', 'blocking', 'followups'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'architectural', 'failed'] },
    blocking: { type: 'array', items: A.finding },
    followups: { type: 'array', items: A.followup },
    reportPath: { type: 'string' },
    note: { type: 'string' },
    codexExit: { type: 'number', description: 'the exit status Codex wrote to the marker file (couriers only)' },
  },
}
// The phrase Codex prints when the account is out of usage (typographic apostrophe in "You’ve", so the match starts after it).
const USAGE_LIMIT = 'hit your usage limit'
const LIMIT = {
  type: 'object',
  required: ['line', 'resetsAt'],
  properties: { line: { type: 'string' }, resetsAt: { type: ['string', 'null'] } },
}
const COURIER_VERDICT = {
  ...VERDICT,
  required: [...VERDICT.required, 'codexExit'],
  properties: { ...VERDICT.properties, limit: LIMIT },
}

// The reviewer stopgap of the fleet roadmap (#80, Q0): the reviewer is the only brake until a ratchet checks these.
const STOPGAP_LINE =
  `Refuse (blocking defect) a new file of 800 lines or more; a new test whose name does not state the behaviour it pins; ` +
  `and a new patch or monkeypatch at an import location or on a private attribute where a fake on PATH or an injected port works.`


// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent agent);
// a fresh Sonnet reviewer is the default. The final gate on a material lane must come from another provider than the
// Claude builder, so it runs on Codex through a courier.
function reviewerBrief(role, range) {
  return `You are the ${role} for work item #${A.item}: a fresh, independent reviewer who did not write this change. ` +
    `Contract:\n${A.contract}\n\nReview ${range}.\n\n${A.blockingLine}\n\n${STOPGAP_LINE}\n\n` +
    `verdict is APPROVE with no blocking findings, REVISE with at least one, or architectural when the cut itself is wrong.`
}

function claudeReview(label, routing, role, range) {
  return safeAgent(
    `${A.delegatedLine}\nWork read-only in ${A.worktree} on branch ${A.branch}: read files and run read-only commands freely; do not run tests and do not edit anything.\n` +
    `Before judging, read the current item body (gh issue view ${A.item}${R} --json body --jq .body) and the pull request body (gh pr view ${A.pr}${R} --json body --jq .body): the contract core and the verification evidence.\n` + reviewerBrief(role, range),
    { label, phase: 'Review', schema: VERDICT, agentType: 'atelier:code-reviewer', ...routing })
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
    `${A.delegatedLine}\nYou are a courier re-reading a finished Codex review. Do not start Codex, do not review anything yourself and do not edit anything.\n` +
    `Read ${base}-out.json.exit and ${base}-out.json. If the exit status is 0 and the file is valid JSON, copy its verdict, blocking and followups verbatim into the StructuredOutput call, with reportPath ${base}-out.json and codexExit 0. ` +
    `Otherwise return verdict failed with the exit status in codexExit (-1 when there is no marker) and the reason in note.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label: `${label}-reread`, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
  // A re-read that fails again still points at the report the first courier named.
  return rereading.then(v => (v?.verdict === 'failed' && !v.reportPath && answer.reportPath) ? { ...v, reportPath: answer.reportPath } : v)
}

function codexReview(label, routing, role, range) {
  const base = `${A.scratch}/${A.tag}-${label}`
  const appendBodies = String.raw`{ cat ${base}-brief.md && printf '\n\n-----\nThe current item body (gh issue view):\n' && gh issue view ${A.item}${R} --json body --jq .body && printf '\n\n-----\nThe current pull request body (gh pr view):\n' && gh pr view ${A.pr}${R} --json body --jq .body; } > ${base}-brief.md.tmp && mv ${base}-brief.md.tmp ${base}-brief.md`
  const brief = `${A.delegatedLine}\nRead-only sandbox: read files and run read-only commands freely; do not run tests. The item body and the pull request body follow this brief: they are the contract core and the verification evidence. The sandbox has no network and cannot write, /tmp included; report a command you cannot run as not verified, never as a blocking finding.\n` + reviewerBrief(role, range) +
    `\nGive every finding its file:line in "where".`
  return safeAgent(
    `${A.delegatedLine}\nYou are a courier for one independent Codex review. Do not review anything yourself and do not edit the repository.\n` +
    `1. rm -f ${base}-out.json ${base}-out.json.exit ${base}-out.json.exit.tmp ${base}-brief.md.tmp ${base}-run.log\n` +
    `2. Write this brief verbatim to ${base}-brief.md:\n-----\n${brief}\n-----\n` +
    `3. Write this JSON schema verbatim to ${base}-schema.json:\n${CODEX_SCHEMA}\n` +
    `4. Append the current item body and pull request body to the brief and start Codex detached, recording its exit status in a marker file, with this one shell command line, exactly as written, never retyped from memory, split or summarised. Codex starts only if the append succeeded. If the line exits non-zero, Codex did not start: return verdict failed with codexExit -1 and the error in note.\n` +
    `   ${appendBodies} && cd ${A.worktree} && { setsid nohup bash -c 'codex exec -s read-only -C ${A.worktree} -m ${routing.model} -c model_reasoning_effort=${routing.effort} --output-schema ${base}-schema.json -o ${base}-out.json - < ${base}-brief.md; echo $? > ${base}-out.json.exit.tmp && mv ${base}-out.json.exit.tmp ${base}-out.json.exit' > ${base}-run.log 2>&1 & }\n` +
    `5. Wait in the foreground — you cannot be woken later, your task ends when you answer. Run this Bash command (timeout 600000 ms) and repeat it until the marker exists, at most 7 times:\n` +
    `   timeout 540 bash -c 'until [ -f ${base}-out.json.exit ]; do sleep 30; done'; ls ${base}-out.json.exit\n` +
    `   Never answer before the marker exists or the 7 waits are spent. Never return a placeholder or a pending result.\n` +
    `6. If ${base}-run.log says the model is at capacity, wait 5 minutes and start again from step 1, once, with the same model. Never switch models: a gate stays on its model. Never retry a usage limit (step 7).\n` +
    `7. Decide by the exit status first. If ${base}-out.json.exit holds 0 and ${base}-out.json is valid JSON, return its verdict, blocking and followups UNCHANGED, ` +
    `reportPath ${base}-out.json and codexExit 0: APPROVE, REVISE and architectural are all valid review results, and a REVISE with blocking findings is never failed — the lane sends those findings to a fixer. Copy them verbatim from the out.json into the StructuredOutput call.\n` +
    `   Return verdict failed only when the 7 waits are spent without a marker (codexExit -1), the exit status is not 0 (codexExit = that number), or the file is missing or not valid JSON. ` +
    `Then give the last 20 lines of ${base}-run.log in note.\n` +
    `   When the exit status is above 0, also run: grep -v '^[[:space:]]*$' ${base}-run.log | tail -n 1\n` +
    `   Only that last non-empty line counts, because the log echoes the brief. If it contains "${USAGE_LIMIT}", Codex is out of usage: add limit to the answer, with line that line verbatim and resetsAt the text after "try again at" (any case) to the end of the line without a final period, or null when the line has none. Never wait for the reset and never retry a limit.\n${STRUCTURED_OUTPUT_ONLY_LINE}`,
    { label, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
    .then(v => rereadContradictoryCourier(v, label, base))
    .then(v => (v && v.codexExit !== 0 && v.verdict !== 'failed') ? { ...v, verdict: 'failed', note: `courier returned a verdict without a clean Codex exit (${v.codexExit}): ${v.note || ''}` } : v)
}

// A limit counts only as the reason of a failed Codex run that exited above 0; anywhere else it is a courier's mistake and dropped.
function guardLimit(answer, reviewer) {
  if (!answer?.limit) return answer
  const { limit, ...rest } = answer
  const guarded = answer.verdict === 'failed' && answer.codexExit > 0 && typeof limit.line === 'string' && limit.line.includes(USAGE_LIMIT)
  return guarded ? { ...rest, limit: { role: reviewer.key, model: reviewer.routing.model, line: limit.line, resetsAt: limit.resetsAt ?? null } } : rest
}

const reviewBy = (reviewer, range) => {
  const label = `${A.label}-${reviewer.key}`
  return reviewer.provider === 'codex'
    ? codexReview(label, reviewer.routing, reviewer.role, range).then(answer => guardLimit(answer, reviewer))
    : claudeReview(label, reviewer.routing, reviewer.role, range)
}

// One classifier for every review round: every started review must return, and verdict and findings must agree.
function classify(results, expected) {
  const got = results.filter(Boolean)
  if (got.length !== expected) return { state: 'failed', reason: `${expected - got.length} review(s) returned nothing` }
  if (got.some(v => v.verdict === 'failed' && !v.limit)) {
    const reportPaths = got.filter(v => v.verdict === 'failed' && v.reportPath).map(v => v.reportPath)
    return { state: 'failed', reason: got.map(v => v.note || '').join(' | ') + (reportPaths.length ? '; read the report ' + reportPaths.join(' and ') : '') }
  }
  if (got.some(v => v.verdict === 'architectural')) return { state: 'architectural' }
  // An evidenced blocking finding outranks its label (APPROVE with a finding counts as REVISE). A REVISE with nothing
  // to fix stays broken: that is how a courier's placeholder was caught.
  const emptyRevise = got.find(v => v.verdict === 'REVISE' && (v.blocking || []).length === 0)
  if (emptyRevise) {
    const readHint = emptyRevise.reportPath ? '; read the report ' + emptyRevise.reportPath : ''
    return { state: 'failed', reason: 'a REVISE verdict came without any blocking finding' + readHint }
  }
  if (got.some(v => v.limit)) return { state: 'limited' }
  return { state: got.some(v => (v.blocking || []).length > 0) ? 'revise' : 'approve' }
}

const results = await parallel(A.reviewers.map(reviewer => () => reviewBy(reviewer, A.range)))
return { results, verdict: classify(results, A.reviewers.length) }
