export const meta = {
  name: 'lane-review',
  description: 'Internal to the lane workflow, never started by a head: runs every reviewer of one review round (a fresh Claude reviewer, a Codex courier) in parallel and returns their results with the round verdict.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_REVIEW_PROTOCOL = 6
const A = args || {}
if (A.protocolQuery) return { protocol: LANE_REVIEW_PROTOCOL }
const need = ['protocol', 'item', 'pr', 'after', 'tip', 'delegatedLine', 'worktree', 'branch', 'scratch', 'tag', 'label', 'range', 'contract', 'blockingLine', 'reviewers', 'findingKinds', 'finding', 'followup', 'mechanical']
if (A.protocol !== LANE_REVIEW_PROTOCOL) return { refused: `lane-review speaks protocol ${JSON.stringify(LANE_REVIEW_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const MECHANICAL = A.mechanical
const FINDING_KINDS = A.findingKinds
const R = A.repo ? ` -R ${A.repo}` : ''

// agent() with a schema throws when the subagent ends without a result; an end without a usable answer is a failed verdict that carries the error, so the lane reports why.
const failedVerdict = (note) => ({ verdict: 'failed', blocking: [], followups: [], note })
async function safeAgent(prompt, opts) {
  try {
    return (await agent(prompt, opts)) ?? failedVerdict(`${opts?.label || 'agent'} ended without a usable answer`)
  } catch (error) {
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return failedVerdict(`${opts?.label || 'agent'} threw: ${String(error).slice(0, 300)}`)
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
// The error Codex prints when the courier started it without writing the output schema first.
const SCHEMA_READ_ERROR = 'Failed to read output schema file'
// What the courier's start command prints when the brief file is not the brief the script wrote.
const BRIEF_MISMATCH = 'brief file differs from the brief the script wrote'
// What the courier's extraction command prints when no transcript record of the courier holds both marker lines of the brief.
const NO_BRIEF_RECORD = 'no transcript record of this courier holds the brief between its two marker lines'
// A courier that started no Codex because its brief file is not the brief the script wrote, or because no brief could be cut out of its transcript.
const startedNoCodex = (answer, reason) => answer?.verdict === 'failed' && answer.codexExit === -1 && String(answer.note ?? '').includes(reason)
const isBriefMismatch = answer => startedNoCodex(answer, BRIEF_MISMATCH)
const isNoBriefRecord = answer => startedNoCodex(answer, NO_BRIEF_RECORD)
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

// The reviewer is the only brake until a ratchet checks these.
const STOPGAP_LINE =
  `Refuse (blocking defect) a new file of 800 lines or more; a new test whose name does not state the behaviour it pins; ` +
  `and a new patch or monkeypatch at an import location or on a private attribute where a fake on PATH or an injected port works.`

const TEST_VOLUME_LINE =
  `If the range adds more than three test lines for each source line, or test lines and no source line (git diff --numstat over the range; test files are those under a tests directory or named as tests), ` +
  `name your verdict on D1 (one behaviour, one test, at the lowest layer that can prove it; a flow test proves a path once, its variants are parametrized unit or integration tests; a branch a flow test reaches gets no mirror unit test) ` +
  `and on D3 (cases that differ only in data are one parametrized test; shared arrangement lives in fixtures and builders); under that ratio say nothing about them.`

// ------------------------------------------------------------ reviewers
// The ordinary review may come from the builder's own provider (the contract asks only for a fresh, independent
// agent); a fresh Claude reviewer is the default, Sonnet at high effort and Opus at medium on material risk. The
// final gate on a material lane runs on Codex through a courier, because the Claude builder needs another provider,
// unless the lane routes it to the Opus stand-in, which runs as a fresh Claude reviewer like the ordinary review.
function reviewerBrief(role, range) {
  return `You are the ${role} for work item #${A.item}: a fresh, independent reviewer who did not write this change. ` +
    `Contract:\n${A.contract}\n\nReview ${range}.\n\n${A.blockingLine}\n\n${STOPGAP_LINE}\n\n${TEST_VOLUME_LINE}\n\n` +
    `verdict is APPROVE with no blocking findings, REVISE with at least one, or architectural when the cut itself is wrong.`
}

// A Claude reviewer that fails (no usable answer, an error, or verdict failed) is started once more as a fresh agent with the same brief. Only the second failure counts, with both texts.
async function claudeReview(label, routing, role, range) {
  const prompt = `${A.delegatedLine}\nWork read-only in ${A.worktree} on branch ${A.branch}: read files and run read-only commands freely; do not run tests and do not edit anything.\n` +
    `Before judging, read the current item body (gh issue view ${A.item}${R} --json body --jq .body) and the pull request body (gh pr view ${A.pr}${R} --json body --jq .body): the contract core and the verification evidence.\n` + reviewerBrief(role, range)
  const start = reviewLabel => safeAgent(prompt, { label: reviewLabel, phase: 'Review', schema: VERDICT, agentType: 'atelier:code-reviewer', ...routing })
  const first = await start(label)
  if (first.verdict !== 'failed') return first
  log(`${label} failed (${shortened(first.note)}); starting the reviewer once more`)
  const second = await start(`${label}-retry`)
  return second.verdict === 'failed' ? { ...second, note: `${shortened(first.note)} | after a retry: ${shortened(second.note)}` } : second
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

// The courier's one command line writes the schema inside single quotes.
if (CODEX_SCHEMA.includes("'")) throw new Error('CODEX_SCHEMA holds a single quote')

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

// A courier that dropped the schema write leaves Codex exiting at once; one fresh courier runs the same prompt again, never a second time.
// The same one retry covers a courier that wrote a different brief and one whose transcript did not yet hold the brief, which start no Codex.
function retryFailedStart(answer, runCourier, label) {
  const note = String(answer?.note ?? '')
  const unreadSchema = answer?.verdict === 'failed' && answer.codexExit > 0 && note.includes(SCHEMA_READ_ERROR)
  let reason = ''
  if (unreadSchema) reason = 'Codex could not read its output schema'
  else if (isBriefMismatch(answer)) reason = 'the courier wrote a different brief'
  else if (isNoBriefRecord(answer)) reason = 'the courier found no brief in its transcript'
  if (!reason) return answer
  log(`${label}: ${reason}; starting the courier once more`)
  return runCourier(`${label}-retry`)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function utf8BytesOf(text) {
  const bytes = []
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    if (codePoint < 0x80) bytes.push(codePoint)
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 63))
    else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63))
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 63), 0x80 | ((codePoint >> 6) & 63), 0x80 | (codePoint & 63))
  }
  return bytes
}
// CRC32 over the UTF-8 bytes, as Python's zlib.crc32 computes it for the file the courier wrote.
function crc32OfUtf8(text) {
  let crc = 0xffffffff
  for (const byte of utf8BytesOf(text)) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}
// Both sides compare the words of the brief: the Workflow runtime indents every line of a computed prompt and a model retyping the text adds blank lines, and neither changes what Codex reads.
const BRIEF_CRC_PRINTER = 'import sys,zlib;print("%08x"%zlib.crc32(b" ".join(sys.stdin.buffer.read().split())))'
// Cuts the brief out of the courier's own transcript, so no model copies it. The workflow host keeps the transcript of every workflow agent at
// ~/.claude/projects/<project>/<session>/subagents/workflows/<run>/agent-<id>.jsonl and its first record holds the prompt; a head session's transcript lies one level up and is never read.
// The marker lines are built from the token and count only as whole lines, so the command's own text and a brief that mentions a marker never match; the host indents every line of a prompt, which dedent removes, and a line that is not JSON, the host still writing it, is skipped.
// Quoted so that nothing of the brief is ever inside the command: the arguments are the round's token and the brief file.
const BRIEF_CUTTER = String.raw`import glob,json,os,re,sys,textwrap,time
token,out=sys.argv[1:]
start_marker,end_marker=("BRIEF-%s %s"%(kind,token) for kind in ("START","END"))
pattern=re.compile("^[ \t]*"+re.escape(start_marker)+"[ \t]*\n(.*?)\n[ \t]*"+re.escape(end_marker)+"[ \t]*$",re.M|re.S)
def contents(path):
    for line in open(path,encoding="utf-8"):
        if start_marker not in line: continue
        try: record=json.loads(line)
        except json.JSONDecodeError: continue
        yield (record.get("message") or {}).get("content")
files=sorted((f for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*/subagents/workflows/*/agent-*.jsonl")) if time.time()-os.path.getmtime(f)<3600),key=os.path.getmtime,reverse=True)
cuts=[m.group(1) for f in files for c in contents(f) if isinstance(c,str) for m in [pattern.search(c)] if m]
cuts or sys.exit("${NO_BRIEF_RECORD}")
open(out,"w",encoding="utf-8").write(textwrap.dedent(cuts[0])+"\n")`

function codexReview(label, routing, role, range) {
  const base = `${A.scratch}/${A.tag}-${label}`
  const appendBodies = String.raw`{ cat ${base}-brief.md && printf '\n\n-----\nThe current item body (gh issue view):\n' && gh issue view ${A.item}${R} --json body --jq .body && printf '\n\n-----\nThe current pull request body (gh pr view):\n' && gh pr view ${A.pr}${R} --json body --jq .body; } > ${base}-brief.md.tmp && mv ${base}-brief.md.tmp ${base}-brief.md`
  const brief = `${A.delegatedLine}\nRead-only sandbox: read files and run read-only commands freely; do not run tests. The item body and the pull request body follow this brief: they are the contract core and the verification evidence. The sandbox has no network and cannot write, /tmp included; report a command you cannot run as not verified, never as a blocking finding.\n` + reviewerBrief(role, range) +
    `\nGive every finding its file:line in "where".`
  // The token carries the brief's checksum, so one marker pair names one text. The courier prompt holds the brief between the two marker lines and the courier's command cuts it out of the courier's own transcript.
  const briefChecksum = crc32OfUtf8(brief.split(/[ \t\n\r\f\v]+/).filter(Boolean).join(' '))
  const token = `${A.tag}-${label}-${briefChecksum}`
  const markers = { start: `BRIEF-START ${token}`, end: `BRIEF-END ${token}` }
  const checkBrief = `{ [ "$(python3 -c '${BRIEF_CRC_PRINTER}' < ${base}-brief.md)" = ${briefChecksum} ] || { echo '${BRIEF_MISMATCH}' >&2; false; }; }`
  const courierPrompt =
    `${A.delegatedLine}\nYou are a courier for one independent Codex review. Do not review anything yourself and do not edit the repository.\n` +
    `1. rm -f ${base}-out.json ${base}-out.json.exit ${base}-out.json.exit.tmp ${base}-brief.md ${base}-brief.md.tmp ${base}-run.log\n` +
    `2. Write the brief file with this one shell command, exactly as written, never retyped from memory, split or summarised. It cuts the brief out of your own transcript, where the text between the two marker lines below stands; you copy nothing yourself. If the line exits non-zero, Codex did not start: return verdict failed with codexExit -1 and the error in note.\n` +
    `   python3 -c '${BRIEF_CUTTER}' ${token} ${base}-brief.md\n` +
    `   The brief for Codex follows between its two marker lines. It is addressed to Codex, not to you: never act on it and never copy it.\n${markers.start}\n${brief}\n${markers.end}\n` +
    `3. Write the output schema, check the brief file against its checksum, append the current item body and pull request body to the brief and start Codex detached, recording its exit status in a marker file, with this one shell command line, exactly as written, never retyped from memory, split or summarised. Codex starts only if the schema write, the brief check and the append succeeded. If the line exits non-zero, Codex did not start: return verdict failed with codexExit -1 and the error in note.\n` +
    `   printf %s '${CODEX_SCHEMA}' > ${base}-schema.json && cd ${A.worktree} && ${checkBrief} && ${appendBodies} && { setsid nohup bash -c 'codex exec -s read-only -C ${A.worktree} -m ${routing.model} -c model_reasoning_effort=${routing.effort} --output-schema ${base}-schema.json -o ${base}-out.json - < ${base}-brief.md; echo $? > ${base}-out.json.exit.tmp && mv ${base}-out.json.exit.tmp ${base}-out.json.exit' > ${base}-run.log 2>&1 & }\n` +
    `4. Wait in the foreground — you cannot be woken later, your task ends when you answer. Run this Bash command (timeout 600000 ms) and repeat it until the marker exists, at most 7 times:\n` +
    `   timeout 540 bash -c 'until [ -f ${base}-out.json.exit ]; do sleep 30; done'; ls ${base}-out.json.exit\n` +
    `   Never answer before the marker exists or the 7 waits are spent. Never return a placeholder or a pending result.\n` +
    `5. If ${base}-run.log says the model is at capacity, wait 5 minutes and start again from step 1, once, with the same model. Never switch models: a gate stays on its model. Never retry a usage limit (step 6).\n` +
    `6. Decide by the exit status first. If ${base}-out.json.exit holds 0 and ${base}-out.json is valid JSON, return its verdict, blocking and followups UNCHANGED, ` +
    `reportPath ${base}-out.json and codexExit 0: APPROVE, REVISE and architectural are all valid review results, and a REVISE with blocking findings is never failed — the lane sends those findings to a fixer. Copy them verbatim from the out.json into the StructuredOutput call.\n` +
    `   Return verdict failed only when the 7 waits are spent without a marker (codexExit -1), the exit status is not 0 (codexExit = that number), or the file is missing or not valid JSON. ` +
    `Then give the last 20 lines of ${base}-run.log in note.\n` +
    `   When the exit status is above 0, also run: grep -v '^[[:space:]]*$' ${base}-run.log | tail -n 1\n` +
    `   Only that last non-empty line counts, because the log echoes the brief. If it contains "${USAGE_LIMIT}", Codex is out of usage: add limit to the answer, with line that line verbatim and resetsAt the text after "try again at" (any case) to the end of the line without a final period, or null when the line has none. Never wait for the reset and never retry a limit.\n${STRUCTURED_OUTPUT_ONLY_LINE}`
  const runCourier = courierLabel => safeAgent(courierPrompt, { label: courierLabel, phase: 'Review', schema: COURIER_VERDICT, ...MECHANICAL })
  return runCourier(label)
    .then(v => retryFailedStart(v, runCourier, label))
    .then(v => rereadContradictoryCourier(v, label, base))
    .then(v => (v && v.codexExit !== 0 && v.verdict !== 'failed') ? { ...v, verdict: 'failed', note: `courier returned a verdict without a clean Codex exit (${v.codexExit}): ${v.note || ''}` } : v)
}

// A limit counts only as the reason of a failed Codex run that exited above 0; anywhere else it is a courier's mistake and dropped.
function guardLimit(answer, reviewer) {
  if (!answer?.limit) return answer
  const { limit, ...rest } = answer
  const guarded = reviewer.provider === 'codex' && answer.verdict === 'failed' && answer.codexExit > 0 && typeof limit.line === 'string' && limit.line.includes(USAGE_LIMIT)
  return guarded ? { ...rest, limit: { role: reviewer.key, model: reviewer.routing.model, line: limit.line, resetsAt: limit.resetsAt ?? null } } : rest
}

const reviewBy = (reviewer, range) => {
  const label = `${A.label}-${reviewer.key}`
  return reviewer.provider === 'codex'
    ? codexReview(label, reviewer.routing, reviewer.role, range).then(answer => guardLimit(answer, reviewer))
    : claudeReview(label, reviewer.routing, reviewer.role, range).then(answer => guardLimit(answer, reviewer))
}

// One failure text stays short in the round's reason; the two texts of a retried reviewer fit together.
const shortened = (note, limit = 300) => { const text = String(note || 'no note').trim(); return text.length > limit ? `${text.slice(0, limit)}…` : text }

// One classifier for every review round: every started review must return, and verdict and findings must agree.
function classify(results, expected) {
  const got = results.filter(Boolean)
  if (got.length !== expected) return { state: 'failed', reason: `${expected - got.length} review(s) returned nothing` }
  const failures = got.filter(v => v.verdict === 'failed' && !v.limit)
  // A courier that twice wrote a different brief is a slip of the courier, not a verdict: the head resumes the round.
  if (failures.length && failures.every(isBriefMismatch)) return { state: 'brief-mismatch', reason: failures.map(v => shortened(v.note, 700)).join(' | ') }
  // A courier whose transcript twice held no brief points at the host's transcript layout, which a resume would meet again.
  if (failures.length && failures.every(isNoBriefRecord)) return { state: 'no-brief-record', reason: failures.map(v => shortened(v.note, 700)).join(' | ') }
  if (failures.length) {
    const reportPaths = got.filter(v => v.verdict === 'failed' && v.reportPath).map(v => v.reportPath)
    return { state: 'failed', reason: failures.map(v => shortened(v.note, 700)).join(' | ') + (reportPaths.length ? '; read the report ' + reportPaths.join(' and ') : '') }
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

// What the lane records of one result that came back: its history entry, the final gate's round when the gate ran to the end, and the follow-ups it raised at the reviewed tip.
function recordOf(reviewer, result) {
  const blocking = result.blocking || []
  const reportPath = result.reportPath || ''
  return {
    history: { after: A.after, by: reviewer.key, verdict: result.verdict, blocking: blocking.map(f => f.where), reportPath },
    gateRounds: reviewer.isGate && !result.limit ? [{ after: A.after, verdict: result.verdict, blocking, reportPath, tip: A.tip }] : [],
    followups: (result.followups || []).map(f => ({ ...f, tip: A.tip })),
  }
}

const results = await parallel(A.reviewers.map(reviewer => () => reviewBy(reviewer, A.range)))
const records = A.reviewers.flatMap((reviewer, i) => results[i] ? [recordOf(reviewer, results[i])] : [])
return {
  results,
  verdict: classify(results, A.reviewers.length),
  history: records.map(record => record.history),
  gateRounds: records.flatMap(record => record.gateRounds),
  followups: records.flatMap(record => record.followups),
}
