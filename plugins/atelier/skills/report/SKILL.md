---
name: report
description: Persist already-confirmed audit or review findings as deduplicated Markdown work items. Use only when the user explicitly asks to save findings to a destination.
---

Persist findings only when the user supplied a destination directory or file.
If no destination was supplied, return the findings without writing.

## Procedure

1. Confirm the findings are already reviewed or otherwise accepted as real.
2. Use the destination and schema the user or repository provides. Do not invent
   an issue tracker, lifecycle, or plan format.
3. Derive a descriptive kebab-case slug for each finding.
4. Update an existing matching file instead of creating a duplicate.
5. Preserve useful human notes already present in an existing file.
6. Include severity, source, location, problem, impact, and concrete fix.

## Output

List every path created or updated. If nothing was written because no destination
was supplied, say that plainly and return the findings inline.
