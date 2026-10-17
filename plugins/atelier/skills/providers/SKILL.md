---
name: providers
description: Start a Codex or Grok agent from Bash as a head. Use before running `codex exec`, `codex` or `grok` yourself outside the lane workflow, and whenever a sandbox, a linked worktree or its gitdir blocks a commit, fetch or merge.
---

# Starting Codex and Grok from a head

This skill owns the command lines, sandbox modes and output capture for the CLI
versions below. The lane workflow's own Codex gate is not covered here. Never
read auth files. `$WT` is the agent's worktree, `$BRIEF` its brief, `$OUT` its
output file.

## Version check and smoke check

Proven with codex-cli 0.163.0 and grok 1.0.60. On any other version, run the
smoke check before relying on a writer command; do not guess. In a scratch repo
with a linked worktree, the writer setup must commit, fetch and merge, and must
fail to write `<commondir>/config` and `<commondir>/hooks`.

## Codex reviewer (read-only)

`codexReview` in `plugins/atelier/workflows/lane.js` is the worked example. A
hand-started reviewer uses the same flags; read them there, not from a copy here.

## Codex writer in a linked worktree

Since Codex 0.158, a linked worktree's gitdir is read-only under
`-s workspace-write`, even inside `writable_roots`. Use a permission profile that
names the gitdir explicitly instead:

```bash
GITDIR=$(git -C "$WT" rev-parse --absolute-git-dir)
COMMONDIR=$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)
codex exec -C "$WT" \
  -c 'default_permissions="lane"' \
  -c 'permissions.lane.extends=":workspace"' \
  -c "permissions.lane.filesystem={\"$GITDIR\"=\"write\",\"$COMMONDIR/objects\"=\"write\",\"$COMMONDIR/refs\"=\"write\",\"$COMMONDIR/logs\"=\"write\"}" \
  ...
```

- The filesystem table must be one inline-TOML value: a dotted `-c` key splits on
  the dots inside `.git` paths and fails with "must be absolute".
- Commit, `git fetch origin main` and `git merge` work. Writes to
  `<commondir>/config`, `<commondir>/hooks` and new files in the common-dir root
  fail.
- `git branch -D` and `git pack-refs` fail (they need
  `<commondir>/packed-refs.lock`); branch cleanup stays with the head.

## Grok reviewer (read-only)

```bash
grok --cwd "$WT" --sandbox read-only --always-approve -m grok-4.6 --effort "$EFFORT" \
  --output-format json --max-turns 40 --prompt-file "$BRIEF" > "$OUT" 2> "$OUT.err"
jq -r .text "$OUT"
```

- Always pass `--effort`: `~/.grok/config.toml` defaults to `xhigh` and
  `permission_mode = "always-approve"`.
- `--json-schema '<schema>'` works and implies json output.
- Grok loads the global contract, so `.text` starts with `Contract loaded.`.

## Grok writer in a linked worktree

The built-in `--sandbox workspace` cannot commit: it denies `index.lock` in
`<commondir>/worktrees/<name>`. Use a custom profile in `<wt>/.grok/sandbox.toml`
(untracked; a builder must not commit it):

```toml
[profiles.worktree-writer]
extends = "workspace"
read_write = ["<commondir>/objects", "<commondir>/refs", "<commondir>/logs", "<commondir>/worktrees/<name>"]
```

Run with `--sandbox worktree-writer`, the reviewer's other flags and a higher
`--max-turns`. Append, `git add` and `git commit` work; writing
`<commondir>/hooks` fails.

## Waiting, capturing, judging

- Wait for the process itself, not a poll of its output file.
- Codex: capture the answer with `-o <out>`. Grok: `jq -r .text "$OUT"`.
- A Grok failure exits 1 with a JSON error on stdout; read `$OUT` before
  trusting `$OUT.err`.
- Judge the exit status first, then the answer; a zero exit with an empty answer
  is a failed step.

## Named risks

- Both writer setups make `<commondir>/refs` writable, so a builder can move any
  local branch, including `main` and `refs/aco/state`. Run landing and claim
  checks outside the sandbox.
- Grok's `workspace` and `read-only` profiles can write `~/.grok`, and the custom
  profile file sits in the worktree, so a sandboxed Grok can edit the profile its
  next run reads.
- `--always-approve` makes the sandbox Grok's only control.

## Unproven

- `--permission-mode default` overriding the config in headless mode (it appeared
  not to).
- `--effort high` on grok-4.6.
- `~/.grok/sandbox.toml` as the profile home.
- `restrict_network`.
- Push to GitHub and `aco` commands from inside either sandbox.
