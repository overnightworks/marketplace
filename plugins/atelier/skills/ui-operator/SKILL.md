---
name: ui-operator
description: Verify atelier console claims by operating the real UI in a real browser, as the operator does — never through the API or database.
---

# UI Operator

No capability claim about the console is true until it has been driven through
the user interface the operator actually uses. Tests prove mechanisms; only the
surface proves the experience.

## The contract

- **UI only.** Drive the running console through a real browser (headless
  Chromium via Playwright or the see-skill's Chrome). Click the buttons, type in
  the forms, read the screen. Never call `/api/*` directly, never touch the
  database, never use CLI verbs in place of a UI action.
- **The exception is diagnosis, and it is named.** Read-only API/log/database
  access is permitted only to diagnose an already-observed UI failure, and every
  such read is named in the resulting finding.
- **If the UI cannot do it, that is the finding.** A missing affordance is never
  routed around; it is filed. Findings are filed through the UI's own Add-work
  form where possible — the filing itself is a test.
- **Screenshots are the evidence.** Every step of a verification run captures a
  screenshot; the claim "it works" is the ordered screenshot series showing a
  real journey, not a green test count.

## Procedure

1. State the claim under verification as one sentence an operator would say
   ("I can take an item from idea to trunk without leaving the UI").
2. Script the journey with Playwright against the RUNNING console (never a
   fixture server): navigate, click, type — only what a human could do.
3. Screenshot before and after every state-changing action into one run
   directory.
4. On any refusal, capture exactly what the operator sees (the banner, the
   button state, the silence). Judge it by the standard: does the screen say
   what happened, why, and what to do next?
5. File every gap as a work item through the UI. Then report: claim, verdict
   (WORKS / FAILS AT <step>), screenshot paths, items filed.

## Output

```text
CLAIM <the operator sentence>
VERDICT <WORKS | FAILS AT step-n>
EVIDENCE <run directory with ordered screenshots>
FILED <item titles, or none>
```

Never report WORKS from source code, API responses, or test suites alone.
