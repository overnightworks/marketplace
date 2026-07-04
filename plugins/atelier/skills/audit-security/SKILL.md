---
name: audit-security
description: Audit source code for security defects such as injection, secret exposure, unsafe deserialization, path traversal, missing authorization, and unsafe subprocess or network use. Use when asked to audit security, review code for vulnerabilities, check secrets handling, or judge the safety of an input, authentication, or privilege boundary.
---

Audit how the code treats untrusted input, secrets, and privilege. This is a
source audit against the repository's own trust model: read the guidance for
declared trust boundaries first, and judge findings against what the code is
actually exposed to, not a generic worst case.

## Procedure

1. Define scope from the request or changed files.
2. Read the repository guidance for declared trust boundaries (local-only
   servers, single-user assumptions, credential channels) and hold findings
   against them.
3. Trace each checklist area from the entry point to the sink. Confirm a
   candidate by following the data flow; try to refute it before reporting.
4. Report only findings that survive refutation, with the concrete attack or
   leak path named.

## Checklist

- Input to sink: untrusted input cannot reach shell, SQL, eval, template,
  filesystem-path, or URL sinks without validation or escaping appropriate to
  the sink.
- Secrets: credentials, tokens, and keys enter through the configured channel
  only and never reach argv, logs, errors, prompts, rendered output, durable
  records, or test fixtures.
- Deserialization and parsing: untrusted bytes are parsed with safe loaders and
  bounded sizes; no pickle/eval-class loaders on external data.
- Paths: externally influenced paths are normalized and contained to their
  configured base; symlinks and traversal sequences are rejected where the
  contract requires containment.
- Authorization: privileged, destructive, or costly operations check the
  boundary the repository declares; missing checks are findings even on
  loopback if the guidance claims a boundary.
- Subprocess and network: commands are argument-vectors, not interpolated
  strings; TLS verification is not disabled; timeouts bound external calls.
- Denial by input: request bodies, streams, and collections read from outside
  have size or count bounds on the paths the repository declares bounded.
- Randomness and comparison: tokens and ids that guard anything use a
  cryptographic source; secret comparisons are constant-time where timing is
  observable.

## Output

Return findings grouped by checklist area:

```text
[SEVERITY] <area> - <file:line>
What: <confirmed defect and the concrete path from input to impact>
Why: <trust boundary or rule it breaks>
Fix: <concrete change>
```

Use `HIGH` for reachable secret exposure, injection, traversal, or missing
authorization on a declared boundary. Use `MEDIUM` for defense gaps that need
an extra precondition. Use `LOW` for hardening on paths the repository
explicitly trusts. End with `CLEAN` when no high or medium findings remain.
