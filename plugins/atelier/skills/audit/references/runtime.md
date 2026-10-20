# Runtime lens

Audit how the code runs under time, scale, cancellation, and parallelism. This
is a source audit, not a profiler: report structural hazards proven by code.

## Procedure

1. Read the repository guidance (lookup in `SKILL.md`) for declared hot paths,
   lifecycle ownership, and concurrency assumptions. When none are declared,
   treat entry points, loops, and anything awaited by a caller as hot, and the
   code that spawns or opens a resource as its owner.
2. Inspect each checklist area. Confirm each candidate by tracing ownership,
   setup, teardown, and parallel access.

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
  do not block async or latency-sensitive paths. In an orchestration script,
  a wait that can outlast the time limit of the call that hosts it counts as a
  hot-path hazard.
- Prompts are not controls: a hazard guarded only by an instruction in an
  agent prompt is unguarded; enforcement must live in code or tool permissions.
- Repeated work and access patterns: loops do not re-read, re-parse, or
  recompute invariant work, and a membership test that repeats or grows uses a
  set or dict, not a list.
- Polling: sleep-driven waits are used only when an event, watcher, callback, or
  explicit synchronization point is not available.
- Shared state: read-modify-write updates across workers are atomic or guarded.
- Check-then-act: claims, file existence checks, and state transitions avoid
  race windows.
- Critical sections: locks are held only around the invariant they protect, not
  around slow work.

## Severity examples

Group findings under one heading per hazard. `HIGH` for leaks, corruption, or
resource exhaustion under normal operation. `MEDIUM` for risks that degrade at
scale or on error paths. `LOW` for edge or arguable cases. The finding's
`Evidence` is the confirmed runtime risk and `Why` is when it bites.

Hand-offs: none.
