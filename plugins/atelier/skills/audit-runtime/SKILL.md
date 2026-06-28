---
name: audit-runtime
description: Audit non-functional runtime risks in source code, including leaks, blocking hot paths, unbounded growth, repeated work, races, and contention. Use when asked about performance, cleanup, resource use, concurrency, scale, or reliability under load.
---

Audit how the code runs under time, scale, cancellation, and parallelism. This
is a source audit, not a profiler: report structural hazards proven by code.

## Procedure

1. Define scope from the request or changed files.
2. Read the repository guidance to understand hot paths, lifecycle ownership,
   and concurrency assumptions.
3. Inspect each checklist area. Confirm each candidate by tracing ownership,
   setup, teardown, and parallel access.
4. Report only hazards that survive a real refutation attempt.

## Checklist

- Process ownership: spawned processes are terminated and reaped on normal
  return, errors, timeout, cancellation, and owner shutdown.
- Handle ownership: files, sockets, locks, temporary directories, transports,
  and connections are closed or released on every path.
- Growth bounds: caches, queues, registries, logs, and append-only collections
  have caps, eviction, rotation, or lifecycle cleanup.
- Cleanup robustness: teardown cannot be interrupted halfway in a way that
  strands resources.
- Hot paths: synchronous I/O, blocking subprocesses, sleeps, and network calls
  do not block async or latency-sensitive paths.
- Repeated work: loops do not re-read, re-parse, or recompute invariant work.
- Polling: sleep-driven waits are used only when an event, watcher, callback, or
  explicit synchronization point is not available.
- Shared state: read-modify-write updates across workers are atomic or guarded.
- Check-then-act: claims, file existence checks, and state transitions avoid
  race windows.
- Critical sections: locks are held only around the invariant they protect, not
  around slow work.

## Output

Return findings grouped by hazard:

```text
[SEVERITY] <hazard> - <file:line>
What: <confirmed runtime risk>
Why: <when it bites>
Fix: <concrete change>
```

Use `HIGH` for leaks, corruption, or resource exhaustion under normal operation.
Use `MEDIUM` for risks that degrade at scale or on error paths. Use `LOW` for
edge or arguable cases. End with `CLEAN` when no high or medium findings remain.
