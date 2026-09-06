#!/usr/bin/env bash
# Atelier commit gate (PreToolUse on Bash). Blocks a `git commit` until the
# repository's shared commit gate passes, so findings reach the model at the
# moment it can still fix them — a Stop-hook advisory run is invisible to the
# model, because only a blocking exit feeds stderr back.
#
# The gate runs only when the target repository opts in by convention: a
# uv.lock plus a noxfile.py defining a `lint` or `agent` session. That still
# auto-executes a repository-defined command at commit time; the plugin is
# user-scope, so install it only where you trust the checkouts you work in.
set -u

payload="$(cat)" || exit 0
commit_directory="$(printf '%s' "$payload" | python3 -c '
import json, os, shlex, sys
from pathlib import Path

try:
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "")
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    tokens = list(lexer)
except (AttributeError, TypeError, ValueError):
    tokens = []

if not tokens or os.path.basename(tokens[0]) != "git":
    raise SystemExit

directory = Path(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
index = 1
while index < len(tokens):
    token = tokens[index]
    if token == "-C":
        index += 1
        if index >= len(tokens):
            raise SystemExit
        selected = Path(tokens[index])
        directory = selected if selected.is_absolute() else directory / selected
        index += 1
        continue
    if token in {"-c", "--config-env"}:
        index += 2
        continue
    if token.startswith("-"):
        index += 1
        continue
    break

if index < len(tokens) and tokens[index] == "commit":
    print(directory)
' 2>/dev/null)" || exit 0
[[ -n "$commit_directory" ]] || exit 0

# Codex exposes only the session cwd to hooks, not a Bash tool's separate workdir.
# A commit outside that session must therefore carry an explicit ``git -C`` so the
# hook can resolve and gate the same tree without evaluating arbitrary shell code.
project_root="$(git -C "$commit_directory" rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$project_root" ]] || exit 0
cd "$project_root" || exit 0
[[ -f uv.lock ]] || exit 0
[[ -f noxfile.py ]] || exit 0
# Prefer a fast `lint` session (format+lint only) so pyright, tach, policy, and
# tests do not tax every intermediate commit — those run in the repo's
# `full`/`agent` land-gate before merge. Fall back to `agent` for repos that
# define no `lint` session.
if grep -Eq '^def[[:space:]]+lint\(|@nox\.session\(name="lint"\)' noxfile.py; then
  gate_session="lint"
elif grep -Eq '^def[[:space:]]+agent\(|@nox\.session\(name="agent"\)' noxfile.py; then
  gate_session="agent"
else
  exit 0
fi

# The only source build this command can trigger is the gated workspace project
# itself, whose code the hook is here to run; `--no-build` refuses to install that
# project (uv 0.10.9) and would hard-block every commit in the gated repositories.
if output="$(uv run --locked nox -s "$gate_session" 2>&1)"; then # NOSONAR(S8541) workspace project must build
  exit 0
fi
printf 'Atelier commit gate failed (uv run --locked nox -s %s). Fix the findings before committing:\n%s\n' "$gate_session" "$output" >&2
exit 2
