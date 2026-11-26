// Drives the atelier lane workflow script with a stub agent runner; shared by the lane workflow tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// The generated bundle is the one script the Workflow runtime evaluates.
const LANE_BUNDLE = new URL('../plugins/atelier/workflows/lane.js', import.meta.url)
export const laneSource = () => fs.readFileSync(LANE_BUNDLE, 'utf8').replace(/^export const meta/m, 'const meta')
// Makes the named part of the bundle (laneBuild, laneCi, laneRelay, laneReview, laneRouting, laneTest) run the given statements first, so a test can break one part.
export const partReplaced = (part, statements) => (source) => {
  const declaration = `async function ${part}(A) {`
  if (!source.includes(declaration)) throw new Error(`the bundle has no part ${part}`)
  return source.replace(declaration, `${declaration}\n${statements}\n`)
}

// Stand-ins for the three programs the printer runs, steered by environment variables the harness sets for the child only.
const FAKE_GIT = `#!/bin/sh
case "$1 $2" in
  "push origin") [ -z "$FAKE_PUSH_ERROR" ] || { printf '%s\\n' "$FAKE_PUSH_ERROR" >&2; exit 1; } ;;
  "rev-parse --verify") [ "$FAKE_RESOLVE_CODE" = 0 ] || { printf 'fatal: Needed a single revision\\n' >&2; exit "$FAKE_RESOLVE_CODE"; }; full=\${3%'^{commit}'}; [ "$full" != HEAD ] || full=$FAKE_HEAD; while [ \${#full} -lt 40 ]; do full=\${full}0; done; printf '%s\\n' "$full" ;;
  "rev-parse HEAD") [ "$FAKE_HEAD_CODE" = 0 ] || { printf 'fatal: bad revision\\n' >&2; exit "$FAKE_HEAD_CODE"; }; printf '%s\\n' "$FAKE_HEAD" ;;
  "branch --show-current") [ "$FAKE_BRANCH_CODE" = 0 ] || { printf 'fatal: not a git repository\\n' >&2; exit "$FAKE_BRANCH_CODE"; }; printf '%s\\n' "$FAKE_BRANCH" ;;
  "rev-parse HEAD^@") printf '%s\\n' "$FAKE_PARENTS" ;;
  "rev-parse HEAD^{tree}") printf '%s\\n' "$FAKE_TREE" ;;
  "merge-tree --write-tree") printf '%s\\n' "$FAKE_MERGE_TREE"; exit "$FAKE_MERGE_TREE_CODE" ;;
  "-c core.quotePath=false") case "$3" in merge-tree) printf '%s\\n' "$FAKE_MERGE_TREE"; exit "$FAKE_MERGE_TREE_CODE" ;; log) printf '%s' "$FAKE_MERGE_PATHS" ;; esac ;;
  "log -p") for last; do :; done; case "$last" in *..HEAD) [ -z "$FAKE_TOUCHED" ] || printf -- '-removed in the range\\n' ;; *) printf '%s\\n' "$FAKE_TOUCHED" | grep -qxF -- "$last" && printf -- '-removed in %s\\n' "$last" ;; esac ;;
  "merge-base --is-ancestor") exit "$FAKE_MAIN_CODE" ;;
  "rev-parse origin/"*) printf '%s\\n' "$FAKE_REMOTE" ;;
esac
`
// A fake program counts its calls in a file beside itself; while FAKE_NETWORK_ERROR is set it prints that error (and FAKE_NETWORK_STDOUT on stdout) and fails its first FAKE_NETWORK_FAILS calls, or every call for 'always'.
const NETWORK_DOWN = `calls=$(( $(cat "$0.calls" 2>/dev/null || echo 0) + 1 )); echo "$calls" > "$0.calls"
if [ -n "$FAKE_NETWORK_ERROR" ] && { [ "$FAKE_NETWORK_FAILS" = always ] || [ "$calls" -le "$FAKE_NETWORK_FAILS" ]; }; then [ -z "$FAKE_NETWORK_STDOUT" ] || printf '%s\\n' "$FAKE_NETWORK_STDOUT"; printf '%s\\n' "$FAKE_NETWORK_ERROR" >&2; exit 1; fi
`
// api rate_limit costs no quota and counts apart from the other calls: the first FAKE_RATE_EXHAUSTED_CALLS calls show the core quota at zero with its reset FAKE_RATE_RESET_IN seconds ahead, later ones a refilled quota except call number FAKE_RATE_EXHAUSTED_AGAIN_AT, which shows it at zero again; FAKE_RATE_ERROR makes it fail.
// run view logs its arguments in a file beside the fake and prints the file FAKE_RUN_LOG, or fails with FAKE_RUN_VIEW_CODE.
export const FAKE_GH = `#!/bin/sh
if [ "$1 $2" = "api rate_limit" ]; then
  [ -z "$FAKE_RATE_ERROR" ] || { printf '%s\\n' "$FAKE_RATE_ERROR" >&2; exit 1; }
  rate_calls=$(( $(cat "$0.rate-calls" 2>/dev/null || echo 0) + 1 )); echo "$rate_calls" > "$0.rate-calls"
  if [ "$rate_calls" -le "$FAKE_RATE_EXHAUSTED_CALLS" ] || [ "$rate_calls" = "$FAKE_RATE_EXHAUSTED_AGAIN_AT" ]; then remaining=0; else remaining=5000; fi
  printf '{"resources":{"core":{"limit":5000,"remaining":%s,"reset":%s},"graphql":{"limit":5000,"remaining":5000,"reset":1}}}' "$remaining" "$(( $(date +%s) + FAKE_RATE_RESET_IN ))"
  exit 0
fi
${NETWORK_DOWN}fail() { printf '%s\\n' "$2" >&2; exit "$1"; }
case "$1 $2" in
  "run list") [ "$FAKE_RUNLIST_CODE" = 0 ] || fail "$FAKE_RUNLIST_CODE" "$FAKE_RUNLIST_ERROR"; printf '%s' "$FAKE_RUNLIST" ;;
  "run view") printf '%s\\n' "$*" >> "$0.run-view"; [ "$FAKE_RUN_VIEW_CODE" = 0 ] || fail "$FAKE_RUN_VIEW_CODE" "HTTP 410: logs expired"; cat "$FAKE_RUN_LOG" ;;
  "pr checks") [ "$FAKE_CHECKS_CODE" = 0 ] || fail "$FAKE_CHECKS_CODE" "$FAKE_CHECKS_ERROR"; printf '%s' "$FAKE_CHECKS" ;;
  "pr ready") [ "$FAKE_READY_CODE" = 0 ] || fail "$FAKE_READY_CODE" "\${FAKE_READY_ERROR:-the draft could not be marked ready}"; printf '%s\\n' "$3" >> "$0.readied" ;;
  "api -X") [ "$FAKE_PATCH_CODE" = 0 ] || fail "$FAKE_PATCH_CODE" "\${FAKE_PATCH_ERROR:-the title write was refused}"; printf '%s\\n' "$6" >> "$0.patched" ;;
  "api repos/"*) [ "$4" != .body ] || { [ "$FAKE_ITEM_CODE" = 0 ] || fail "$FAKE_ITEM_CODE" "$FAKE_ITEM_ERROR"; printf '%s\\n' "$FAKE_ITEM_BODY"; exit 0; }
    [ "$4" != "{title:.title,draft:.draft}" ] || { [ -z "$FAKE_PR_MALFORMED" ] || { printf '%s' "$FAKE_PR_MALFORMED"; exit 0; }; printf '{"title":%s,"draft":%s}' "$FAKE_PR_TITLE_JSON" "$FAKE_PR_DRAFT"; exit 0; }
    [ "$4" != .title ] || { case "$2" in */pulls/*) printf '%s\\n' "$FAKE_PR_TITLE" ;; *) printf '%s\\n' "$FAKE_ITEM_TITLE" ;; esac; exit 0; }
    case "$2" in
    */rules/branches/main) [ "$FAKE_RULES_CODE" = 0 ] || fail "$FAKE_RULES_CODE" "$FAKE_RULES_ERROR"; printf '%s' "$FAKE_RULES" ;;
    */pulls/*/files) [ "$FAKE_CHANGED_CODE" = 0 ] || fail "$FAKE_CHANGED_CODE" "$FAKE_CHANGED_ERROR"; printf '%s' "$FAKE_FILES" ;;
    */pulls/[0-9]*) [ "$FAKE_VIEW_CODE" = 0 ] || fail "$FAKE_VIEW_CODE" "$FAKE_VIEW_ERROR"; printf '{"baseRefName":"main","headRefOid":"%s"}' "$FAKE_PR_HEAD" ;;
    */commits/main/check-runs) printf '%s' "$FAKE_BASE_RUNS" ;;
    *) fail 1 "unexpected gh api path $2" ;;
  esac ;;
  *) fail 1 "unexpected gh call $*" ;;
esac
`
// aco lane-record reads no network: check prints the file path on success and FAKE_RECORD_ERROR makes it refuse the file, as aco does; begin and add log their arguments in a file beside the fake and
// FAKE_BEGIN_ERROR and FAKE_ADD_ERROR make them refuse, as aco does; show prints FAKE_SHOW_OUTPUT with the run id of the logged begin in place of @RUN@, or fails with FAKE_SHOW_CODE and FAKE_SHOW_ERROR.
export const FAKE_ACO = `#!/bin/sh
logged() { printf '%s\\n' "$*" >> "$0.lane-record"; }
refuse() { logged "$@"; [ -z "$FAKE_REFUSAL" ] || { printf '%s\\n' "$FAKE_REFUSAL" >&2; exit 2; }; }
case "$1 $2" in
  "lane-record check") [ -z "$FAKE_RECORD_ERROR" ] || { printf '%s\\n' "$FAKE_RECORD_ERROR" >&2; exit 2; }; printf 'lane record %s\\n' "$3"; exit 0 ;;
  "lane-record begin") FAKE_REFUSAL=$FAKE_BEGIN_ERROR refuse "$@"; printf 'BEGAN run\\n'; exit 0 ;;
  "lane-record show") [ "$FAKE_SHOW_CODE" = 0 ] || { printf '%s\\n' "$FAKE_SHOW_ERROR" >&2; exit "$FAKE_SHOW_CODE"; }; run=$(sed -n 's/.* --run \\([0-9a-f-]*\\).*/\\1/p' "$0.lane-record" | tail -1); printf '%s' "$FAKE_SHOW_OUTPUT" | sed "s/@RUN@/$run/g"; exit 0 ;;
  "lane-record add") FAKE_REFUSAL=$FAKE_ADD_ERROR refuse "$@"; printf 'ADDED run\\n'; exit 0 ;;
esac
${NETWORK_DOWN}[ -z "$FAKE_BRIEF_ERROR" ] || printf '%s\\n' "$FAKE_BRIEF_ERROR" >&2
printf '%s' "$FAKE_BRIEF_OUTPUT"
[ -z "$FAKE_BRIEF_ERROR" ]
`
// The marker lines and the brief between them in a Codex courier prompt.
export const courierBriefOf = (prompt) => {
  const [, start, brief, end] = prompt.match(/^(BRIEF-START \S+)\n([\s\S]*)\n(BRIEF-END \S+)\n3\. /m)
  return { start, brief, end }
}

export const installFake = (directory, program, script) => fs.writeFileSync(path.join(directory, program), script, { mode: 0o755 })

// Runs a command line the way the agent does and returns what it printed (its error output when it printed nothing).
export const runCommandLine = (line, { cwd, env, shell = 'sh' }) => {
  const ran = spawnSync(shell, ['-c', line], { cwd, env, encoding: 'utf8' })
  return (ran.stdout || ran.stderr).trim()
}

// The fake gh's answer to a read of the item body.
const itemEnvironment = (scenario) => ({ FAKE_ITEM_BODY: scenario.item_body ?? '', FAKE_ITEM_CODE: scenario.item_code ?? 0, FAKE_ITEM_ERROR: scenario.item_error ?? '' })
// The fake gh's answers to the reads and writes of the pull request: its title and draft flag, the title write and the ready call.
const pullEnvironment = (scenario) => ({
  FAKE_PR_TITLE: scenario.pr_title ?? 'Add the feature', FAKE_PR_TITLE_JSON: JSON.stringify('pr_title' in scenario ? scenario.pr_title : 'Add the feature'), FAKE_ITEM_TITLE: scenario.item_title ?? 'The item title', FAKE_PATCH_CODE: scenario.patch_code ?? 0, FAKE_PATCH_ERROR: scenario.patch_error ?? '',
  FAKE_PR_MALFORMED: scenario.pull_output ?? '', FAKE_PR_DRAFT: 'draft' in scenario ? scenario.draft : false, FAKE_READY_CODE: scenario.ready_code ?? 0, FAKE_READY_ERROR: scenario.ready_error ?? '',
})
// What `aco brief --json` prints: the claim's outside paths and, when the scenario lists touched surfaces, those too (an absent key is an older aco).
const briefOutput = (scenario) => JSON.stringify({ outside_claim: 'outside_claim' in scenario ? scenario.outside_claim : [], ...('touched_surfaces' in scenario && { touched_surfaces: scenario.touched_surfaces }) })
// The lines a fake command appended to its log, or none.
const loggedLines = (fakeBin, name) => fakeBin && fs.existsSync(path.join(fakeBin, name)) ? fs.readFileSync(path.join(fakeBin, name), 'utf8').trim().split('\n') : []
// How many times each fake program was called.
const callsOf = (fakeBin) => Object.fromEntries(['aco', 'gh'].map(program => [program, fakeBin && fs.existsSync(path.join(fakeBin, `${program}.calls`)) ? Number(fs.readFileSync(path.join(fakeBin, `${program}.calls`), 'utf8')) : 0]))
// The printer line a scenario's typedCommand rewrites; a reread keeps the line unless the scenario types it always.
const typedLine = (scenario, reread, line) => scenario.typedCommand && (!reread || scenario.typedAlways) ? scenario.typedCommand(line) : line

// A fresh context holds only the ECMAScript built-ins, so a script naming a Node or web global fails with a ReferenceError as in the Workflow runtime.
// An unmodified bundle is named after its file and the wrapper's first line is cut off, so the coverage run attributes lines to the bundle.
const compileLane = (body, transformed) => new vm.Script(`(async function (args, agent, parallel, pipeline, phase, log) {\n${body}\n})`, transformed ? {} : { filename: fileURLToPath(LANE_BUNDLE), lineOffset: -1 }).runInContext(vm.createContext({}))

// answers holds each agent's result by its label; an agent without one ends without a result. Without answers only
// the sync step answers (an up-to-date lane), so a run gets as far as starting its first review round.
// options.transform rewrites the bundle source, so a test can break one part of it (partReplaced) or change one constant.
export async function runLane(args, answers = {}, options = {}) {
  const source = (options.transform ?? ((text) => text))(laneSource())
  const launchedAgents = []
  const launchedPrompts = []
  const agentCalls = {}
  const isFixer = (label) => label.startsWith('fix-')
  const REREAD = '-reread'
  const LIMIT_PROBE = 'limit-probe-'
  // A rate-limit wait agent answers with the scenario of the relay agent it waits for.
  const baseLabel = (label) => (label.endsWith(REREAD) ? label.slice(0, -REREAD.length) : label).replace(/-wait-\d+$/, '')
  const isRelayed = (label) => /^(branch|begin|add|sync|scope-|ci-read-|fix-|checkpoint-|record-|retitle)/.test(baseLabel(label))
  const defaultAnswerFor = (label) => label.startsWith(LIMIT_PROBE) ? 'ok' : isRelayed(label) && !isFixer(label) ? {} : null
  // The branch carries the newest tip a builder, fixer or sync returned. A scope, sync or fixer answer says what the fake
  // git and aco print (scope: push_error, remote_tip, brief_error, outside_claim; sync and fixer: head, parents, head_code,
  // main_code; a fixer's answer also holds its own report, which is returned with the printed line) and how the agent mishandled the printed line (nonce, edit, printed, printerMode: the printer mode it ran instead); the line itself always comes from
  // running the real printer the prompt carries. Without answers a sync leaves an up-to-date lane as it is.
  let newestTip = args.tip
  const writtenRecords = []
  // The seconds each rate-limit wait printed as slept; the printer's own sleep is skipped, so no test waits on the wall clock.
  const rateLimitSleeps = []
  let fakeBin
  const fakeCommands = () => {
    if (!fakeBin) {
      fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-fake-'))
      installFake(fakeBin, 'git', FAKE_GIT)
      installFake(fakeBin, 'aco', FAKE_ACO)
      installFake(fakeBin, 'gh', FAKE_GH)
    }
    return fakeBin
  }
  // The gh side of a ci-read answer: pr_head, view_code/view_error, checks (the listing), checks_code/checks_error, required
  // (the contexts of the rules), rules_code/rules_error and base_runs (the base tip's check runs, one page each).
  const ghEnv = (scenario) => ({
    FAKE_PR_HEAD: scenario.pr_head ?? newestTip, FAKE_VIEW_CODE: scenario.view_code ?? 0, FAKE_VIEW_ERROR: scenario.view_error ?? '',
    FAKE_CHECKS: JSON.stringify(scenario.checks ?? []), FAKE_CHECKS_CODE: scenario.checks_code ?? 0, FAKE_CHECKS_ERROR: scenario.checks_error ?? '',
    FAKE_RULES: JSON.stringify([{ type: 'deletion' }, { type: 'required_status_checks', parameters: { required_status_checks: (scenario.required ?? []).map(context => ({ context })) } }]),
    FAKE_RULES_CODE: scenario.rules_code ?? 0, FAKE_RULES_ERROR: scenario.rules_error ?? '',
    FAKE_FILES: JSON.stringify(Array.from({ length: Math.ceil((scenario.changed_files ?? []).length / 100) }, (_, page) => scenario.changed_files.slice(page * 100, page * 100 + 100).map(filename => ({ filename })))),
    FAKE_CHANGED_CODE: scenario.changed_code ?? 0, FAKE_CHANGED_ERROR: scenario.changed_error ?? '',
    FAKE_RUNLIST: JSON.stringify(scenario.head_runs ?? []), FAKE_RUNLIST_CODE: scenario.runlist_code ?? 0, FAKE_RUNLIST_ERROR: scenario.runlist_error ?? '',
    FAKE_BASE_RUNS: JSON.stringify((scenario.base_runs ?? []).map(run => ({ check_runs: [run] }))),
  })
  // A ci-read answer defaults to the world the same round's watcher answer describes with its head, checks, requiredChecks and baseChecks, which the lane must not read from the watcher.
  const ciWorldOf = (label) => {
    const watcher = answers[label.replace('ci-read-', 'ci-')]
    return watcher && typeof watcher === 'object' ? { pr_head: watcher.head, checks: watcher.checks, required: watcher.requiredChecks, base_runs: watcher.baseChecks, changed_files: watcher.changedFiles } : {}
  }
  // The record courier's command as the agent runs it: its brief is cut out of a transcript of the courier (in a home of its own) into the scratch directory (a temporary one in place of the lane's), and the file it wrote is kept for the test.
  const recordDirectories = []
  const recordPrinted = (prompt, line, env, scenario) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-record-'))
    recordDirectories.push(directory)
    const transcript = path.join(directory, 'home/.claude/projects/p/s/subagents/workflows/w/agent-courier.jsonl')
    fs.mkdirSync(path.dirname(transcript), { recursive: true })
    fs.writeFileSync(transcript, `${JSON.stringify({ message: { content: prompt } })}\n`)
    const scratch = path.join(directory, 'scratch')
    // The lane's own working directory is absent here; the word boundary keeps a token ending in "cd" from being read as that command.
    const command = line.replace(/\bcd '[^']*' && /, '').replaceAll(`'${args.scratch}'`, `'${scratch}'`).replaceAll(`'${args.scratch}/`, `'${scratch}/`)
    const printed = runCommandLine(scenario.record_command ? scenario.record_command(command) : command, { cwd: os.tmpdir(), shell: 'bash', env: { ...env, HOME: path.join(directory, 'home') } })
    const file = path.join(scratch, 'lane-record.json')
    if (fs.existsSync(file)) writtenRecords.push(fs.readFileSync(file, 'utf8'))
    return printed
  }
  // The runs the lane run has stored so far, as aco lists them: each add of the log with the record it stored. Without a stored_runs answer, a begin's read of the claim lists them before its own run.
  const storedBefore = () => {
    const log = path.join(fakeBin, 'aco.lane-record')
    const adds = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('lane-record add ')) : []
    return adds.map((line, index) => {
      const words = line.split(' ')
      const valueOf = (option) => words[words.indexOf(option) + 1]
      return { run: valueOf('--run'), start_tip: null, follows: true, end_tip: valueOf('--end-tip'), ran: words.slice(words.indexOf('--ran') + 1), record: JSON.parse(writtenRecords[index]) }
    })
  }
  const printedBy = (prompt, scenario, reread, label) => {
    if ('printed' in scenario) return scenario.printed
    const line = prompt.split('\n').at(-1).replace(/^cd '[^']*' && /, '')
    const env = {
      ...process.env, PATH: `${fakeCommands()}:${process.env.PATH}`, FAKE_HEAD: scenario.head ?? newestTip, FAKE_BRANCH: scenario.branch ?? args.branch, FAKE_BRANCH_CODE: scenario.branch_code ?? 0, FAKE_REMOTE: scenario.remote_tip ?? newestTip,
      FAKE_HEAD_CODE: scenario.head_code ?? 0, FAKE_PARENTS: (scenario.parents ?? []).join('\n'), FAKE_MAIN_CODE: scenario.main_code ?? 0, FAKE_TREE: scenario.tree ?? 'a1a1a1a1', FAKE_MERGE_TREE: scenario.merge_tree ?? scenario.tree ?? 'a1a1a1a1', FAKE_MERGE_TREE_CODE: scenario.merge_tree_code ?? 0, FAKE_TOUCHED: (scenario.touched_paths ?? []).join('\n'), FAKE_MERGE_PATHS: (scenario.merge_paths ?? []).join('\n'),
      FAKE_PUSH_ERROR: scenario.push_error ?? '', FAKE_NETWORK_ERROR: scenario.network_error ?? '', FAKE_NETWORK_STDOUT: scenario.network_stdout ?? '', FAKE_NETWORK_FAILS: scenario.network_fails ?? 1, FAKE_BRIEF_ERROR: scenario.brief_error ?? '', FAKE_RATE_EXHAUSTED_CALLS: scenario.rate_exhausted_calls ?? 0, FAKE_RATE_EXHAUSTED_AGAIN_AT: scenario.rate_exhausted_again_at ?? 0, FAKE_RATE_RESET_IN: scenario.rate_reset_in ?? 600, FAKE_RATE_ERROR: scenario.rate_error ?? '',
      ...itemEnvironment(scenario), FAKE_RECORD_ERROR: scenario.record_error ?? '', FAKE_BEGIN_ERROR: scenario.begin_error ?? '', FAKE_ADD_ERROR: scenario.add_error ?? '', FAKE_SHOW_CODE: scenario.show_code ?? 0, FAKE_SHOW_ERROR: scenario.show_error ?? '', FAKE_SHOW_OUTPUT: JSON.stringify({ runs: scenario.stored_runs ?? [...storedBefore(), storedOwnRun()] }), FAKE_RESOLVE_CODE: scenario.resolve_code ?? 0, ...pullEnvironment(scenario), FAKE_BRIEF_OUTPUT: briefOutput(scenario), ...ghEnv(scenario),
    }
    if (label.startsWith('record-')) return recordPrinted(prompt, line, env, scenario)
    const sleepless = line.replace('time.sleep(slept)', '0')
    if (sleepless === line) throw new Error(`the printer line of ${label} no longer holds time.sleep(slept), so the harness cannot skip its sleep`)
    const typed = typedLine(scenario, reread, sleepless)
    const asked = scenario.printerMode ? typed.replace(/' scope .* ('[^']*')$/, `' ${scenario.printerMode} $1`) : typed
    const printed = runCommandLine(scenario.nonce ? asked.replace(/'[^']*'$/, `'${scenario.nonce}'`) : asked, { cwd: os.tmpdir(), env })
    return scenario.edit ? scenario.edit(printed) : printed
  }
  // A -reread agent is the printer-only second read of a relay line: it answers its own label, else repeats its relay agent's scenario, and returns the printed line only.
  const answerFor = (label, prompt) => {
    const base = baseLabel(label)
    const reread = label.endsWith(REREAD)
    const given = label in answers ? answers[label] : base in answers ? answers[base] : defaultAnswerFor(base)
    if (typeof given === 'function') return reread ? { printed: given(prompt).printed } : given(prompt)
    const answer = isRelayed(label) && given ? { ...(base.startsWith('ci-read-') ? ciWorldOf(base) : {}), ...given } : structuredClone(given)
    if (answer?.tip && label === 'build') newestTip = answer.tip
    if (!isRelayed(label) || !answer) return answer
    const printed = printedBy(prompt, answer, reread, label)
    if (/-wait-\d+$/.test(label)) rateLimitSleeps.push(JSON.parse(printed).v.slept)
    if (answer.head && !base.startsWith('scope-')) newestTip = answer.head
    const { pr_title: _prTitle, item_title: _itemTitle, item_body: _itemBody, item_code: _itemCode, item_error: _itemError, patch_code: _patchCode, draft: _draft, ready_code: _readyCode, ready_error: _readyError, patch_error: _patchError, pr_head: _prHead, checks: _checks, required: _required, base_runs: _baseRuns, changed_files: _changedFiles, changed_code: _changedCode, changed_error: _changedError, head_runs: _headRuns, runlist_code: _runlistCode, runlist_error: _runlistError, head: _head, parents: _parents, head_code: _headCode, branch_code: _branchCode, main_code: _mainCode, touched_paths: _touchedPaths, touched_surfaces: _touchedSurfaces, nonce: _nonce, edit: _edit, typedCommand: _typedCommand, typedAlways: _typedAlways, printerMode: _printerMode, push_error: _pushError, network_error: _networkError, network_fails: _networkFails, remote_tip: _remoteTip, brief_error: _briefError, rate_exhausted_calls: _rateExhaustedCalls, rate_exhausted_again_at: _rateExhaustedAgainAt, rate_reset_in: _rateResetIn, rate_error: _rateError, outside_claim: _outsideClaim, printed: _printed, ...report } = answer
    return reread ? { printed } : { ...report, printed }
  }
  // The worktree check and the begin of the run come before every lane's work and the add and the record courier after every lane that leaves one, so the launch lists hold only the agents between them; agentCalls keeps both.
  // options.killAt names the agent whose launch ends the run: the Workflow runtime stops there, so every later agent and the script itself never answer.
  let killed = false
  let endRun
  const runEnded = new Promise(resolve => { endRun = resolve })
  const agent = async (prompt, agentOptions = {}) => { if (killed || agentOptions.label === options.killAt) { killed = true; endRun(); return new Promise(() => {}) } if (![WORKTREE_CHECK, 'begin', 'add'].includes(agentOptions.label) && !agentOptions.label.startsWith('record-') && !agentOptions.label.startsWith(LIMIT_PROBE)) { launchedAgents.push(agentOptions.label); launchedPrompts.push(prompt) } agentCalls[agentOptions.label] = { prompt, options: structuredClone(agentOptions) }; return answerFor(agentOptions.label, prompt) }
  // A thunk that throws resolves to null, as in the Workflow runtime.
  const parallel = async thunks => Promise.all(thunks.map(thunk => thunk().catch(() => null)))
  const ignore = () => {}
  try {
    const result = await Promise.race([compileLane(source, options.transform)(args, agent, parallel, async () => [], ignore, ignore), runEnded])
    return { killed, result: structuredClone(result), patchedTitles: loggedLines(fakeBin, 'gh.patched'), readiedPulls: loggedLines(fakeBin, 'gh.readied'), laneRecordCalls: loggedLines(fakeBin, 'aco.lane-record').map(line => line.split(' ')), calls: callsOf(fakeBin), launchedAgents, launchedPrompts, agentCalls, writtenRecords, rateLimitSleeps }
  } finally {
    if (fakeBin) fs.rmSync(fakeBin, { recursive: true })
    recordDirectories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
  }
}

// The lane's record as aco computes it from the runs a lane run stored (aco's specs/lane-record.spec.md, LANREC-77 to LANREC-83): the counts summed, the verdicts joined in order, each stage the choice of the last run that ran it.
// The records written after the last add belong to no stored run.
export const storedLane = (run) => {
  const stored = run.writtenRecords.slice(0, run.laneRecordCalls.filter(call => call[1] === 'add').length).map(text => JSON.parse(text))
  const summed = (kind) => Object.fromEntries(['review', 'gate', 'ci', 'test'].map(stage => [stage, stored.reduce((total, record) => total + (record[kind]?.[stage] ?? 0), 0)]))
  const stageChoice = (stage) => stored.map(record => record.stages[stage]).filter(choice => choice !== 'none').at(-1) ?? 'none'
  const { version, risk, experiment } = stored.at(-1)
  return { version, stages: Object.fromEntries(Object.keys(stored[0].stages).map(stage => [stage, stageChoice(stage)])), fix_rounds: summed('fix_rounds'), blocking: summed('blocking'), misses: summed('misses'), verdicts: stored.flatMap(record => record.verdicts), risk, ...(experiment && { experiment }) }
}

// The runs `aco lane-record show --json` lists for the claim: this run's own entry (the printer's run id replaces @RUN@) and the earlier runs with the review verdicts their stored records hold.
export const storedOwnRun = (follows = true) => ({ run: '@RUN@', start_tip: null, follows, end_tip: null, ran: null, record: null })
const storedVerdictsRun = (stage, ran) => (...verdicts) => ({ run: 'earlier-run', start_tip: null, follows: true, end_tip: 'f0'.repeat(20), ran, record: { version: 1, verdicts: verdicts.map(([verdict, sha]) => ({ stage, verdict, sha })) } })
export const storedEarlierRun = storedVerdictsRun('review', ['build', 'review'])
export const storedGateRun = storedVerdictsRun('gate', ['review', 'gate'])

export const WORKTREE_CHECK = 'branch'

export const resumedLane = { item: 1, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', pr: 1, tip: 'abcdef0' }

export const APPROVE = { verdict: 'APPROVE', blocking: [], followups: [] }

export const PASS = { verdict: 'PASS', blocking: [], followups: [], cells: [{ cell: 'drives the entry point', result: 'held', command: 'run it', exit: '0' }] }

export const greenCi = (head) => ({ head, green: true, failing: [], checks: [{ name: 'quality / verdict', bucket: 'pass' }], requiredChecks: ['quality / verdict'] })

export const finding = (where, text) => ({ where, text, rule: 'recorded rule', evidence: 'recorded evidence' })

export const followup = (where, text, owner, inPlace) => ({ where, text, owner, ...(inPlace !== undefined && { inPlace }) })

export const builtReuse = 'extended lane/review.js reviewerBrief'
export const webauthTips = { built: '7ac1653ab10c05e6b41a393d47a586a2bacb9640', firstFix: 'd7e50a7509ea87793fed5bdbabcf7df3955bc893', secondFix: '307742391d346d4579400c733ef7adbdeea5ef79' }

export const webauthC1Finding = 'src/webauth/jwt_verification.py:65 (_URL_CONTROL_OR_SPACE) via is_https_url, reached through OidcClientConfig.__post_init__ (src/webauth/oidc.py:73-92)'

export const webauthReplay = {
  name: 'webauth#57',
  args: { item: 57, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r1-gate', fixedBy: 'fix-2', number: 3, where: 'tests/test_oidc.py:479', mutation: 'drop quote_plus from the client-ID part of the Basic authorization only' },
  nextReview: 'r2-review',
  // The fix-in-place follow-ups by the fix that carried them, and how many follow-ups the head still routes when the lane is ready.
  foldIns: {
    accepted: {
      folded: [['src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', webauthTips.firstFix], ['README.md:433-434 (OpenID Connect login paragraph)', webauthTips.firstFix], ['src/webauth/jwt_verification.py:365-372 (is_https_url)', webauthTips.secondFix]],
      open: [],
    },
    stopped: {
      folded: [['src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', webauthTips.firstFix], ['README.md:433-434 (OpenID Connect login paragraph)', webauthTips.firstFix]],
      open: ['src/webauth/jwt_verification.py:365-372 (is_https_url)'],
    },
  },
  followupsToRoute: 3,
  answers: {
    build: { pr: 58, tip: webauthTips.built, reuse: builtReuse, blocked: false },
    'r0-review': {
      verdict: 'REVISE',
      blocking: [
        finding('src/webauth/oidc.py:340-356 (_is_same_secret, _callback_parameters) via OidcRelyingParty.complete_login', 'complete_login raises UnicodeEncodeError on a hostile callback'),
        finding('tests/test_oidc.py:70-72, 463-476 (token request test) and 230-291 (_CALLBACK_REFUSALS)', 'Two behaviours this diff implements have no test that pins them'),
      ],
      followups: [
        followup('src/webauth/oidc.py:130-133 (TokenEndpointAnswer)', 'Follow-up (fix in place): the default repr prints the whole token body', '#57', true),
        followup('README.md:433-434 (OpenID Connect login paragraph)', 'Follow-up (fix in place): the README leaves out that any azp must name the client', '#57', true),
        followup("CLAUDE.md 'Code patterns'", 'The guidance names only one of the two arrangement modules', 'distributor'),
        followup('AGENTS.md:35-38 / .importlinter', 'The import claims are not enforced', '#49'),
      ],
    },
    'r0-gate': { verdict: 'REVISE', blocking: [finding('src/webauth/oidc.py:315', 'OidcClientConfig accepts endpoint URLs containing control characters')], followups: [], codexExit: 0 },
    'fix-1': {
      head: webauthTips.firstFix, mergeResolvedLaneConflict: true, disputed: [], blocked: false,
      files: ['README.md', 'pyproject.toml', 'src/webauth/__init__.py', 'src/webauth/config.py', 'src/webauth/jwt_verification.py', 'src/webauth/liveness.py', 'src/webauth/oidc.py', 'tests/test_jwt_verification.py', 'tests/test_liveness.py', 'tests/test_oidc.py', 'tests/test_web_auth_config.py', 'uv.lock'],
      regression: [
        { finding: 1, test: 'tests/test_oidc.py [lone-surrogate-not-percent-encoded]', failedBefore: true, passesAfter: true },
        { finding: 2, test: 'tests/test_oidc.py [secret-form-encoded-before-basic-encoding]', failedBefore: true, passesAfter: true },
        { finding: 3, test: 'tests/test_oidc.py [redirect-uri-with-a-carriage-return-in-its-path]', failedBefore: true, passesAfter: true },
      ],
    },
    'r1-review': {
      verdict: 'REVISE',
      blocking: [finding(webauthC1Finding, 'C1 control characters are still accepted and stored')],
      followups: [
        followup('src/webauth/jwt_verification.py:365-372 (is_https_url)', 'follow-up (fix in place). A non-str argument now raises a bare TypeError', '#57', true),
        followup('overnightworks/webauth#57 body, claim-scope line for src/webauth/jwt_verification.py', 'The body says this lane only renames the function', '#57'),
      ],
    },
    'r1-gate': {
      verdict: 'REVISE', codexExit: 0, followups: [],
      blocking: [
        finding('src/webauth/jwt_verification.py:65', 'Endpoint validation still accepts C1 controls U+0080–U+009F'),
        finding('tests/test_oidc.py:479', 'The Basic-auth regression test does not pin the form-encoding of client_id'),
      ],
    },
    'fix-2': {
      head: webauthTips.secondFix, mergeResolvedLaneConflict: false, disputed: [], blocked: false,
      files: ['src/webauth/jwt_verification.py', 'src/webauth/oidc.py', 'tests/test_jwt_verification.py', 'tests/test_oidc.py'],
      regression: [
        { finding: 1, test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 2, test: 'tests/test_oidc.py [redirect-uri-with-a-c1-control-character]', failedBefore: true, passesAfter: true },
        { finding: 3, test: 'tests/test_oidc.py [client-id-form-encoded-before-basic-encoding]', failedBefore: false, passesAfter: true },
        { finding: 4, test: 'tests/test_jwt_verification.py [key-set-url-not-a-string]', failedBefore: true, passesAfter: true },
      ],
    },
    'r2-review': APPROVE,
    'r2-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(webauthTips.secondFix),
  },
}

export const agentProvidersTips = { built: 'adfb04bc5b1f543f6060709047570d92550f905d', fix: '7c543ba55440b4d743eecf18aa9a1520aadeda55' }

export const agentProvidersReplay = {
  name: 'agent-providers#25',
  args: { item: 25, worktree: '/w', branch: 'b', contract: 'c', e2e: 'e', scratch: '/s', build: 'recorded', risk: 'material' },
  testGap: { raisedBy: 'r0-gate', fixedBy: 'fix-1', number: 1, where: 'tests/test_sse_codec.py:58', mutation: 'encode_event writes the event line before the id line' },
  nextReview: 'r1-gate',
  foldIns: {
    accepted: {
      folded: [['packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', agentProvidersTips.fix], ['docs/decisions/0001-agent-service.md:238-246 (ruling f)', agentProvidersTips.fix]],
      open: [],
    },
    stopped: {
      folded: [],
      open: ['packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', 'docs/decisions/0001-agent-service.md:238-246 (ruling f)'],
    },
  },
  followupsToRoute: 4,
  answers: {
    build: { pr: 26, tip: agentProvidersTips.built, reuse: builtReuse, blocked: false },
    'r0-review': {
      verdict: 'APPROVE', blocking: [],
      followups: [
        followup('packages/agent-client/src/agent_client/wire.py:92 and :100 (ToolCall.tool_use_id, ToolResult.tool_use_id)', 'follow-up (fix in place). The valid tool_use_id rule is declared twice', 'follow-up (fix in place)', true),
        followup('docs/decisions/0001-agent-service.md:238-246 (ruling f)', 'follow-up (fix in place). Ruling (f) names only "any other field" as malformed_frame', 'follow-up (fix in place)', true),
        followup('packages/agent-client/src/agent_client/run_stream.py:96-104 (_violation_from)', 'Pre-existing. Violation details copy unbounded text', 'distributor'),
        followup('packages/agent-client/src/agent_client/sse.py:45 (encode_event)', 'Pre-existing model laxity the encoder makes visible', '#18'),
        followup('packages/agent-client/src/agent_client/run_stream.py:144-162 and :209-224', 'Ownership note (pre-existing): one rule lives in two places', 'distributor'),
        followup('tests/test_sse_codec.py:35-60 vs tests/test_wire_protocol.py:67-297', 'The test helpers are copied rather than shared', 'distributor'),
      ],
    },
    'r0-gate': { verdict: 'REVISE', blocking: [finding('tests/test_sse_codec.py:58', 'Add a literal expected-bytes assertion for a representative non-ASCII event')], followups: [], codexExit: 0 },
    'fix-1': {
      head: agentProvidersTips.fix, mergeResolvedLaneConflict: false, disputed: [], blocked: false,
      files: ['docs/decisions/0001-agent-service.md', 'packages/agent-client/src/agent_client/wire.py', 'tests/test_sse_codec.py'],
      regression: [{ finding: 1, test: 'tests/test_sse_codec.py::test_an_event_travels_as_one_frame_of_compact_utf8_json', failedBefore: false, passesAfter: true }],
    },
    'r1-gate': { ...APPROVE, codexExit: 0 },
    'e2e-0': PASS,
    'ci-0': greenCi(agentProvidersTips.fix),
  },
}

export const replays = [webauthReplay, agentProvidersReplay]

// One past every blocking list a replay hands a fixer.
export const outOfRange = 9

export function answersWith(replay, { kind, mutation, testDraft = false, passesAfter = true, proof = 'exact', proofNumber, strayProof = false, failedBefore, emptyTest = false }) {
  const answers = structuredClone(replay.answers)
  const { raisedBy, fixedBy, number, where } = replay.testGap
  const testGap = answers[raisedBy].blocking.find(f => f.where === where)
  if (kind) testGap.kind = kind
  if (testDraft) testGap.testDraft = '/s/draft_test.py'
  const regression = answers[fixedBy].regression
  const testGapProof = regression.find(recorded => recorded.finding === number)
  if (mutation) testGapProof.mutation = replay.testGap.mutation
  testGapProof.passesAfter = passesAfter
  if (emptyTest) testGapProof.test = ''
  if (failedBefore !== undefined) testGapProof.failedBefore = failedBefore
  if (proofNumber !== undefined) testGapProof.finding = proofNumber
  if (proof === 'omitted') regression.splice(regression.indexOf(testGapProof), 1)
  if (strayProof) regression.push({ finding: outOfRange, test: 'fold-in test', failedBefore: false, passesAfter: false })
  return answers
}

// Sets the named number constants of the bundle; a name the bundle does not declare throws, so a rename never leaves a test waiting for real.
export const withConstants = (constants) => ({
  transform: (source) => Object.entries(constants).reduce((text, [name, value]) => {
    const declaration = new RegExp(`^(\\s*const ${name} = )\\d+$`, 'm')
    if (!declaration.test(text)) throw new Error(`the bundle declares no number constant ${name}`)
    return text.replace(declaration, `$1${value}`)
  }, source),
})
// Zeroes the wait before a retry of an unreachable forge and the sleep of the rate-limit wait step.
export const NO_WAIT = { NETWORK_WAIT_SECONDS: 0, RATE_LIMIT_SLEEP_SECONDS: 0 }
export const noWait = withConstants(NO_WAIT)

// The value a top-level constant of the bundle holds, such as a brief sentence the lane prints or a bound it keeps; a name the bundle does not declare throws.
export const bundleConstant = async (name) => {
  const declaration = `const ${name} = `
  const source = laneSource()
  if (!new RegExp(`^${declaration}`, 'm').test(source)) throw new Error(`the bundle declares no top-level constant ${name}`)
  const context = vm.createContext({})
  const reading = vm.runInContext(`(async function (args, agent) {\n${source.replace(new RegExp(`^${declaration}`, 'm'), `${declaration}__constant = `)}\n})`, context)
  // The constant is assigned while the script's top level runs, before its first agent call, which this stand-in refuses.
  await reading({}, async () => { throw new Error('no agent runs') }).catch(() => {})
  if (context.__constant === undefined) throw new Error(`the bundle never assigned the constant ${name}`)
  return context.__constant
}

export const resumeTip = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'

export const olderTip = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'

export const resumeFixedTip = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1'

export const tidy = followup('x.py:1', 'tidy the import order', 'distributor')

export const defectWithoutDraft = { ...finding('t.py:1', 'the code breaks the rule'), kind: 'defect' }

export const proofOf = (finding, overrides) => ({ finding, test: 't.py [case]', failedBefore: false, passesAfter: true, ...overrides })

export const docsFinding = { ...finding('README.md:1', 'a wrong word'), kind: 'docs' }

export const resumeFix = { head: resumeFixedTip, mergeResolvedLaneConflict: false, files: ['x.py'], disputed: [], blocked: false }

export const resumeArgs = { ...resumedLane, tip: resumeTip }

export const unchangedFix = { ...resumeFix, head: resumeTip, files: [], regression: [] }

export const satisfied = (item, evidence = 'tests/x_test.py already pins it', finding, foldIn = 1) => ({ where: item.where, text: item.text, evidence, ...(finding ? { finding } : { foldIn }) })

export const reachesTheEnd = { 'r1-review': APPROVE, 'e2e-0': PASS, 'ci-0': greenCi(resumeTip) }

export const testGap = { ...finding('t.py:1', 'a behaviour has no test'), kind: 'test-gap' }

export const secondFix = { ...resumeFix, head: 'e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3', parents: [resumeFixedTip], files: ['x.py'], regression: [] }

export const built = { pr: 2, tip: resumeTip, reuse: builtReuse, blocked: false }

export const mainMovedTip = 'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3'

export const mergedOnlyTip = 'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2'

export const conflictsWithMain = { where: 'mergeable', kind: 'defect', text: 'the pull request conflicts with main', rule: 'r', evidence: 'CONFLICTING' }

export const mergeOnlyFix = { ...resumeFix, head: mergedOnlyTip, parents: [resumeTip, mainMovedTip], files: [], regression: [] }

// The contract's 'Head or helper' blockquote owns the delegated line; lane.js keeps a copy no script can read from it.
export const delegatedLineOfContract = () => {
  const contract = fs.readFileSync(new URL('../instructions/AGENTS.md', import.meta.url), 'utf8')
  const section = contract.split('\n## ').find((part) => part.startsWith('Head or helper'))
  const quoted = section.split('\n').filter((row) => row.startsWith('>')).map((row) => row.slice(1).trim())
  return quoted.join(' ')
}

export const roundTip = (round) => String(round).repeat(40)
export const roundRed = (round, extra = () => {}) => () => { extra(); return { head: roundTip(round), green: false, failing: [{ ...defectWithoutDraft, where: `t.py:${round}` }] } }
export const roundFix = (round) => ({ ...resumeFix, head: roundTip(round), parents: [round === 1 ? resumeArgs.tip : roundTip(round - 1)] })
// A fix that changes a lane file outside production moves the tip to a commit a review judges, so the record's last verdict names it.
export const reviewedRoundFix = (round) => ({ ...resumeFix, head: roundTip(round), parents: [round === 1 ? resumeArgs.tip : roundTip(round - 1)], files: ['x.py'], regression: [] })
export const roundReviews = Object.fromEntries([1, 2, 3, 4].map(round => [`r${round}-review`, APPROVE]))

// A tester whose answer the test releases: the lane starts it and goes on with the CI side until `resolve` gives its verdict.
export const heldTester = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve, answer: () => promise } }

// A red CI job and the base-run listing entries the shared-red tests build their watcher answers from.
export const redOnHead = (name) => ({ where: name, kind: 'defect', text: `${name} fails`, rule: `CI check ${name}`, evidence: 'boom' })
let runId = 0
export const run = (name, conclusion, completedAt = '2026-11-13T10:00:00Z') => ({ id: ++runId, name, status: conclusion ? 'completed' : 'in_progress', conclusion, completed_at: conclusion ? completedAt : null })
export const redJob = (name, failingStep, ids = ['11', '22']) => ({ name, link: `https://github.com/o/n/actions/runs/${ids[0]}/job/${ids[1]}`, runId: ids[0], jobId: ids[1], failingStep, findings: [redOnHead(name)] })

// The CI tests' arrangement: a lane at the resume tip whose fix, review and tester answers reach the CI stage, and a CI answer for it.
export const tip = resumeTip
export const lane = resumeArgs
export const alreadySatisfied = { head: tip, mergeResolvedLaneConflict: false, files: [], regression: [], disputed: [], blocked: false, resolved: [{ where: tidy.where, text: tidy.text, evidence: 'already pinned' }] }
export const reachesCi = { 'fix-1': alreadySatisfied, 'r1-review': APPROVE, 'e2e-0': PASS }
export const required = 'quality / verdict'
export const check = (name, bucket) => ({ name, bucket })
export const ciAnswer = (checks, extra = {}) => ({ head: tip, green: true, failing: [], checks, requiredChecks: [required], ...extra })
export const driveCi = (ci, args = lane, read, more = {}) => runLane({ ...args, foldIn: [tidy] }, { ...reachesCi, 'ci-0': ci, ...(read && { 'ci-read-0': read }), ...more })

// The arguments of a lane that still has to build, and a test option that lets a long scripted run take a few seconds.
export const builtLane = { ...resumedLane, pr: undefined, tip: undefined, build: 'b' }
export const tolerates = { timeout: 5000 }
// The relay lists at most 50 paths, so only a longer list cannot be judged and stops the scope check.
export const unjudgeableOutside = ['board.py', ...Array.from({ length: 50 }, (_, index) => `src/mod_${index}.py`)]
// A gate verdict that raises one blocking finding.
export const gateRaises = { verdict: 'REVISE', blocking: [defectWithoutDraft], followups: [] }
