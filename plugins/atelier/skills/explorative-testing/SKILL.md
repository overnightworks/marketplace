---
name: explorative-testing
description: Exploratively test a running application like a curious user. Use when asked whether a feature actually works beyond its unit tests, to probe a live app for behavior or UX defects, to explore an app against its documented intent, or to turn exploration findings into work items or bug reports.
---

Drive the real application, not the test suite. Scripted tests assert known
expectations; this skill hunts the gap between documented intent and what a
real user experiences.

## Procedure

1. Collect expectations first, when the parent supplies expectations; a
   plan-blind run skips this step: the feature's plan or acceptance criteria,
   user-facing docs, and recent changes. Write down a handful of concrete,
   falsifiable expectations before touching the app ("a completed run stays
   visible", "a failure names an actionable reason").
   Shed builder knowledge deliberately: if you know why a surface is shaped
   the way it is, judge only what the surface itself communicates — the
   user does not carry the data model, the plan status, or the roadmap in
   their head, and "known issue" is not "not an issue." Prefer a
   context-fresh agent as the witness when one is available.
2. Boot or attach the way the repository's README or AGENTS.md documents; a
   stateless CLI has no boot, so run it on a scratch copy of its inputs. Prefer
   an isolated state directory or database; never explore against live user
   state unless explicitly told to. A throwaway HOME still reaches the operator's
   desktop, because the session bus, the user's systemd and the display are
   found through the environment: drive with
   `env -u DBUS_SESSION_BUS_ADDRESS -u DISPLAY -u WAYLAND_DISPLAY XDG_RUNTIME_DIR=<scratch>/run`
   (create it as an empty 0700 directory). Where the
   outward effect is itself under test, also put a stub first on PATH that
   records its argv under the scratch directory (for example `notify-send`,
   `xdg-open`).
3. Exercise real flows through the real interface — HTTP, browser, CLI. When
   UI is involved, capture screenshots and judge the rendered image (the
   `see` skill), not the source. Cover at least: the happy path, one error path,
   one interrupt/restart path (state durability), and the empty first-run
   state. A server restarts; a CLI is interrupted mid-run and rerun, and its
   first run starts from absent state (no config, cache or baseline).
4. Probe like a user, not a fuzzer: what would confuse, mislead, or dead-end
   a person? Stale views, vanished state, unlabeled failures, copy that
   overpromises, controls that silently do nothing.
   Check every count and state label the surface claims against the source
   of truth (API, store): an aggregate that miscounts, or a status word that
   contradicts reality ("Running" over runs nothing will ever continue), is
   a top finding even when the surface renders it faithfully.
5. Try to refute each suspected defect before reporting it — wrong build,
   stale cache, misread expectation, missed refresh. Reproduce it twice.
6. Report findings with severity, the expectation violated, reproduction
   steps, and evidence (response bodies, screenshot paths). When the user
   asked for work items, report each finding to the head: the head is the work
   intake and files it on the repository's board, deduplicated against open
   items, a bounded number per exploration, evidence attached. Without a head,
   file through the repository's own intake, if it has one.

## Probe lock

Take `/tmp/probe-stack.lock` before a run that starts a server, a container, a browser or an E2E stack. A test run that starts none of them, or only its own throwaway database container, takes no lock; that container still runs under `setpriv --pdeathsig TERM timeout` with a trapped teardown.

- Read the 1-minute load average before a test run, a probe stack, a coverage job or an image build.
- Run only the command or tests that prove a cell (named modules or `-k`), never a full suite or a repeated full run; CI runs the full suite.
- A repository script that takes the lock itself (its own text or the brief says so) runs directly. Wrapped in a second `flock`, its inner lock waits on the outer one and deadlocks.
- Otherwise take the lock with `flock -o -w 3600 /tmp/probe-stack.lock setpriv --pdeathsig TERM timeout -k 30 1800 <command>`, the only form. `<command>` is an executable such as `bash -c '…'` or a script, because `timeout` cannot run a shell builtin or function.
- Run it as a background command that writes its exit code to a marker file, and wait in the foreground, repeating `timeout 280 bash -c 'until [ -f <marker> ]; do sleep 30; done'` until the marker exists. You cannot be woken later, so never answer before that.
- If `flock` cannot run `setpriv`, stop and report it, never drop it.
- `-o` keeps the lock out of every process you start. `setpriv` makes `timeout` send TERM to your whole stack the moment the lock holder dies, so the lock is free only while that stack tears down, which must finish within the 30 s of `-k`. The cap frees the lock even if you stop; a stack that needs longer is cut, not raised.
- A process that detaches itself (`setsid`, a daemon, a browser in its own session) escapes both the lock and the cap, so your teardown trap stops it by pid.
- A script that starts containers tears them and the images it built down in `trap '<teardown>' EXIT TERM`.
- Run every server under `timeout <cap>`, write its pid to a file under the scratch dir, and kill it before reporting. Stop every other process you start (a container, a background browser) before reporting too. `lsof` in the report is evidence only, never a guard.

## Scenario matrix (first gate of a material-risk lane)

This section is the template the global contract refers to.

When the parent hands you a scenario matrix instead of leaving step 1 to you,
drive it in full rather than sampling — this is the first independent review of
a material-risk lane, and later gates are true deltas only if this one is
complete. A matrix crosses the axes that matter for the change -- typically
**type** (the kinds of thing it touches), **state** (before/after variants),
**edit** (the operation applied), **sources** (which origins are in play), and
**command** (each entry point that can observe the result) -- judged against a
short list of ruled sentences. Where there is no running surface, the cells are
driven through the change's real entry points -- CLI invocation, API call, or
public function. Report every cell as **held**, **failed**, or **not driven**;
an unmarked cell is not a completed gate. A cell that a test in CI proves you
judge by reading that test against its row, not by driving it, and mark it
held or failed on that reading; only the cells you drive by hand count toward
the global contract's matrix limit.

## Hard Limits

- Observe and exercise only: no fixes, no state mutation beyond what the
  flows themselves cause, nothing destructive on non-isolated state.
- Do not claim a flow works without having driven it; do not claim a UI is
  correct without a rendered screenshot.
- Stop and report if the app cannot be booted in isolation.

## Output

Return: expectations checked (met / violated / unverifiable), findings with
severity + reproduction + evidence, work items filed (with ids) when
authorized, and what was deliberately not explored.
