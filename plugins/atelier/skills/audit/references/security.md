# Security lens

Audit how the code treats untrusted input, secrets and privilege. This is a
source audit against the repository's trust model, taken from the shared Trust
model rule in `SKILL.md`: judge findings against what the code is actually
exposed to, not a generic worst case. State the model used in the report.

## Procedure

1. Hold findings against the trust model. Check a declared model against the
   code: listen addresses, entry points, who writes the inputs. Any
   contradiction is a `HIGH` finding.
2. Trace each checklist area from the entry point to the sink. Try to refute
   a candidate before reporting: look for a check, escape, bound or constraint
   on the path that stops the input reaching the sink, and for a precondition
   the model rules out. Name the concrete attack or leak path of every finding.

## Checklist

- Input to sink: untrusted input cannot reach shell, SQL, eval, template,
  filesystem-path or URL sinks without validation or escaping fit for the sink.
- Secrets: credentials, tokens and keys enter through the configured channel
  only and never reach argv, logs, errors, prompts, rendered output, durable
  records or test fixtures.
- Deserialization and parsing: untrusted bytes use safe loaders and bounded
  sizes; no pickle/eval-class loaders on external data.
- Paths: externally influenced paths are normalized and contained to their
  configured base; symlinks and traversal sequences are rejected where the
  contract requires containment.
- Authorization: privileged, destructive or costly operations check the
  boundary the repository declares; a missing check is a finding even on
  loopback if the guidance claims a boundary.
- Subprocess and network: argument-vectors, not interpolated strings; TLS
  verification on; timeouts bound external calls.
- Denial by input: bodies, streams and collections read from outside have size
  or count bounds on the paths the repository declares bounded, or on any path
  that reads an external body when none are declared.
- Randomness and comparison: tokens and ids that guard anything use a
  cryptographic source; secret comparisons are constant-time where timing is
  observable.

Severity examples, one heading per check: `HIGH` for reachable secret
exposure, injection, traversal, or missing authorization on a declared or
assumed boundary; `MEDIUM` for defense gaps needing an extra precondition (an
unbounded body behind a TLS-trusted path: `MEDIUM` when the boundary is
assumed, `HIGH` when declared); `LOW` for hardening on paths the repository
explicitly trusts.
