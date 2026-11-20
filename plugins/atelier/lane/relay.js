// The one finding the lane writes when a builder ends without a result (checkpointOrFail) and a fixer reading it may find already met, and the title of the draft pull request its checkpoint opens.
const CHECKPOINT_FINDING_WHERE = 'the build brief'
const CHECKPOINT_TITLE_PREFIX = 'Unfinished checkpoint of #'
const checkpointTitle = (item) => `${CHECKPOINT_TITLE_PREFIX}${item}`
// A fixer's unchanged tip answers the checkpoint finding when it is the only finding and the fixer reports the brief met.
const checkpointMet = (fixed, blocking) => Boolean(fixed.briefMet) && blocking.length === 1 && blocking[0].where === CHECKPOINT_FINDING_WHERE
// Why the pull request keeps its checkpoint title, or null when it was renamed or never carried it; the printer's retitle step reads both titles and writes only on a match.
function checkpointRenameProblem(relayed, item) {
  if (!relayed || relayed.problem) return `the title step ${relayed ? relayed.problem : 'returned no result'}`
  if (relayed.unreachable) return relayed.unreachable
  const { title, item: itemTitle, retitle } = relayed.values
  if (title.code !== 0) return `reading the pull request title exited ${title.code}: ${title.err}`
  if (title.out !== checkpointTitle(item)) return null
  if (itemTitle.code !== 0) return `reading the item title exited ${itemTitle.code}: ${itemTitle.err}`
  return retitle.code === 0 ? null : `the title write exited ${retitle.code}: ${retitle.err}`
}
// Builds the briefs of the sync and fix steps and owns the schemas of their reports, runs one printer command through an agent and returns the answer of the agent together with the CRC-checked values of the line it relays; for the fix step it judges the fixer's answer against the findings and fold-ins it answered, and for the ci step it reads those values and splits the failing checks into own and shared.
export async function laneRelay(A) {
  const { label, phase: phaseName, step, relayArgs, nonce, requiredKeys, agentOptions, reread, before } = A

  // agent() with a schema throws when the subagent ends without a result; an end without one is a null the lane reports.
  async function safeAgent(prompt, opts) {
    try {
      return await agent(prompt, opts)
    } catch (error) {
      rethrowClaudeUsageLimit(error)
      log(`${opts?.label || 'agent'} ended without a result: ${String(error).slice(0, 160)}`)
      return null
    }
  }

  // A value a command prints reaches a decision only through one line the PRINTER wrote: the agent runs it and relays the
  // line unchanged, and a retyped or edited line fails its CRC32. The printer holds no single quote, so the shell passes
  // it as one argument. Its first argument names the step whose commands it runs; the branch step reports the branch the worktree has checked out and mints the run id the begin and add steps pass to aco, the begin step runs `aco lane-record begin` and the add step `aco lane-record add`, each with the tip resolved by `git rev-parse` to 40 digits and each reporting its exit code and error output; after a begin that exited 0, the begin step runs `aco lane-record show --json` and reports only its exit code and error output, this run's own `follows`, and the shas of the earlier runs' stored review verdicts `approve` (the stored runs other than this run's id), the scope step never forces a push,
  // relays HEAD's parents and whether its second parent is in origin/main, at most 50 paths and no text of aco brief but its exit code and error output, the record step reports the exit code and error output of `aco lane-record check` on the record file, the sync step reports the lane tip, its parents and whether it contains origin/main, the fix step reports those sync values and, per finding path the lane sent, the size in characters of the diff of that path in the first-parent commits between the held tip and HEAD, a merge showing only its conflict resolution, and the same size for the whole range, never the diff text, and the tree of HEAD and the tree git itself produces by merging HEAD's first two parents (the first line of `git merge-tree --write-tree`), and the count and CRC32 of those paths like the ci step, and the ci step reports the pull request head, the count of listed checks, the checks that are neither pass nor skipping, each required context of the base whose bucket is not pass, with its bucket or missing, the exit code of each gh call, left out when it is 0 and the call has nothing else to carry, and its error output where it is not empty, the positions, among the finding paths the lane sent, of those that the pull request changes (the lane passes the finding paths as the last argument but one, each percent-encoded and joined by commas, so the argument holds no quote or backslash a copier could break; the file listing is paginated and never relayed), the exit code and error output of the head's workflow run listing, and the checks red on head that failed on the base tip too; a failed read of the pull request (gh api pulls/<n>, which spends no GraphQL points) ends its reads. A call that fails with a network marker or with GitHub's rate limit is retried (see NETWORK_WAIT_SECONDS) and, still failing, puts its name into unreachable, and into limited when the rate limit refused it. Only when the verdict check (the check named quality / verdict) is red, the ci step also reads that job log with gh run view and relays two values of it, never its text: whether a line says that only declared loosenings made it red and only the operator merges it, and the quality merge command of its next line; the lines come in any order and carry a job name, a step and a timestamp before their text.
  // A git or gh call that fails with one of these untranslated network or rate-limit markers, or an aco brief call whose stdout JSON has the reason unreachable, is run again after this many seconds; the tests rewrite the constant to 0.
  const NETWORK_WAIT_SECONDS = 30
  // The printer waits at most twice, gives each call 60 s and stops retrying once its run nears 240 s, inside the 300 s Bash timeout RELAY_ASK asks for.
  const PRINTER = [
    'import json,re,shutil,subprocess,sys,time,urllib.parse,uuid,zlib',
    'step,*rest,nonce=sys.argv[1:]',
    'received=[urllib.parse.unquote(p) for p in rest[2].split(",") if p] if step=="ci" else []',
    'diffed=[urllib.parse.unquote(p) for p in rest[1].split(",") if p] if step=="fix" else []',
    `wait=${NETWORK_WAIT_SECONDS}`,
    'start=time.monotonic();waits=[];unreachable=set()',
    'network=re.compile("Could not resolve host|Failed to connect to|check your internet connection or https://githubstatus.com")',
    'limit=re.compile("API rate limit already exceeded|API rate limit exceeded|secondary rate limit|rate limit is reached")',
    'timed_out=lambda c:subprocess.CompletedProcess(c,124,"","timed out: "+c[0])',
    String.raw`exec("def typed(s):\n try:return json.loads(s).get(\"reason\")==\"unreachable\"\n except Exception:return False\ndef down(c,p):return bool(limit.search(p.stderr)) or (typed(p.stdout) if c[:2]==(\"aco\",\"brief\") else bool(network.search(p.stderr)))\ndef call(c):\n while 1:\n  try:p=subprocess.run(c,capture_output=True,text=True,timeout=max(5,min(60,240-time.monotonic()+start)))\n  except subprocess.TimeoutExpired:p=timed_out(c);p.down=1;return p\n  if p.returncode==0 or not down(c,p):return p\n  if len(waits)>1 or time.monotonic()-start+wait>=240:p.down=1;return p\n  waits.append(1);time.sleep(wait)")`,
    String.raw`exec("def laneview(s,run):\n try:\n  runs=json.loads(s)[\"runs\"];own=[r for r in runs if r[\"run\"]==run][0]\n  return dict(follows=own[\"follows\"],approved=list(dict.fromkeys(v[\"sha\"] for r in runs if r[\"run\"]!=run for v in((r[\"record\"] or {}).get(\"verdicts\") or[]) if v[\"stage\"]==\"review\" and v[\"verdict\"]==\"approve\")))\n except Exception:return {}")`,
    'run=lambda*c:call(c) if shutil.which(c[0]) else subprocess.CompletedProcess(c,127,"","not found: "+c[0])',
    'target=lambda repo:("-R",repo) if repo else ()',
    'api=lambda repo:"repos/"+(repo or "{owner}/{repo}")',
    'base=lambda r:json.loads(r["view"].stdout)["baseRefName"]',
    `retitle=lambda pr,item,repo:(("title",("gh","api",api(repo)+"/pulls/"+pr,"--jq",".title")),("item",("gh","api",api(repo)+"/issues/"+item,"--jq",".title")),("retitle",lambda r:("gh","api","-X","PATCH",api(repo)+"/pulls/"+pr,"-f","title="+r["item"].stdout.strip()) if r["title"].stdout.strip()==${JSON.stringify(CHECKPOINT_TITLE_PREFIX)}+item and r["item"].stdout.strip() else ("true",)))`,
    'steps=dict(retitle=retitle,branch=lambda:(("branch",("git","branch","--show-current")),),scope=lambda item,branch:(("push",("git","push","origin",branch)),("remote",("git","rev-parse","origin/"+branch)),("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("second_parent_in_main",("git","merge-base","--is-ancestor","HEAD^2","origin/main")),("brief",("aco","brief",item,"--json"))),record=lambda file:(("check",("aco","lane-record","check",file)),),begin=lambda item,run,*ref:((("start",("git","rev-parse","--verify",ref[0]+"^{commit}")),) if ref else ())+(("begin",lambda r:("aco","lane-record","begin",item,"--run",run,*(("--start-tip",r["start"].stdout.strip()) if ref else ()))),("lane",("aco","lane-record","show",item,"--json"))),add=lambda item,file,run,ref,*stages:(("end",("git","rev-parse","--verify",ref+"^{commit}")),("add",lambda r:("aco","lane-record","add",item,file,"--run",run,"--end-tip",r["end"].stdout.strip(),"--ran",*stages))),sync=lambda:(("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("main",("git","merge-base","--is-ancestor","origin/main","HEAD"))),fix=lambda start,paths:(*steps["sync"](),*((f"diff{i}",("git","log","-p","--first-parent","--remerge-diff","--format=","%s..HEAD"%start,"--",p)) for i,p in enumerate(diffed)),("diffall",("git","log","-p","--first-parent","--remerge-diff","--format=","%s..HEAD"%start)),("tree",("git","rev-parse","HEAD^{tree}")),("mergetree",("git","merge-tree","--write-tree","HEAD^1","HEAD^2"))),ci=lambda pr,repo,paths:(("view",("gh","api",api(repo)+"/pulls/"+pr,"--jq","{headRefOid:.head.sha,baseRefName:.base.ref}")),("changed",("gh","api",api(repo)+"/pulls/"+pr+"/files","--paginate","--slurp")),("headruns",lambda r:("gh","run","list","--commit",json.loads(r["view"].stdout)["headRefOid"],"--json","status,name","--limit","100",*target(repo))),("checks",("gh","pr","checks",pr,"--json","name,bucket,link",*target(repo))),("rules",lambda r:("gh","api",api(repo)+"/rules/branches/"+base(r))),("runs",lambda r:("gh","api",api(repo)+"/commits/"+base(r)+"/check-runs","--paginate","--slurp"))))',
    'ran={"run":subprocess.CompletedProcess(("uuid",),0,uuid.uuid4().hex,"")} if step=="branch" else {}',
    '[ran.__setitem__(n,run(*(c(ran) if callable(c) else c))) for n,c in steps[step](*rest) if not any(ran[k].returncode for k in("view","start","end","begin") if k in ran)]',
    'verdict_jobs=[m[1] for c in (json.loads(ran["checks"].stdout) if step=="ci" and "checks" in ran and ran["checks"].returncode==0 else []) if c["name"]=="quality / verdict" and c["bucket"]=="fail" and (m:=re.search("/job/([0-9]+)",c.get("link") or ""))]',
    'ran.update({"log":run("gh","run","view","--job",verdict_jobs[0],*target(rest[1]),"--log")} if verdict_jobs else {})',
    'brief=json.loads(ran["brief"].stdout) if "brief" in ran and ran["brief"].returncode==0 else None',
    'claim=brief and brief["outside_claim"]',
    'values={n:{"code":p.returncode,**({"err":e} if ((e:=" ".join(l for l in p.stderr.splitlines() if l[:5]!="hint:")[-300:]) or step!="ci") and (n!="log" or p.returncode) else {}),**({} if n in("brief","view","check","checks","rules","runs","log","changed","headruns","lane") else {"out":p.stdout.strip()[:100]} if n[:4]!="diff" else {"size":len(p.stdout.strip())})} for n,p in ran.items()}',
    'parsed=lambda n:json.loads(ran[n].stdout) if n in ran and ran[n].returncode==0 else None',
    'view,listing,rules,pages=parsed("view"),parsed("checks"),parsed("rules"),parsed("runs")',
    'listing=listing and sorted(listing,key=lambda c:(c["name"],c["bucket"]))',
    'latest_on_base={r["name"]:r for r in sorted((r for page in pages or [] for r in page["check_runs"] if r["status"]=="completed"),key=lambda r:(r.get("completed_at") or "",r["id"]))}',
    'failed_on_base={n for n,r in latest_on_base.items() if r["conclusion"]=="failure"}',
    'buckets={c["name"]:c["bucket"] for c in listing or []}',
    'contexts=None if rules is None else [c["context"] for r in rules if r["type"]=="required_status_checks" for c in r["parameters"]["required_status_checks"]]',
    'unmet={c:buckets.get(c,"missing") for c in contexts or [] if buckets.get(c,"missing")!="pass"}',
    'values.update({n:{**values[n],**x} for n,x in(("checks",None if listing is None else dict(count=len(listing),open=[dict(name=c["name"],bucket=c["bucket"]) for c in listing if c["bucket"] not in("pass","skipping")])),("rules",None if contexts is None else dict(required=unmet) if unmet else {})) if x is not None})',
    'unfinished=sorted({r["name"] for r in parsed("headruns") or [] if r["status"]!="completed"})',
    'values.update(**({"headruns":{**values["headruns"],"open":unfinished}} if unfinished else {}))',
    'values.update(**(dict(head=view["headRefOid"],changed_index=[i for i,p in enumerate(received) if p in {f["filename"] for page in parsed("changed") or [] for f in page}],shared=[c["name"] for c in listing or [] if c["bucket"]=="fail" and c["name"] in failed_on_base]) if view else {}))',
    'values.update(**({"lane":{**values["lane"],**laneview(ran["lane"].stdout,rest[1])}} if "lane" in ran and ran["lane"].returncode==0 else {}))',
    String.raw`values.update(**({"log":{**values["log"],"loosenings":any("only declared loosenings \u00b7 only the operator merges it" in l for l in ran["log"].stdout.splitlines()),"merge":next((m[1] for l in ran["log"].stderr.splitlines()+ran["log"].stdout.splitlines() if "next:" in l and (m:=re.search("(quality merge [A-Za-z0-9._-]+/[A-Za-z0-9._-]+#[0-9]+)",l))),"")}} if "log" in ran else {}))`,
    'values.update(nonce=nonce,**({"unreachable":sorted(n for n,p in ran.items() if getattr(p,"down",0))} if any(getattr(p,"down",0) for p in ran.values()) else {}),**({"limited":sorted(n for n,p in ran.items() if getattr(p,"down",0) and limit.search(p.stderr))} if any(getattr(p,"down",0) and limit.search(p.stderr) for p in ran.values()) else {}),**(dict(outside_claim=claim[:50] if isinstance(claim,list) else claim,count=len(claim) if isinstance(claim,list) else None) if "brief" in ran else {}))',
    'values={n:v for n,v in values.items() if v!={"code":0} and not(n in("shared","changed_index") and v==[])}',
    'values.update(**(dict(paths=dict(count=len(received or diffed),hash="%08x"%zlib.crc32(json.dumps(received or diffed,ensure_ascii=True,separators=(",",":")).encode()))) if step in("ci","fix") and (received or diffed) else {}))',
    'payload=json.dumps(values,ensure_ascii=True,separators=(",",":"),sort_keys=True)',
    'print("""{"crc":"%08x","v":%s}"""%(zlib.crc32(payload.encode()),payload))',
  ].join(';')
  // A step may bring a command that must succeed first (the record step cuts its file from the transcript and compares its CRC32).
  const relayCommand = (...relayArgs) => `${before ? before + ' && ' : ''}cd '${A.worktree}' && python3 -c '${PRINTER}' ${relayArgs.join(' ')}`
  const RELAY_ASK = 'run this one command line exactly as written with a Bash timeout of 300000 ms, without changing it or its directory, and return the line it prints unchanged as printed; when it prints no line, return its error output as printed:'
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
  // The printer sorts checks.open by name and bucket, because the order of the listing decides nothing and a model that
  // tidies it must not fail the check: a mismatching line is read again with the list in the printer's order, in the printer's JSON form.
  const compareText = (a, b) => Number(a > b) - Number(a < b)
  const sortedListing = (values) => {
    const list = values?.checks?.open
    if (!Array.isArray(list)) return values
    const byNameThenBucket = (a, b) => compareText(a?.name, b?.name) || compareText(a?.bucket, b?.bucket)
    return { ...values, checks: { ...values.checks, open: [...list].sort(byNameThenBucket) } }
  }
  const printerPair = (value, key) => printerText(key) + ':' + printerText(value[key])
  const printerText = (value) => {
    if (Array.isArray(value)) return `[${value.map(printerText).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.keys(value).sort(compareText).map(key => printerPair(value, key)).join(',')}}`
    return JSON.stringify(value).replace(/[^\x00-\x7f]/g, ch => String.raw`\u` + ch.codePointAt(0).toString(16).padStart(4, '0'))
  }
  // A model that copies a long line often miscounts the run of closing braces at its end; the CRC accepts only the count the printer wrote.
  const withAnyClosingBraces = (text) => {
    let bareLength = text.length
    while (bareLength > 0 && text[bareLength - 1] === '}') bareLength--
    const bare = text.slice(0, bareLength)
    return Array.from({ length: text.length - bare.length + 2 }, (_, count) => bare + '}'.repeat(count))
  }
  const PRINTED = { type: 'string', description: 'the one line the command printed, character for character as printed; when it printed no line, its error output' }
  const FIX = {
    type: 'object',
    required: ['mergeResolvedLaneConflict', 'files', 'disputed', 'regression', 'blocked'],
    properties: {
      mergeResolvedLaneConflict: { type: 'boolean' },
      files: { type: 'array', items: { type: 'string' } },
      disputed: {
        type: 'array',
        description: 'findings you did not fix because the evidence contradicts them',
        items: { type: 'object', required: ['where', 'text', 'counterEvidence'], properties: { where: { type: 'string' }, text: { type: 'string' }, counterEvidence: { type: 'string' } } },
      },
      resolved: {
        type: 'array',
        description: 'fold-ins you found already done: left in the worktree by an earlier fixer whose fix was not accepted, or already satisfied by the lane tip',
        items: { type: 'object', required: ['where', 'text', 'evidence'], properties: { where: { type: 'string' }, text: { type: 'string' }, evidence: { type: 'string', description: 'the test, probe cell or line that already satisfies it' } } },
      },
      outside: { type: 'array', description: 'blocking findings and fold-ins you answered by editing the item body or the pull request body or posting an item comment, with no commit: a blocking finding by its number in the blocking list (finding), a fold-in by its where (foldIn), and the body section or comment URL', items: { type: 'object', required: ['where'], properties: { finding: { type: 'integer', minimum: 1 }, foldIn: { type: 'string' }, where: { type: 'string' } } } },
      regression: {
        type: 'array',
        description: "empty only when no blocking finding needs a proof; otherwise every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, under that finding's number in the blocking list you were given",
        items: { type: 'object', required: ['finding', 'test', 'failedBefore', 'passesAfter'], properties: { finding: { type: 'integer', minimum: 1, description: 'the number of the blocking finding in the list you were given' }, resolution: { type: 'string', enum: ['removed'], description: 'for a finding of any kind whose fix only deletes dead code or a test that pins no behaviour, instead of changing behaviour or adding a test' }, test: { type: 'string' }, failedBefore: { type: 'boolean' }, passesAfter: { type: 'boolean' }, notRun: { type: 'string', description: 'why this machine could not run the test (a refused command, a machine another lane holds); CI on the pushed tip is its proof. Not for a test you ran and saw fail: that is passesAfter false' }, mutation: { type: 'string', description: 'for a test-gap finding: the production change, made and reverted, under which the test fails; it goes here and not inside test' } } },
      },
      noBehaviourChange: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'the numbers of the blocking findings whose fix changes no behaviour of the code (formatting, lint, a ratchet baseline, a clone pair, a coverage floor, a code-smell rule, an ID marker); leave out a finding whose fix changes behaviour, and list none when unsure' },
      briefMet: { type: 'boolean', description: `true only when the one finding is the unfinished checkpoint of the build brief (where "${CHECKPOINT_FINDING_WHERE}") and the checkpoint already meets the brief with its checks green, so you changed nothing` },
      summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' },
    },
  }
  const SYNC_ANSWER = { properties: { note: { type: 'string', description: 'what stopped the merge: the conflicting paths, or the failed command and its output' } } }
  const CHECKPOINT_ANSWER = {
    required: ['work'],
    properties: {
      work: { type: 'boolean', description: 'true when the worktree held commits past the start ref or uncommitted work, so there is something to checkpoint' },
      pr: { type: 'integer', minimum: 1, description: 'the number of the open pull request of the branch, when it has one' },
      note: { type: 'string', description: 'what stopped the checkpoint: the failed command and its output' },
    },
  }
  const git = `git -C '${A.worktree}'`

  // The step runs where a builder or fixer ended without a result: it saves what they left, and the printer then reports the tip.
  function checkpointBrief({ facts, stage, startRef, branch, item, repo }) {
    const who = stage === 'build' ? 'builder' : 'fixer'
    const draft = stage === 'build'
      ? `Then run \`gh pr list --head '${branch}' --state open --json number${repo}\`; when it lists no pull request, open a draft with \`gh pr create --draft --head '${branch}' --title '${checkpointTitle(item)}' --body "$(printf 'Work-Item: #${item}\\nCloses #${item}')"${repo}\`. Return the number of the pull request in pr. `
      : ''
    return (
      `${facts}\nThe ${who} of this lane ended without a result and may have left work in the worktree. Save it and change no file: run each command exactly as written, with its -C option. ` +
      `Run \`${git} status --porcelain\` and \`${git} log --oneline ${startRef}..HEAD\`. When both print nothing, there is nothing to save: set work to false and run no command more. ` +
      `Otherwise set work to true, run \`${git} add -A\` (never a path outside the worktree, never \`-f\`), and when \`${git} diff --cached --quiet\` exits 1 run ` +
      `\`${git} commit -m 'Unfinished checkpoint of the ${who} of #${item}'\`. Run \`${git} push origin '${branch}'\`. ${draft}` +
      `A command that fails: stop, and put the command and its output in note. Last, whatever happened,`
    )
  }

  function syncBrief({ facts, hasLedgers, hasGenerated }) {
    const either = hasLedgers || hasGenerated
    const andGeneratedFiles = hasGenerated ? ' and the generated files' : ''
    return (
      `${facts}\nBring the lane up to date with main and change nothing else. Run each command exactly as written, with its -C option. Run \`${git} fetch origin && ${git} merge-base --is-ancestor origin/main HEAD\`; when it exits 0, the lane already contains main: change nothing. ` +
      `Otherwise run \`${git} merge origin/main\`; when it merges cleanly, run \`${git} push\`. ` +
      (either ? `Conflicts only in the append-only ledgers${andGeneratedFiles}: resolve them as the lane facts say, commit the merge, run \`${git} push\`. ` : '') +
      (hasGenerated ? `When a generated file's command fails or leaves its path dirty or unmerged, run \`${git} merge --abort\` and put the command and its output in note. ` : '') +
      (either ? `Any other conflict: ` : `Any conflict: `) +
      `run \`${git} merge --abort\`, confirm \`${git} status --porcelain\` is empty, push nothing, and put the conflicting paths in note. Last, whatever happened,`
    )
  }

  function fixerBrief({ facts, pr, tip, source, blocking, foldIns }) {
    const task = blocking
      ? `Then answer exactly these blocking findings from ${source}, and nothing else:\n${blocking}`
      : 'There are no blocking findings; your whole task is the follow-ups below:'
    const foldInBrief = foldIns
      ? `\n\nAlso fold in these follow-ups, only because each sits in a file this lane already changed and cannot change behaviour; one commit for all of them. ` +
      `One that is already done — left in the worktree by an earlier fixer, or already satisfied by the lane tip — you do not redo; list it in resolved with its evidence (the test, probe cell or line that satisfies it). ` +
      `One that the item body, the pull request body or an item comment answers goes in outside with foldIn set to its where; commit nothing for it. When that leaves you nothing to change, change nothing:\n${foldIns}`
      : ''
    const answersBrief = A.answers ? `The head's answers on findings it settled, to read before you answer one of them:\n${A.answers}\n` : ''
    return (
      `${facts}\nYou are a fresh fixer for PR #${pr} (lane tip ${tip}). Merge origin/main if it moved, before or after your fixes (a merge commit; ` +
      `resolve conflicts so both sides' behaviour holds, and set mergeResolvedLaneConflict true when files this lane changed needed resolution). If the worktree already carries commits or uncommitted changes past that tip from an earlier fixer that ran out of turns, judge them, keep what is right, and continue from there. Commit each finding as soon as it is green. List in noBehaviourChange the number of each blocking finding whose fix changes no behaviour of the code, and only those. Then commit what is green and return what is left in blockedReason with blocked true. ${task}${foldInBrief}\n\n` +
      `Each finding names the rule it breaks and its evidence. A scanner finding whose message covers the whole file (for example "in this file") is fixed at every occurrence in that file, not only at the reported line. Check the evidence yourself first. If it does not hold — the rule is not broken, or the evidence is wrong — ` +
      `do not change code for it: list it in disputed with your counter-evidence. Report every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, in regression under that finding's number in the list above; the number counts only for the blocking list, a probe you saw fail and then acted on is reported before the entry that passes, and the last entry per finding is its proof; a follow-up needs no regression entry. Run the mutation you name, do not reason about it. ` +
      `A defect's test fails before your fix and passes after it; a defect with a test draft needs one. A defect in test code (hygiene) needs no regression test: the diff is its proof. A test you could not run on this machine is reported with notRun, the reason, and passesAfter false is kept for a test you ran and saw fail; the delta re-check judges a not-run test from its text and CI on the pushed tip runs it. A test-gap finding means a behaviour has no test, the code is already right, and it always needs a test: it passes before and after, ` +
      `so name in the mutation field (not inside test) the production change, made and reverted, under which the test fails; a test that fails on the pre-fix code counts as such a mutation (failedBefore true). When a finding is answered by deleting dead code or a test that pins no behaviour (a test-gap's vacuous cell, an unreachable guard), no test is needed: report resolution removed and commit the removal: the lane reads its diff from your commits, so do not copy it. No failing-first or passing-after bar applies. A fix that changes behaviour is no removal and keeps its test. A docs finding needs no test. When the only finding is that the pull request conflicts with main, the merge is the whole fix. ` +
      `Otherwise one commit per finding. Push, patch the PR body where it became false or where a finding is about it (REST PATCH with --input, never gh pr edit --body-file); a finding the item body, the pull request body or an item comment answers goes in outside under its number in finding, and commit nothing for it. A finding answered by editing the item body or the pull request body is reported in outside, never as removed; removed is only for code or a test deleted in your commits. Run \`aco check ${pr}\` from the worktree. ` +
      answersBrief +
      `Return files: the output of \`${git} log --name-only --format= --first-parent --remerge-diff ${tip}..HEAD\` (of \`${git} diff --name-only ${tip}..HEAD\` when mergeResolvedLaneConflict is true). Last, whatever happened,`
    )
  }

  // What a proof still has to show for the finding it names, or null when it shows it. A test-gap's code was already
  // right, so its test passes after the fix and pins the behaviour when a mutation, or the pre-fix code, makes it fail.
  // Dead code or a test that pins nothing may be removed instead, for a finding of any kind, with the size of the diff of its path (of the whole range when the finding names no path or its path carries no diff) in the fixer's commits as the proof.
  function proofGap(proof, finding, outsideAnswered) {
    const kind = finding.kind
    if (proof.resolution === 'removed') return outsideAnswered || proof.removal?.size > 0 ? null : `the removal for ${finding.where} carried no diff; an answer written into the item body or the pull request body belongs in outside, never in removed`
    if (kind === 'docs') return null
    if (isNotRun(proof)) return null  // reaches the delta re-check as a note, see notRunNote
    if (kind === 'test-gap') return testGapProofGap(proof, finding)
    const missing = [!proof.failedBefore && needsProof(finding) && 'fail before', !proof.passesAfter && 'pass after'].filter(Boolean)
    return missing.length ? `a regression test did not ${missing.join(' and ')} its fix` : null
  }

  const isNotRun = (proof) => Boolean((proof.notRun || '').trim())
  // Whether a fix must prove the finding with a test: a test-gap is nothing but a missing test, a defect's test draft
  // asks for one, and a docs finding needs none even when a draft came with it.
  const needsProof = (finding) => finding.kind === 'test-gap' || (finding.kind === 'defect' && Boolean(finding.testDraft))

  // A proof counts only for the blocking finding whose list number it names; any other number (a fold-in's, say) is not checked.
  const proves = (proof, index) => Number.isInteger(proof.finding) && proof.finding === index + 1

  // Each proof paired with the blocking finding it names and what it still lacks. A finding another proof covers
  // without a gap counts as proven, so a proof with a gap beside it is only supporting evidence.
  function judgedProofs(fixed, blocking) {
    const judged = (fixed.regression || []).flatMap(proof => blocking.map((finding, index) => ({ proof, finding, index })).filter(({ index }) => proves(proof, index)).map(({ finding, index }) => ({ proof, finding, index, gap: proofGap(proof, finding, answeredOutsideFinding(fixed, index)) })))
    const provenIndexes = new Set(judged.filter(({ gap }) => !gap).map(({ index }) => index))
    return judged.map((entry, position) => ({ ...entry, proven: provenIndexes.has(entry.index), actedOn: judged.slice(position + 1).some(later => later.index === entry.index && !later.gap) }))
  }

  // A removal answers a finding only if the reviewer agrees what was removed was dead or pinned nothing.
  // A proof with a gap beside a valid proof for its finding reaches the raiser as a note, so it can judge whether the proof misleads.
  const removalNote = ({ proof, finding }) => {
    const { range, path, untouchedPath, size } = proof.removal
    const pathArgument = path ? ` -- ${path}` : ''
    const wholeRangeReason = untouchedPath ? `${untouchedPath} carries no diff` : 'the finding names no path'
    const scope = path ? '' : `, the whole range, because ${wholeRangeReason}`
    return `\nThe fixer answered ${finding.where} by removing code or a test instead of changing behaviour; judge whether what was removed was dead or pinned no behaviour. Read the removal yourself: git log -p --first-parent --remerge-diff ${range}${pathArgument} (${size} characters${scope}).`
  }
  const supportingNote = ({ proof, finding, gap }) => `\nThe fixer also offered the test ${proof.test} for ${finding.where}, though it shows less than the bar: ${gap}; judge whether it misleads.`
  // The half of a proof the fixer did not run, for the raiser to judge from the test's text; CI on the tip runs the test.
  const notRunNote = ({ proof, finding }) => {
    const mutation = (proof.mutation || '').trim()
    const namedMutation = mutation ? `"${mutation}"` : 'it names'
    const unrunHalf = finding.kind === 'test-gap' ? `fails under the mutation ${namedMutation}` : 'fails on the pre-fix code'
    return `\nThe fixer did not run the test ${proof.test} for ${finding.where} (${proof.notRun.trim()}); read its text and judge the half that was not run: it ${unrunHalf}.`
  }
  const misplacedMutationNote = ({ proof, finding }) => `\nThe fixer offered the test ${proof.test} for ${finding.where} and named no mutation in the mutation field; read its text and judge whether it names a mutation, made and reverted, under which the test fails.`
  const proofNotes = (fixed, blocking) => judgedProofs(fixed, blocking).map(entry => {
    if (!entry.gap && !isNotRun(entry.proof) && entry.proof.resolution !== 'removed' && namesNoMutationField(entry.proof, entry.finding)) return misplacedMutationNote(entry)
    if (isNotRun(entry.proof) && needsProof(entry.finding)) return notRunNote(entry)
    if (entry.proof.resolution === 'removed' && !entry.gap && entry.proof.removal?.size > 0) return removalNote(entry)
    return entry.gap && entry.proven ? supportingNote(entry) : ''
  }).join('')

  // The fixer's proofs judged against the blocking findings it was given, each with its kind: the rejection that stops the fix (the finding numbers it
  // names count from 1) or null, and the notes the raiser reads next to the delta.
  function judgeProofs(fixed, blocking) {
    // A proof red after the fix is evidence against the fix, even beside a valid proof, unless a later entry for the same finding is a valid proof: the fixer acted on that probe, and its last entry is the proof.
    const gaps = judgedProofs(fixed, blocking).filter(checked => checked.gap && (!checked.proven || (!checked.proof.passesAfter && !checked.actedOn)))
    const unproven = blocking.map((finding, index) => ({ finding, index })).filter(({ finding, index }) => needsProof(finding) && !(fixed.regression || []).some(r => proves(r, index)))
    let proofRejection = null
    if (gaps.length) proofRejection = { reason: [...new Set(gaps.map(checked => checked.gap))].join('; '), regression: gaps.map(checked => checked.proof), findingNumbers: gaps.map(checked => checked.index + 1) }
    else if (unproven.length) proofRejection = { reason: 'a test-gap finding or a defect with a test draft got no regression test: ' + unproven.map(({ finding, index }) => (index + 1) + '. ' + finding.where).join(', '), findingNumbers: unproven.map(({ index }) => index + 1) }
    return { proofRejection, proofNotes: proofNotes(fixed, blocking) }
  }

  // A batch of CI findings only, every one disputed with counter-evidence and nothing committed, is a flake the lane re-runs once before the head sees it.
  function isFlakeDispute(fixed, blocking) {
    if (A.flakeRerunUsed || A.source !== 'CI' || !fixed.unchanged) return false
    return blocking.every(f => fixed.disputed.some(d => d.where === f.where && (d.counterEvidence || '').trim()))
  }
  const disputeFlakes = (fixed, blocking) => fixed.disputed.filter(d => blocking.some(f => f.where === d.where)).map(d => ({ where: d.where, text: `${d.text} (a flake; the fixer's counter-evidence: ${d.counterEvidence})`, owner: 'distributor', stage: 'ci' }))
  // The evidence the fixer gave for a fold-in it found already done, or undefined without any.
  const satisfiedEvidence = (fixed, foldIn) => (fixed.resolved || []).find(r => r.where === foldIn.where && (r.evidence || '').trim())?.evidence
  // An unchanged tip is a fix only when there are no blocking findings and every fold-in is proven already satisfied.
  const everyFoldInSatisfied = (fixed, blocking, foldIn) => !blocking.length && foldIn.length > 0 && foldIn.every(f => satisfiedEvidence(fixed, f))
  // An unchanged tip is a fix too when every blocking finding is answered in the pull request body or an item comment and every fold-in
  // is answered there or proven already satisfied; at least one answer outside the tree is what the re-check then reads.
  const outsideAnswers = (fixed) => (fixed.outside || []).filter(o => (o.where || '').trim())
  // A removal the same answer also lists in outside, on an unchanged tip, is that outside answer.
  const answeredOutsideFinding = (fixed, index) => fixed.unchanged && outsideAnswers(fixed).some(o => o.finding === index + 1)
  const answeredOutside = (fixed, blocking, foldIn) => {
    const answers = outsideAnswers(fixed)
    const blockingAnswered = blocking.every((_, index) => answers.some(o => o.finding === index + 1))
    const foldInAnswered = foldIn.every(f => answers.some(o => o.foldIn === f.where) || satisfiedEvidence(fixed, f))
    const anyAnswer = blocking.length > 0 || foldIn.some(f => answers.some(o => o.foldIn === f.where))
    return anyAnswer && blockingAnswered && foldInAnswered
  }
  // Why a fixer's answer does not count as a fix, or null when it does.
  function fixRejection(fixed, blocking, foldIn) {
    const { findingNumbers, ...rejection } = fixed.proofRejection ?? {}
    if (findingNumbers) return { ...rejection, lastBlocking: findingNumbers.map(number => blocking[number - 1]) }
    // Satisfied fold-ins leave the lane at the held tip, or at a merge of main onto it: anything past that is unasked work.
    const foldInsOnly = everyFoldInSatisfied(fixed, blocking, foldIn)
    if (fixed.unchanged) return (foldInsOnly && fixed.containsMain) || answeredOutside(fixed, blocking, foldIn) || checkpointMet(fixed, blocking) ? null : { reason: 'the fixer changed nothing', lastBlocking: blocking }
    const mergeWasTheFinding = A.source === 'CI' || (blocking.length === 1 && blocking[0].where === 'mergeable')
    if (fixed.mergeOnly && !mergeWasTheFinding && !foldInsOnly) return { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }
    return null
  }
  // A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
  const worktreeRelative = (files) => files.map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))

  // A removal is judged by the size of the diff the printer measured in the fixer's commits, for the path of the finding its proof names, or for the whole range when that finding names no path or its path carries no diff (a check may report where a rule is declared, not where it broke); the raiser reads the diff itself.
  function withReadRemovals(regression, blocking, values, range) {
    const removalOf = (proof) => {
      const finding = blocking[proof.finding - 1]
      const path = finding ? A.findingPath(finding.where) : ''
      const ofPath = path ? values[`diff${A.sentPaths.indexOf(path)}`] : null
      const untouched = path && !ofPath?.size
      const measured = path && !untouched ? ofPath : values.diffall
      return { size: finding ? measured?.size ?? 0 : 0, path: untouched ? '' : path, untouchedPath: untouched ? path : '', range }
    }
    return regression.map(proof => proof.resolution === 'removed' ? { ...proof, removal: removalOf(proof) } : proof)
  }

  // A merge of main onto the held tip changes nothing of the lane only when its tree is the one git itself produces for its parents;
  // a merge git cannot merge cleanly (non-zero exit) holds a resolved conflict, and a tree that differs holds an edit inside the merge commit.
  const cleanMerge = (values) => values.mergetree?.code === 0 && values.tree?.code === 0 && Boolean(values.tree.out) && values.mergetree.out.split('\n')[0] === values.tree.out
  // The facts of a fixer's answer against the tip it started from and the outcome they decide: flake, disputed, rejected or accepted.
  // The lane acts on the outcome and keeps its own state; the relay line is read and no git command failed before this runs.
  function judgeFix(answer, values) {
    const blocking = A.findings
    const foldIn = A.foldInEntries
    const heldTip = A.tip
    const facts = { ...answer, regression: withReadRemovals(answer.regression || [], blocking, values, `${heldTip}..${values.head.out}`), tip: values.head.out, heldTip, unchanged: sameCommit(values.head.out, heldTip), mergeOnly: mergedOnto(values, heldTip) && cleanMerge(values), containsMain: values.main.code === 0 }
    const { proofRejection, proofNotes } = judgeProofs(facts, blocking)
    const fixed = { ...facts, proofRejection, proofNotes }
    const relative = worktreeRelative(fixed.files || [])
    const disputed = (fixed.disputed || []).length > 0
    const rejection = disputed ? null : fixRejection(fixed, blocking, foldIn)
    const flake = disputed && isFlakeDispute(fixed, blocking)
    let outcome = 'accepted'
    if (flake) outcome = 'flake'
    else if (disputed) outcome = 'disputed'
    else if (rejection) outcome = 'rejected'
    return {
      ...facts,
      proofNotes,
      outcome,
      flakes: flake ? disputeFlakes(fixed, blocking) : [],
      rejection,
      outsidePaths: relative.filter(f => f.startsWith('/')),
      touchesProduction: Boolean(fixed.mergeResolvedLaneConflict) || relative.some(f => A.productionPaths.some(prefix => f.startsWith(prefix))),
      answeredOutside: fixed.unchanged && answeredOutside(fixed, blocking, foldIn),
      checkpointMet: fixed.unchanged && checkpointMet(fixed, blocking),
      satisfied: everyFoldInSatisfied(fixed, blocking, foldIn),
      foldInEvidence: Object.fromEntries(foldIn.map(f => [f.where, satisfiedEvidence(fixed, f)]).filter(([, evidence]) => evidence)),
    }
  }

  // The sync step and the fix step have an agent that works before the printer runs: each brings its own brief and the schema of the report that brief asks for.
  const ANSWER_KINDS = {
    sync: { schema: SYNC_ANSWER, need: ['facts', 'hasLedgers', 'hasGenerated'], brief: syncBrief },
    checkpoint: { schema: CHECKPOINT_ANSWER, need: ['facts', 'stage', 'startRef', 'branch', 'item', 'repo'], brief: checkpointBrief },
    fix: { schema: FIX, need: ['facts', 'pr', 'tip', 'source', 'blocking', 'findings', 'foldIns', 'foldInEntries', 'productionPaths', 'flakeRerunUsed'], brief: fixerBrief },
  }
  const answerKind = ANSWER_KINDS[A.answerKind]
  const kindMissing = (answerKind ? answerKind.need : ['brief']).filter(key => A[key] === undefined || A[key] === null)
  if (kindMissing.length) return { refused: `missing args: ${kindMissing.join(', ')}` }
  const answerSchema = answerKind?.schema || {}
  const brief = answerKind ? answerKind.brief(A) : A.brief

  // The failing findings of checks main does not share, and every finding that names a file the lane changed: a shared check's red entries and findings named by it are left out otherwise.
  function ownFailing({ shared, red = [], failing = [], files = [] }) {
    const sharedEntries = new Set(red.filter(job => shared.includes(job.name)).flatMap(job => job.findings.map(entry => JSON.stringify(entry))))
    const inChangedFile = entry => files.includes(A.findingPath(entry.where))
    return failing.filter(entry => inChangedFile(entry) || (!sharedEntries.has(JSON.stringify(entry)) && ![entry.where, String(entry.rule).replace(/^CI check /, '')].some(name => shared.includes(name))))
  }

  const readFailure = (read, command) => read.code === 0 ? null : `${command} exited ${read.code}: ${read.err ?? ''}`

  // What the lane reads from the ci step: the head, the checks red on the base branch too, the red a fixer may not remove, why the listing does not prove green,
  // and the watcher's verdict corrected by the printed listing: green, proven, the state in words, the failing checks split into own and shared.
  function readCi({ checks, rules, headruns, changed, head, shared, files, log: jobLog }) {
    // The printer reads a job log only for the red verdict check; its two values name the red a fixer may not remove.
    const operatorDoor = checks.open?.length === 1 && jobLog?.code === 0 && jobLog.loosenings && jobLog.merge ? jobLog.merge : null
    const listed = unprovenGreen({ checks, rules })
    const open = checks.open || []
    const watched = A.watched
    // A re-run watches only the jobs it re-ran: its green leaves a red shared with main in the listing, which stays red, not unproven.
    const sharedRerun = Boolean(A.rerun) && watched.green && open.length > 0 && open.every(c => c.bucket === 'fail' && shared?.includes(c.name))
    const watcherDecides = !sharedRerun && (watched.green || watched.failing?.length)
    const failing = watcherDecides ? watched.failing : failedCheckFindings(open)
    const ownRed = ownFailing({ shared, red: watched.red, failing, files })
    const green = watched.green && !sharedRerun
    const unproven = green ? listed : null
    const rulesError = readFailure(rules, 'gh api')
    const runsError = readFailure(headruns, 'gh run list')
    const changedError = readFailure(changed, 'gh api')
    const proven = green && !unproven && !rulesError && !runsError && !changedError
    const names = (failing || []).map(f => `"${f.where}"`).join(', ')
    let state = 'not green'
    if (proven) state = 'green'
    else if (names) state = `red (${names})`
    const settled = green || failing.length || open.some(c => c.bucket === 'fail')
    const pending = settled ? null : pendingReason([...open.filter(c => c.bucket === 'pending').map(c => c.name), ...(headruns.open || [])])
    const readError = [runsError && `the workflow runs of the pull request head could not be read: ${runsError}`, changedError && `the changed files of the pull request could not be listed: ${changedError}`, rulesError && `the required checks of the base branch could not be read: ${rulesError}`].find(Boolean)
    return {
      head, shared, operatorDoor, failing, ownRed, green, unproven, readError, pending, proven,
      verdict: ciVerdict(proven, pending),
      sharedOnly: shared.length > 0 && ownRed.length === 0,
      state,
    }
  }

  // The count and CRC32 of the finding paths, as the printer computes them over the list it received (JSON with ASCII escapes).
  const pathsDigest = (paths) => ({ count: paths.length, hash: crc32(JSON.stringify(paths).replace(/[^\x20-\x7e]/g, char => String.raw`\u` + char.codePointAt(0).toString(16).padStart(4, '0'))) })
  const sameDigest = (echoed, sent) => echoed?.count === sent.count && echoed?.hash === sent.hash

  // The printer leaves out the values equal to their default (an empty list, no finding paths), so a copy that drops them is the printed line.
  function withPrinterDefaults(values) {
    if (step === 'ci') return { paths: pathsDigest([]), shared: [], changed_index: [], ...values }
    if (step === 'fix') return { paths: pathsDigest([]), ...values }
    return values
  }

  // The head and main commands of the sync and fix steps: head must exit 0, and main (merge-base --is-ancestor) exits 0 or 1.
  const gitCommandFailed = (values) => values.head && values.main ? values.head.code !== 0 || ![0, 1].includes(values.main.code) : undefined

  // The values of a relay line, or why the line cannot be trusted: checked as text first (shape, CRC32), parsed after.
  // A caller stops at the stage of the step that ran the printer, so an unreadable scope line stops at scope, because it
  // proves nothing about the push; push is only for a readable line that shows the push failed or the remote lacks the tip.
  function readRelay(printed, nonce, requiredKeys = []) {
    const match = RELAY_LINE.exec((printed || '').trim())
    if (!match) return { problem: 'is not a relay line' }
    const printedPayload = withAnyClosingBraces(match[2]).find(text => crc32(text) === match[1])
    let values
    try { values = JSON.parse(printedPayload ?? match[2]) } catch { return printedPayload === undefined ? { problem: 'fails its CRC check' } : { problem: 'does not hold JSON' } }
    if (printedPayload === undefined && crc32(printerText(sortedListing(values))) !== match[1]) return { problem: 'fails its CRC check' }
    if (values?.nonce !== nonce) return { problem: `carries the nonce ${values?.nonce}, not ${nonce}` }
    values = withPrinterDefaults(values)
    if (['ci', 'fix'].includes(step) && A.sentPaths && !sameDigest(values.paths, pathsDigest(A.sentPaths))) return { problem: 'echoes other finding paths than the lane sent' }
    // The printer leaves out an entry of the ci step that carries only exit code 0, so its absence reads as that code.
    const complete = step === 'ci' ? { view: { code: 0 }, runs: { code: 0 }, rules: { code: 0 }, changed: { code: 0 }, headruns: { code: 0 }, files: values.changed_index.map(position => A.sentPaths?.[position]).filter(Boolean), ...values } : values
    const missing = requiredKeys.find(key => !complete[key])
    if (missing) return { problem: `lacks the ${missing} entry` }
    return { values: complete, commandFailed: gitCommandFailed(complete), unreachable: unreachableReason(complete), ...(step === 'ci' && complete.view.code === 0 && { ci: readCi(complete) }) }
  }

  const answer = await safeAgent(`${A.delegatedLine}\n${brief} ${RELAY_ASK}\n${relayCommand(step, ...relayArgs)}`, {
    label, phase: phaseName,
    schema: { type: 'object', required: ['printed', ...(answerSchema.required || [])], properties: { printed: PRINTED, ...answerSchema.properties } },
    ...agentOptions,
  })
  if (!answer) return null
  // Only a readable line of a fixer that was not blocked and ran no failed git command is judged.
  const fixJudgement = (fixerAnswer, readLine) => A.answerKind === 'fix' && !fixerAnswer.blocked && !readLine.problem && !readLine.commandFailed ? judgeFix(fixerAnswer, readLine.values) : {}
  const read = readRelay(answer.printed, nonce, requiredKeys)
  if (!read.problem) return { ...answer, ...read, ...fixJudgement(answer, read) }

  // An agent that copied the line badly is asked once more, by an agent that only runs the printer: the printer reads the state that is there now, and the CRC and the nonce still guard the second line.
  log(`${label} relayed an unreadable line (${read.problem}); reading it once more: ${String(answer.printed).slice(0, 300)}`)
  const second = await safeAgent(`${A.delegatedLine}\n${RELAY_ASK}\n${relayCommand(step, ...relayArgs)}`, {
    label: `${label}-reread`, phase: phaseName,
    schema: { type: 'object', required: ['printed'], properties: { printed: PRINTED } },
    ...reread,
  })
  const secondRead = second ? readRelay(second.printed, nonce, requiredKeys) : read
  return secondRead.problem ? { ...answer, ...read } : { ...answer, printed: second.printed, ...secondRead, ...fixJudgement(answer, secondRead) }
}

function testGapProofGap(proof, finding) {
  if (!proof.passesAfter) return `a test-gap test for ${finding.where} did not pass after the fix`
  if (!(proof.test || '').trim()) return `a test-gap test for ${finding.where} has no text and named no mutation`
  return null
}

// A passing test-gap proof with neither a mutation nor a failing-before run: the raiser judges from the test text whether it names the mutation.
const namesNoMutationField = (proof, finding) => finding.kind === 'test-gap' && proof.passesAfter && !proof.failedBefore && !(proof.mutation || '').trim()

// Why the ci step could not read GitHub, or '' when it could: a network error or timeout, and the commands the rate limit refused on every try.
function unreachableReason(complete) {
  if (!complete.unreachable?.length) return ''
  const limitedNote = complete.limited?.length ? ` GitHub's rate limit refused ${complete.limited.join(', ')} on every try.` : ''
  return `GitHub is unreachable: ${complete.unreachable.join(', ')} failed with a network error, or timed out, after the retries a network error gets (a timeout is not retried).${limitedNote}`
}

// Why the CI read is pending: the names still waiting, or null when none waits.
function pendingReason(waiting) {
  const names = [...new Set(waiting)].map(name => `"${name}"`)
  return names.length ? `CI has not finished and the watcher's budget ended: ${names.join(', ')} still pending.` : null
}

// The word the history keeps for one CI read.
function ciVerdict(proven, pending) {
  if (proven) return 'GREEN'
  return pending ? 'PENDING' : 'RED'
}

// The printed values, not the watcher's word, decide whether CI counts as green; null means they prove it.
function unprovenGreen({ checks, rules }) {
  if (checks.code !== 0 || !checks.count) return `no checks are listed for the pull request head (gh pr checks exited ${checks.code}: ${checks.err ?? ''})`
  return [
    ...checks.open.map(c => `check "${c.name}" is ${c.bucket}, not pass or skipping`),
    ...Object.entries(rules.required || {}).filter(([, bucket]) => bucket !== 'pass').map(([name, bucket]) => bucket === 'missing' ? `required check "${name}" is missing from the listing` : `required check "${name}" is ${bucket}, not pass`),
  ].join('; ') || null
}

// A watcher that answers red without quoting a log leaves the fixer nothing to act on; the printed listing still names the red checks.
function failedCheckFindings(openChecks = []) {
  return openChecks.filter(c => c.bucket === 'fail').map(c => ({
    where: c.name, kind: 'defect', rule: `CI check ${c.name}`, text: `The check "${c.name}" is red, and the CI watcher quoted no log for it.`, evidence: `The relay's ci line lists "${c.name}" in the fail bucket; read its log with gh run view.`,
  }))
}

// Language models copy a 40-character hash unreliably (a sync step once dropped one character). A commit is
// accepted as 7 to 40 hex characters — git resolves an unambiguous prefix, and fixers often answer with the short form.
const SHA = /^[0-9a-f]{7,40}$/
const RUN_ID = /^[0-9a-f]{32}$/
// Two spellings name the same commit when the shorter is a prefix of the longer (git's own abbreviation rule).
const sameCommit = (a, b) => SHA.test(a || '') && SHA.test(b || '') && (a.startsWith(b) || b.startsWith(a))
// Whether the relayed HEAD is a merge whose first parent is base.
function mergedOnto(values, base) {
  const [firstParent, mergedIn] = values.parents.out.split('\n')
  return Boolean(mergedIn) && sameCommit(firstParent, base)
}
// The paths as one argument of unreserved characters only, so no quoting a copier applies to the command can change it: each path percent-encoded, joined by commas, with the slash kept.
const pathsArgument = (paths) => paths.map(path => encodeURIComponent(path).replace(/[!'()*]/g, char => '%' + char.codePointAt(0).toString(16).toUpperCase()).replaceAll('%2F', '/')).join(',')
