
export const meta = {
  name: 'lane-relay',
  description: 'Internal to the lane workflow, never started by a head: runs one printer command through an agent and returns the answer of the agent together with the CRC-checked values of the line it relays.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_RELAY_PROTOCOL = 2
const A = args || {}
const need = ['protocol', 'worktree', 'label', 'phase', 'brief', 'step', 'relayArgs', 'nonce', 'requiredKeys', 'agentOptions']
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
if (A.protocol !== LANE_RELAY_PROTOCOL) return { refused: `lane-relay speaks protocol ${JSON.stringify(LANE_RELAY_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const { label, phase: phaseName, brief, step, relayArgs, nonce, requiredKeys, agentOptions, answerSchema = {} } = A

// agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
async function safeAgent(prompt, opts) {
  try {
    return await agent(prompt, opts)
  } catch (error) {
    log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
    return null
  }
}

// A value a command prints reaches a decision only through one line the PRINTER wrote: the agent runs it and relays the
// line unchanged, and a retyped or edited line fails its CRC32. The printer holds no single quote, so the shell passes
// it as one argument. Its first argument names the step whose commands it runs; the scope step never forces a push and
// relays at most 50 paths, and the sync step reports the lane tip, its parents and whether it contains origin/main.
const PRINTER = [
  'import json,shutil,subprocess,sys,zlib',
  'step,*rest,nonce=sys.argv[1:]',
  'run=lambda*c:subprocess.run(c,capture_output=True,text=True) if shutil.which(c[0]) else subprocess.CompletedProcess(c,127,"","not found: "+c[0])',
  'steps=dict(scope=lambda item,branch:(("push",("git","push","origin",branch)),("remote",("git","rev-parse","origin/"+branch)),("head",("git","rev-parse","HEAD")),("brief",("aco","brief",item,"--json"))),sync=lambda:(("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("main",("git","merge-base","--is-ancestor","origin/main","HEAD"))))',
  'ran={n:run(*c) for n,c in steps[step](*rest)}',
  'claim=json.loads(ran["brief"].stdout)["outside_claim"] if "brief" in ran and ran["brief"].returncode==0 else None',
  'values={n:{"code":p.returncode,"err":" ".join(l for l in p.stderr.splitlines() if l[:5]!="hint:")[-300:],"out":p.stdout.strip()[:100]} for n,p in ran.items()}',
  'values.update(nonce=nonce,**(dict(outside_claim=claim[:50] if isinstance(claim,list) else claim,count=len(claim) if isinstance(claim,list) else None) if "brief" in ran else {}))',
  'payload=json.dumps(values,ensure_ascii=True,separators=(",",":"),sort_keys=True)',
  'print("""{"crc":"%08x","v":%s}"""%(zlib.crc32(payload.encode()),payload))',
].join(';')
const relayCommand = (...relayArgs) => `cd '${A.worktree}' && python3 -c '${PRINTER}' ${relayArgs.join(' ')}`
const RELAY_ASK = 'run this one command line exactly as written, without changing it or its directory, and return the line it prints unchanged as printed; when it prints no line, return its error output as printed:'
const RELAY_LINE = /^\{"crc":"([0-9a-f]{8})","v":(.*)\}$/
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
const crc32 = (text) => {
  let crc = 0xffffffff
  for (let i = 0; i < text.length; i++) crc = CRC_TABLE[(crc ^ text.codePointAt(i)) & 255] ^ (crc >>> 8)
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}
const PRINTED = { type: 'string', description: 'the one line the command printed, character for character as printed; when it printed no line, its error output' }

// The values of a relay line, or why the line cannot be trusted: checked as text first (shape, CRC32), parsed after.
// A caller stops at the stage of the step that ran the printer, so an unreadable scope line stops at scope, because it
// proves nothing about the push; push is only for a readable line that shows the push failed or the remote lacks the tip.
function readRelay(printed, nonce, requiredKeys = []) {
  const match = RELAY_LINE.exec((printed || '').trim())
  if (!match) return { problem: 'is not a relay line' }
  if (crc32(match[2]) !== match[1]) return { problem: 'fails its CRC check' }
  let values
  try { values = JSON.parse(match[2]) } catch { return { problem: 'does not hold JSON' } }
  if (values?.nonce !== nonce) return { problem: `carries the nonce ${values?.nonce}, not ${nonce}` }
  const missing = requiredKeys.find(key => !values[key])
  if (missing) return { problem: `lacks the ${missing} entry` }
  return { values }
}

const answer = await safeAgent(`${brief} ${RELAY_ASK}\n${relayCommand(step, ...relayArgs)}`, {
  label, phase: phaseName,
  schema: { type: 'object', required: ['printed', ...(answerSchema.required || [])], properties: { printed: PRINTED, ...answerSchema.properties } },
  ...agentOptions,
})
if (!answer) return null
return { ...answer, ...readRelay(answer.printed, nonce, requiredKeys) }
