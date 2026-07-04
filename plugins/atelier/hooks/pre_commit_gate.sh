#!/usr/bin/env bash
# Atelier commit gate (PreToolUse on Bash). Blocks a `git commit` until the
# repository's shared agent gate passes, so findings reach the model at the
# moment it can still fix them — a Stop-hook advisory run is invisible to the
# model, because only a blocking exit feeds stderr back.
#
# The gate runs only when the target repository opts in by convention: a
# uv.lock plus a noxfile.py defining the shared `agent` session. That still
# auto-executes a repository-defined command at commit time; the plugin is
# user-scope, so install it only where you trust the checkouts you work in.
set -u

payload="$(cat)" || exit 0
matched_command="$(printf '%s' "$payload" | python3 -c '
import json, re, sys
try:
    command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    command = ""
print(command if re.search(r"\bgit\b[^;&|]*\bcommit\b", command) else "")
' 2>/dev/null)" || exit 0
[ -n "$matched_command" ] || exit 0

# Prefer the tree actually being committed (a worktree commit gates that
# worktree, not the shared checkout); fall back to the session project dir.
project_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$project_root" ] || project_root="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$project_root" || exit 0
[ -f uv.lock ] || exit 0
[ -f noxfile.py ] || exit 0
grep -Eq '^def[[:space:]]+agent\(|@nox\.session\(name="agent"\)' noxfile.py || exit 0

if output="$(uv run --locked nox -s agent 2>&1)"; then
  exit 0
fi
printf 'Atelier commit gate failed (uv run --locked nox -s agent). Fix the findings before committing:\n%s\n' "$output" >&2
exit 2
