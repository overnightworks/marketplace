
export const meta = {
  name: 'lane-relay',
  description: 'Internal to the lane workflow, never started by a head: runs one printer command through an agent and returns the answer of the agent together with the CRC-checked values of the line it relays.',
}

// Both copies of this number (here and in lane.js) change together in any commit that changes the args or the return shape.
const LANE_RELAY_PROTOCOL = 7
const A = args || {}
const need = ['protocol', 'delegatedLine', 'worktree', 'label', 'phase', 'brief', 'step', 'relayArgs', 'nonce', 'requiredKeys', 'agentOptions', 'mechanical']
if (A.protocol !== LANE_RELAY_PROTOCOL) return { refused: `lane-relay speaks protocol ${JSON.stringify(LANE_RELAY_PROTOCOL)}, but the lane that started it speaks protocol ${JSON.stringify(A.protocol)}; the installed atelier differs from the running lane` }
const missing = need.filter(key => A[key] === undefined || A[key] === null || A[key] === '')
if (missing.length) return { refused: `missing args: ${missing.join(', ')}` }
const { label, phase: phaseName, brief, step, relayArgs, nonce, requiredKeys, agentOptions, mechanical, answerSchema = {} } = A

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
// it as one argument. Its first argument names the step whose commands it runs; the scope step never forces a push,
// relays HEAD's parents and whether its second parent is in origin/main, at most 50 paths and no text of aco brief but its exit code and error output, the sync step reports the lane tip, its parents and whether it contains origin/main, and the ci step reports the pull request head, the check listing, the required contexts of the base with the exit code of each gh call, and the checks red on head that failed on the base tip too; a failed gh pr view ends its reads.
const PRINTER = [
  'import json,shutil,subprocess,sys,zlib',
  'step,*rest,nonce=sys.argv[1:]',
  'run=lambda*c:subprocess.run(c,capture_output=True,text=True) if shutil.which(c[0]) else subprocess.CompletedProcess(c,127,"","not found: "+c[0])',
  'target=lambda repo:("-R",repo) if repo else ()',
  'api=lambda repo:"repos/"+(repo or "{owner}/{repo}")',
  'base=lambda r:json.loads(r["view"].stdout)["baseRefName"]',
  'steps=dict(scope=lambda item,branch:(("push",("git","push","origin",branch)),("remote",("git","rev-parse","origin/"+branch)),("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("second_parent_in_main",("git","merge-base","--is-ancestor","HEAD^2","origin/main")),("brief",("aco","brief",item,"--json"))),sync=lambda:(("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("main",("git","merge-base","--is-ancestor","origin/main","HEAD"))),ci=lambda pr,repo:(("view",("gh","pr","view",pr,"--json","headRefOid,baseRefName",*target(repo))),("checks",("gh","pr","checks",pr,"--json","name,bucket",*target(repo))),("rules",lambda r:("gh","api",api(repo)+"/rules/branches/"+base(r))),("runs",lambda r:("gh","api",api(repo)+"/commits/"+base(r)+"/check-runs","--paginate","--slurp"))))',
  'ran={}',
  '[ran.__setitem__(n,run(*(c(ran) if callable(c) else c))) for n,c in steps[step](*rest) if "view" not in ran or ran["view"].returncode==0]',
  'brief=json.loads(ran["brief"].stdout) if "brief" in ran and ran["brief"].returncode==0 else None',
  'shared=[] if brief is None or brief.get("claim",{}).get("lane_shared_unavailable") else [e["path"] for e in brief.get("claim",{}).get("lane_shared",[]) if e["names_a_file"]]',
  'claim=[p for p in brief["outside_claim"] if p not in shared] if brief and isinstance(brief["outside_claim"],list) else brief and brief["outside_claim"]',
  'values={n:{"code":p.returncode,"err":" ".join(l for l in p.stderr.splitlines() if l[:5]!="hint:")[-300:],**({} if n in("brief","view","checks","rules","runs") else {"out":p.stdout.strip()[:100]})} for n,p in ran.items()}',
  'parsed=lambda n:json.loads(ran[n].stdout) if n in ran and ran[n].returncode==0 else None',
  'view,listing,rules,pages=parsed("view"),parsed("checks"),parsed("rules"),parsed("runs")',
  'listing=listing and sorted(listing,key=lambda c:(c["name"],c["bucket"]))',
  'failed_on_base={r["name"] for page in pages or [] for r in page["check_runs"] if r["conclusion"]=="failure"}',
  'values.update({n:{**values[n],k:v} for n,k,v in(("checks","list",listing),("rules","contexts",None if rules is None else [c["context"] for r in rules if r["type"]=="required_status_checks" for c in r["parameters"]["required_status_checks"]])) if v is not None})',
  'values.update(**(dict(head=view["headRefOid"],shared=[c["name"] for c in listing or [] if c["bucket"]=="fail" and c["name"] in failed_on_base]) if view else {}))',
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
// The printer sorts checks.list by name and bucket, because the order of the listing decides nothing and a model that
// tidies it must not fail the check: a mismatching line is read again with the list in the printer's order, in the printer's JSON form.
const compareText = (a, b) => Number(a > b) - Number(a < b)
const sortedListing = (values) => {
  const list = values?.checks?.list
  if (!Array.isArray(list)) return values
  const byNameThenBucket = (a, b) => compareText(a?.name, b?.name) || compareText(a?.bucket, b?.bucket)
  return { ...values, checks: { ...values.checks, list: [...list].sort(byNameThenBucket) } }
}
const printerPair = (value, key) => printerText(key) + ':' + printerText(value[key])
const printerText = (value) => {
  if (Array.isArray(value)) return `[${value.map(printerText).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort(compareText).map(key => printerPair(value, key)).join(',')}}`
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, ch => String.raw`\u` + ch.codePointAt(0).toString(16).padStart(4, '0'))
}
const PRINTED = { type: 'string', description: 'the one line the command printed, character for character as printed; when it printed no line, its error output' }

// The values of a relay line, or why the line cannot be trusted: checked as text first (shape, CRC32), parsed after.
// A caller stops at the stage of the step that ran the printer, so an unreadable scope line stops at scope, because it
// proves nothing about the push; push is only for a readable line that shows the push failed or the remote lacks the tip.
function readRelay(printed, nonce, requiredKeys = []) {
  const match = RELAY_LINE.exec((printed || '').trim())
  if (!match) return { problem: 'is not a relay line' }
  let values
  try { values = JSON.parse(match[2]) } catch { return crc32(match[2]) === match[1] ? { problem: 'does not hold JSON' } : { problem: 'fails its CRC check' } }
  if (crc32(match[2]) !== match[1] && crc32(printerText(sortedListing(values))) !== match[1]) return { problem: 'fails its CRC check' }
  if (values?.nonce !== nonce) return { problem: `carries the nonce ${values?.nonce}, not ${nonce}` }
  const missing = requiredKeys.find(key => !values[key])
  if (missing) return { problem: `lacks the ${missing} entry` }
  return { values }
}

const answer = await safeAgent(`${A.delegatedLine}\n${brief} ${RELAY_ASK}\n${relayCommand(step, ...relayArgs)}`, {
  label, phase: phaseName,
  schema: { type: 'object', required: ['printed', ...(answerSchema.required || [])], properties: { printed: PRINTED, ...answerSchema.properties } },
  ...agentOptions,
})
if (!answer) return null
const read = readRelay(answer.printed, nonce, requiredKeys)
if (!read.problem) return { ...answer, ...read }

// An agent that copied the line badly is asked once more, by an agent that only runs the printer: the printer reads the state that is there now, and the CRC and the nonce still guard the second line.
log(`${label} relayed an unreadable line (${read.problem}); reading it once more: ${String(answer.printed).slice(0, 300)}`)
const second = await safeAgent(`${A.delegatedLine}\n${RELAY_ASK}\n${relayCommand(step, ...relayArgs)}`, {
  label: `${label}-reread`, phase: phaseName,
  schema: { type: 'object', required: ['printed'], properties: { printed: PRINTED } },
  ...mechanical,
})
const secondRead = second ? readRelay(second.printed, nonce, requiredKeys) : read
return secondRead.problem ? { ...answer, ...read } : { ...answer, printed: second.printed, ...secondRead }
