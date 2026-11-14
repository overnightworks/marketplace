// Builds the briefs of the sync and fix steps and owns the schemas of their reports, runs one printer command through an agent and returns the answer of the agent together with the CRC-checked values of the line it relays; for the fix step it judges the fixer's answer against the findings and fold-ins it answered, and for the ci step it reads those values and splits the failing checks into own and shared.
export async function laneRelay(A) {
  const { label, phase: phaseName, step, relayArgs, nonce, requiredKeys, agentOptions, reread } = A

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
  // relays HEAD's parents and whether its second parent is in origin/main, at most 50 paths and no text of aco brief but its exit code and error output, the sync step reports the lane tip, its parents and whether it contains origin/main, and the ci step reports the pull request head, the count of listed checks, the checks that are neither pass nor skipping, each required context of the base with its bucket or missing, the exit code of each gh call, left out when it is 0 and the call has nothing else to carry, and its error output where it is not empty, the paths among the failing findings of the watcher that the pull request changes (the lane passes the finding paths as the last argument but one; the file listing is paginated and never relayed), the exit code and error output of the head's workflow run listing, and the checks red on head that failed on the base tip too; a failed gh pr view ends its reads. A call that fails with a network marker is retried (see NETWORK_WAIT_SECONDS) and, still failing, puts its name into unreachable. Only when the verdict check (the check named quality / verdict) is red, the ci step also reads that job log with gh run view and relays two values of it, never its text: whether a line says that only declared loosenings made it red and only the operator merges it, and the quality merge command of its next line; the lines come in any order and carry a job name, a step and a timestamp before their text.
  // A git or gh call that fails with one of these untranslated network markers, or an aco brief call whose stdout JSON has the reason unreachable, is run again after this many seconds; the tests rewrite the constant to 0.
  const NETWORK_WAIT_SECONDS = 30
  // The printer waits at most twice, gives each call 60 s and stops retrying once its run nears 240 s, inside the 300 s Bash timeout RELAY_ASK asks for.
  const PRINTER = [
    'import json,re,shutil,subprocess,sys,time,zlib',
    'step,*rest,nonce=sys.argv[1:]',
    `wait=${NETWORK_WAIT_SECONDS}`,
    'start=time.monotonic();waits=[];unreachable=set()',
    'network=re.compile("Could not resolve host|Failed to connect to|check your internet connection or https://githubstatus.com")',
    'timed_out=lambda c:subprocess.CompletedProcess(c,124,"","timed out: "+c[0])',
    String.raw`exec("def typed(s):\n try:return json.loads(s).get(\"reason\")==\"unreachable\"\n except Exception:return False\ndef down(c,p):return typed(p.stdout) if c[:2]==(\"aco\",\"brief\") else bool(network.search(p.stderr))\ndef call(c):\n while 1:\n  try:p=subprocess.run(c,capture_output=True,text=True,timeout=max(5,min(60,240-time.monotonic()+start)))\n  except subprocess.TimeoutExpired:p=timed_out(c);p.down=1;return p\n  if p.returncode==0 or not down(c,p):return p\n  if len(waits)>1 or time.monotonic()-start+wait>=240:p.down=1;return p\n  waits.append(1);time.sleep(wait)")`,
    'run=lambda*c:call(c) if shutil.which(c[0]) else subprocess.CompletedProcess(c,127,"","not found: "+c[0])',
    'target=lambda repo:("-R",repo) if repo else ()',
    'api=lambda repo:"repos/"+(repo or "{owner}/{repo}")',
    'base=lambda r:json.loads(r["view"].stdout)["baseRefName"]',
    'steps=dict(scope=lambda item,branch:(("push",("git","push","origin",branch)),("remote",("git","rev-parse","origin/"+branch)),("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("second_parent_in_main",("git","merge-base","--is-ancestor","HEAD^2","origin/main")),("brief",("aco","brief",item,"--json"))),sync=lambda:(("head",("git","rev-parse","HEAD")),("parents",("git","rev-parse","HEAD^@")),("main",("git","merge-base","--is-ancestor","origin/main","HEAD"))),ci=lambda pr,repo,paths:(("view",("gh","pr","view",pr,"--json","headRefOid,baseRefName",*target(repo))),("changed",("gh","api",api(repo)+"/pulls/"+pr+"/files","--paginate","--slurp")),("headruns",lambda r:("gh","run","list","--commit",json.loads(r["view"].stdout)["headRefOid"],"--json","status,name","--limit","100",*target(repo))),("checks",("gh","pr","checks",pr,"--json","name,bucket,link",*target(repo))),("rules",lambda r:("gh","api",api(repo)+"/rules/branches/"+base(r))),("runs",lambda r:("gh","api",api(repo)+"/commits/"+base(r)+"/check-runs","--paginate","--slurp"))))',
    'ran={}',
    '[ran.__setitem__(n,run(*(c(ran) if callable(c) else c))) for n,c in steps[step](*rest) if "view" not in ran or ran["view"].returncode==0]',
    'verdict_jobs=[m[1] for c in (json.loads(ran["checks"].stdout) if step=="ci" and "checks" in ran and ran["checks"].returncode==0 else []) if c["name"]=="quality / verdict" and c["bucket"]=="fail" and (m:=re.search("/job/([0-9]+)",c.get("link") or ""))]',
    'ran.update({"log":run("gh","run","view","--job",verdict_jobs[0],*target(rest[1]),"--log")} if verdict_jobs else {})',
    'brief=json.loads(ran["brief"].stdout) if "brief" in ran and ran["brief"].returncode==0 else None',
    'claim=brief and brief["outside_claim"]',
    'values={n:{"code":p.returncode,**({"err":e} if ((e:=" ".join(l for l in p.stderr.splitlines() if l[:5]!="hint:")[-300:]) or step!="ci") and (n!="log" or p.returncode) else {}),**({} if n in("brief","view","checks","rules","runs","log","changed","headruns") else {"out":p.stdout.strip()[:100]})} for n,p in ran.items()}',
    'parsed=lambda n:json.loads(ran[n].stdout) if n in ran and ran[n].returncode==0 else None',
    'view,listing,rules,pages=parsed("view"),parsed("checks"),parsed("rules"),parsed("runs")',
    'listing=listing and sorted(listing,key=lambda c:(c["name"],c["bucket"]))',
    'latest_on_base={r["name"]:r for r in sorted((r for page in pages or [] for r in page["check_runs"] if r["status"]=="completed"),key=lambda r:(r.get("completed_at") or "",r["id"]))}',
    'failed_on_base={n for n,r in latest_on_base.items() if r["conclusion"]=="failure"}',
    'buckets={c["name"]:c["bucket"] for c in listing or []}',
    'contexts=None if rules is None else [c["context"] for r in rules if r["type"]=="required_status_checks" for c in r["parameters"]["required_status_checks"]]',
    'values.update({n:{**values[n],**x} for n,x in(("checks",None if listing is None else dict(count=len(listing),open=[dict(name=c["name"],bucket=c["bucket"]) for c in listing if c["bucket"] not in("pass","skipping")])),("rules",None if contexts is None else dict(required={c:buckets.get(c,"missing") for c in contexts}))) if x is not None})',
    'values.update(**(dict(head=view["headRefOid"],files=sorted(set(json.loads(rest[2])).intersection(f["filename"] for page in parsed("changed") or [] for f in page)),shared=[c["name"] for c in listing or [] if c["bucket"]=="fail" and c["name"] in failed_on_base]) if view else {}))',
    String.raw`values.update(**({"log":{**values["log"],"loosenings":any("only declared loosenings \u00b7 only the operator merges it" in l for l in ran["log"].stdout.splitlines()),"merge":next((m[1] for l in ran["log"].stderr.splitlines()+ran["log"].stdout.splitlines() if "next:" in l and (m:=re.search("(quality merge [A-Za-z0-9._-]+/[A-Za-z0-9._-]+#[0-9]+)",l))),"")}} if "log" in ran else {}))`,
    'values.update(nonce=nonce,**({"unreachable":sorted(n for n,p in ran.items() if getattr(p,"down",0))} if any(getattr(p,"down",0) for p in ran.values()) else {}),**(dict(outside_claim=claim[:50] if isinstance(claim,list) else claim,count=len(claim) if isinstance(claim,list) else None) if "brief" in ran else {}))',
    'values={n:v for n,v in values.items() if v!={"code":0}}',
    'payload=json.dumps(values,ensure_ascii=True,separators=(",",":"),sort_keys=True)',
    'print("""{"crc":"%08x","v":%s}"""%(zlib.crc32(payload.encode()),payload))',
  ].join(';')
  const relayCommand = (...relayArgs) => `cd '${A.worktree}' && python3 -c '${PRINTER}' ${relayArgs.join(' ')}`
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
      outside: { type: 'array', description: 'blocking findings and fold-ins you answered by editing the pull request body or posting an item comment, with no commit: a blocking finding by its number in the blocking list (finding), a fold-in by its where (foldIn), and the body section or comment URL', items: { type: 'object', required: ['where'], properties: { finding: { type: 'integer', minimum: 1 }, foldIn: { type: 'string' }, where: { type: 'string' } } } },
      regression: {
        type: 'array',
        description: "empty only when no blocking finding needs a proof; otherwise every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, under that finding's number in the blocking list you were given",
        items: { type: 'object', required: ['finding', 'test', 'failedBefore', 'passesAfter'], properties: { finding: { type: 'integer', minimum: 1, description: 'the number of the blocking finding in the list you were given' }, resolution: { type: 'string', enum: ['removed-vacuous'], description: 'for a test-gap finding whose test pins no behaviour: the fix removed that test instead of adding one' }, diff: { type: 'string', description: 'for removed-vacuous: the removal diff' }, test: { type: 'string' }, failedBefore: { type: 'boolean' }, passesAfter: { type: 'boolean' }, notRun: { type: 'string', description: 'why this machine could not run the test (a refused command, a machine another lane holds); CI on the pushed tip is its proof. Not for a test you ran and saw fail: that is passesAfter false' }, mutation: { type: 'string', description: 'for a test-gap finding: the production change, made and reverted, under which the test fails' } } },
      },
      summary: { type: 'string' }, blocked: { type: 'boolean' }, blockedReason: { type: 'string' },
    },
  }
  const SYNC_ANSWER = { properties: { note: { type: 'string', description: 'what stopped the merge: the conflicting paths, or the failed command and its output' } } }
  const git = `git -C '${A.worktree}'`

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
      `One that the pull request body or an item comment answers goes in outside with foldIn set to its where; commit nothing for it. When that leaves you nothing to change, change nothing:\n${foldIns}`
      : ''
    return (
      `${facts}\nYou are a fresh fixer for PR #${pr} (lane tip ${tip}). Merge origin/main if it moved, before or after your fixes (a merge commit; ` +
      `resolve conflicts so both sides' behaviour holds, and set mergeResolvedLaneConflict true when files this lane changed needed resolution). If the worktree already carries commits or uncommitted changes past that tip from an earlier fixer that ran out of turns, judge them, keep what is right, and continue from there. Commit each finding as soon as it is green. Then commit what is green and return what is left in blockedReason with blocked true. ${task}${foldInBrief}\n\n` +
      `Each finding names the rule it breaks and its evidence. A scanner finding whose message covers the whole file (for example "in this file") is fixed at every occurrence in that file, not only at the reported line. Check the evidence yourself first. If it does not hold — the rule is not broken, or the evidence is wrong — ` +
      `do not change code for it: list it in disputed with your counter-evidence. Report every test you add, strengthen or keep for a blocking finding, and every probe cell you run for it, in regression under that finding's number in the list above; the number counts only for the blocking list, a follow-up needs no regression entry. Run the mutation you name, do not reason about it. ` +
      `A defect's test fails before your fix and passes after it; a defect with a test draft needs one. A defect in test code (hygiene) needs no regression test: the diff is its proof. A test you could not run on this machine is reported with notRun, the reason, and passesAfter false is kept for a test you ran and saw fail; the delta re-check judges a not-run test from its text and CI on the pushed tip runs it. A test-gap finding means a behaviour has no test, the code is already right, and it always needs a test: it passes before and after, ` +
      `so name in mutation the production change, made and reverted, under which the test fails; a test that fails on the pre-fix code counts as such a mutation (failedBefore true). When a test-gap's cell pins no behaviour at all, you may remove it instead: report resolution removed-vacuous with the removal diff in diff. A docs finding needs no test. When the only finding is that the pull request conflicts with main, the merge is the whole fix. ` +
      `Otherwise one commit per finding. Push, patch the PR body where it became false or where a finding is about it (REST PATCH with --input, never gh pr edit --body-file); a finding the body or an item comment answers goes in outside under its number in finding, and commit nothing for it; run \`aco check ${pr}\` from the worktree. ` +
      `Return files: the output of \`${git} log --name-only --format= --first-parent --remerge-diff ${tip}..HEAD\` (of \`${git} diff --name-only ${tip}..HEAD\` when mergeResolvedLaneConflict is true). Last, whatever happened,`
    )
  }

  // What a proof still has to show for the finding it names, or null when it shows it. A test-gap's code was already
  // right, so its test passes after the fix and pins the behaviour when a mutation, or the pre-fix code, makes it fail.
  // A test that pins nothing may be removed instead, with its diff as the proof.
  function proofGap(proof, finding) {
    const kind = finding.kind
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
    const judged = (fixed.regression || []).flatMap(proof => blocking.map((finding, index) => ({ proof, finding, index })).filter(({ index }) => proves(proof, index)).map(({ finding, index }) => ({ proof, finding, index, gap: proofGap(proof, finding) })))
    const provenIndexes = new Set(judged.filter(({ gap }) => !gap).map(({ index }) => index))
    return judged.map(entry => ({ ...entry, proven: provenIndexes.has(entry.index) }))
  }

  // A removal answers a test-gap only if the reviewer agrees the removed test pinned nothing; a defect proof is judged by the defect bar.
  // A proof with a gap beside a valid proof for its finding reaches the raiser as a note, so it can judge whether the proof misleads.
  const removalNote = ({ proof, finding }) => `\nThe fixer answered ${finding.where} by removing a vacuous test instead of adding one; judge whether the removed test pinned no behaviour:\n${proof.diff}`
  const supportingNote = ({ proof, finding, gap }) => `\nThe fixer also offered the test ${proof.test} for ${finding.where}, though it shows less than the bar: ${gap}; judge whether it misleads.`
  // The half of a proof the fixer did not run, for the raiser to judge from the test's text; CI on the tip runs the test.
  const notRunNote = ({ proof, finding }) => {
    const mutation = (proof.mutation || '').trim()
    const namedMutation = mutation ? `"${mutation}"` : 'it names'
    const unrunHalf = finding.kind === 'test-gap' ? `fails under the mutation ${namedMutation}` : 'fails on the pre-fix code'
    return `\nThe fixer did not run the test ${proof.test} for ${finding.where} (${proof.notRun.trim()}); read its text and judge the half that was not run: it ${unrunHalf}.`
  }
  const proofNotes = (fixed, blocking) => judgedProofs(fixed, blocking).map(entry => {
    if (isNotRun(entry.proof) && needsProof(entry.finding)) return notRunNote(entry)
    if (entry.proof.resolution === 'removed-vacuous' && entry.finding.kind === 'test-gap' && !entry.gap) return removalNote(entry)
    return entry.gap && entry.proven ? supportingNote(entry) : ''
  }).join('')

  // The fixer's proofs judged against the blocking findings it was given, each with its kind: the rejection that stops the fix (the finding numbers it
  // names count from 1) or null, and the notes the raiser reads next to the delta.
  function judgeProofs(fixed, blocking) {
    // A proof red after the fix is evidence against the fix, even beside a valid proof.
    const gaps = judgedProofs(fixed, blocking).filter(checked => checked.gap && (!checked.proven || !checked.proof.passesAfter))
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
  const disputeFlakes = (fixed, blocking) => fixed.disputed.filter(d => blocking.some(f => f.where === d.where)).map(d => ({ where: d.where, text: `${d.text} (a flake; the fixer's counter-evidence: ${d.counterEvidence})`, owner: 'distributor' }))
  // The evidence the fixer gave for a fold-in it found already done, or undefined without any.
  const satisfiedEvidence = (fixed, foldIn) => (fixed.resolved || []).find(r => r.where === foldIn.where && (r.evidence || '').trim())?.evidence
  // An unchanged tip is a fix only when there are no blocking findings and every fold-in is proven already satisfied.
  const everyFoldInSatisfied = (fixed, blocking, foldIn) => !blocking.length && foldIn.length > 0 && foldIn.every(f => satisfiedEvidence(fixed, f))
  // An unchanged tip is a fix too when every blocking finding is answered in the pull request body or an item comment and every fold-in
  // is answered there or proven already satisfied; at least one answer outside the tree is what the re-check then reads.
  const answeredOutside = (fixed, blocking, foldIn) => {
    const answers = (fixed.outside || []).filter(o => (o.where || '').trim())
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
    if (fixed.unchanged) return (foldInsOnly && fixed.containsMain) || answeredOutside(fixed, blocking, foldIn) ? null : { reason: 'the fixer changed nothing', lastBlocking: blocking }
    const mergeWasTheFinding = A.source === 'CI' || (blocking.length === 1 && blocking[0].where === 'mergeable')
    if (fixed.mergeOnly && !mergeWasTheFinding && !foldInsOnly) return { reason: 'the fixer only merged main and fixed nothing', lastBlocking: blocking }
    return null
  }
  // A fixer may report absolute paths; an absolute path once hid a production change and skipped the gate.
  const worktreeRelative = (files) => files.map(f => f.startsWith(`${A.worktree}/`) ? f.slice(A.worktree.length + 1) : f.replace(/^\.\//, ''))

  // The facts of a fixer's answer against the tip it started from and the outcome they decide: flake, disputed, rejected or accepted.
  // The lane acts on the outcome and keeps its own state; the relay line is read and no git command failed before this runs.
  function judgeFix(answer, values) {
    const blocking = A.findings
    const foldIn = A.foldInEntries
    const heldTip = A.tip
    const facts = { ...answer, tip: values.head.out, heldTip, unchanged: sameCommit(values.head.out, heldTip), mergeOnly: mergedOnto(values, heldTip), containsMain: values.main.code === 0 }
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
      satisfied: everyFoldInSatisfied(fixed, blocking, foldIn),
      foldInEvidence: Object.fromEntries(foldIn.map(f => [f.where, satisfiedEvidence(fixed, f)]).filter(([, evidence]) => evidence)),
    }
  }

  // The sync step and the fix step have an agent that works before the printer runs: each brings its own brief and the schema of the report that brief asks for.
  const ANSWER_KINDS = {
    sync: { schema: SYNC_ANSWER, need: ['facts', 'hasLedgers', 'hasGenerated'], brief: syncBrief },
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
    const inChangedFile = entry => files.includes(String(entry.where).replace(/:\d+(:\d+)?$/, ''))
    return failing.filter(entry => inChangedFile(entry) || (!sharedEntries.has(JSON.stringify(entry)) && ![entry.where, String(entry.rule).replace(/^CI check /, '')].some(name => shared.includes(name))))
  }

  // What the lane reads from the ci step: the head, the checks red on the base branch too, the red a fixer may not remove, why the listing does not prove green,
  // and the watcher's verdict corrected by the printed listing: green, proven, the state in words, the failing checks split into own and shared.
  function readCi({ checks, rules, headruns, head, shared, files, log: jobLog }) {
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
    const rulesError = rules.code === 0 ? null : `gh api exited ${rules.code}: ${rules.err ?? ''}`
    const runsError = headruns.code === 0 ? null : `gh run list exited ${headruns.code}: ${headruns.err ?? ''}`
    const proven = green && !unproven && !rulesError && !runsError
    const names = (failing || []).map(f => `"${f.where}"`).join(', ')
    let state = 'not green'
    if (proven) state = 'green'
    else if (names) state = `red (${names})`
    return {
      head, shared, operatorDoor, failing, ownRed, green, unproven, rulesError, runsError, proven,
      sharedOnly: shared.length > 0 && ownRed.length === 0,
      state,
    }
  }

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
    // The printer leaves out an entry of the ci step that carries only exit code 0, so its absence reads as that code.
    const complete = step === 'ci' ? { view: { code: 0 }, runs: { code: 0 }, changed: { code: 0 }, headruns: { code: 0 }, ...values } : values
    const missing = requiredKeys.find(key => !complete[key])
    if (missing) return { problem: `lacks the ${missing} entry` }
    const commandFailed = complete.head && complete.main ? complete.head.code !== 0 || ![0, 1].includes(complete.main.code) : undefined
    return { values: complete, commandFailed, unreachable: complete.unreachable?.length ? `GitHub is unreachable: ${complete.unreachable.join(', ')} failed with a network error, or timed out, after the retries a network error gets (a timeout is not retried).` : '', ...(step === 'ci' && complete.view.code === 0 && { ci: readCi(complete) }) }
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
  if (proof.resolution === 'removed-vacuous') return (proof.diff || '').trim() ? null : `the removal of a vacuous test for ${finding.where} carried no diff`
  if (!proof.passesAfter) return `a test-gap test for ${finding.where} did not pass after the fix`
  return (proof.mutation || '').trim() || proof.failedBefore ? null : `a test-gap test for ${finding.where} named no mutation under which it fails and did not fail before the fix`
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
