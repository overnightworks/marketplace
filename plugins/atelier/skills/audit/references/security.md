# Security lens

Audit how the code treats untrusted input, secrets, and privilege. This is a
source audit against the repository's trust model, taken from the shared Trust
model rule in `SKILL.md`: judge findings against what the code is actually
exposed to, not a generic worst case. State the model used in the report.

## Procedure

1. Take the trust model from the shared Trust model rule and hold findings
   against it. Check a declared model against the code: listen addresses,
   entry points, and who writes the inputs. Any contradiction is a `HIGH`
   finding.
2. Trace each checklist area from the entry point to the sink. Confirm a
   candidate by following the data flow; try to refute it before reporting:
   look for a check, escape, bound, or constraint on the path that stops the
   input reaching the sink, and for a precondition the model rules out.
3. Name the concrete attack or leak path of every finding.

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
  have size or count bounds on the paths the repository declares bounded, or on
  any path that reads an external body when no bounds are declared.
- Randomness and comparison: tokens and ids that guard anything use a
  cryptographic source; secret comparisons are constant-time where timing is
  observable.

## Severity examples

`HIGH` for reachable secret exposure, injection, traversal, or missing
authorization on a declared or assumed boundary. `MEDIUM` for defense gaps
that need an extra precondition. An unbounded body behind a TLS-trusted path
is `MEDIUM` when the boundary is assumed and `HIGH` when it is declared.
`LOW` for hardening on paths the repository explicitly trusts. Report the
check name as the heading for each finding group.

Hand-offs: none.
