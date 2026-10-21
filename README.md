# Atelier Marketplace

This repository packages reusable skills, provider-native agents, and a
quality-gate hook as one shared `atelier` plugin.

Licensed under the [MIT License](LICENSE).

## Layout

- `.agents/plugins/marketplace.json` is the Codex marketplace catalog.
- `.claude-plugin/marketplace.json` is the Claude Code marketplace catalog.
- `plugins/atelier/skills/` is shared by both hosts.
- `plugins/atelier/agents/` is the canonical Markdown source for agent
  definitions and the native Claude Code agent directory.
- `plugins/atelier/.codex/agents/` contains generated Codex TOML agents.
- `plugins/atelier/hooks/hooks.json` is the shared quality-gate hook configuration.
- `plugins/atelier/workflows/` holds the Claude Code workflows; `lane` drives
  one claimed aco lane from build to ready-to-land. Claude Code documents plugin
  workflows as `/<plugin>:<name>`, but name lookup has not been verified for
  `lane`; start it by path:
  `Workflow({scriptPath: "<plugin dir>/workflows/lane.js", args: {...}})`, where
  `<plugin dir>` is the installed copy at
  `~/.claude/plugins/cache/atelier/atelier/<version>/` or `plugins/atelier/` in a
  checkout of this repository.
  The tool refuses a script whose `meta` is not a pure literal (no `+`
  concatenation, template literal or name); CI checks this for every workflow.
- `plugins/atelier/.codex-plugin/plugin.json` is the Codex plugin manifest.
- `plugins/atelier/.claude-plugin/plugin.json` is the Claude Code plugin
  manifest.

## Install And Update

```bash
python3 scripts/install.py
```

For each provider CLI on `PATH` (`codex`, `claude`) the script adds this
marketplace from GitHub when it is missing, then installs the `atelier` plugin
or updates it, so the same command serves a first install and every later
update. `--from-checkout` adds the marketplace from this checkout instead, for
developing the marketplace itself. It also links the global contract (see
below) and never overwrites, moves or deletes a file: a path that holds
anything else stops the run and is named.

`codex plugin add` removes the previously installed version directory, so
update between Codex jobs. Afterwards start a new Codex thread or run
`/reload-plugins` in Claude Code.

## Agents

Edit agents in `plugins/atelier/agents/<agent-name>.md`. That Markdown file is
the source of truth and is loaded directly by Claude Code. Each file also has a
small `atelier-agent` metadata comment with the Codex-only fields needed to
generate the matching Codex TOML file.

To regenerate Codex agents after changing Markdown:

```bash
python3 scripts/sync_agents.py
```

To check drift without writing files:

```bash
python3 scripts/sync_agents.py --check
```

This repository has local Codex and Claude Stop hooks in `.codex/hooks.json` and
`.claude/settings.json` that run the sync script automatically during agent work
inside this marketplace repo. That means the bridge runs whether you are editing
with Codex or Claude.

Compatibility notes:

- Codex agent `name` values use underscores; Claude agent names use hyphens.
- Codex `model_reasoning_effort` has no Claude frontmatter equivalent, so the
  Markdown source preserves it in the `atelier-agent` metadata comment.
- Codex `sandbox_mode` is approximated with Claude tool lists. Read-only agents
  omit edit/write tools, but Claude does not enforce Codex's sandbox modes as a
  first-class field.
- Codex `nickname_candidates` has no Claude frontmatter equivalent, so it is
  preserved in the `atelier-agent` metadata comment.
- Claude has a `tools` frontmatter field that Codex TOML does not carry; the
  sync script validates it against `codex_sandbox_mode`.
- `maxTurns` is Claude-only, like `tools`: it lives in the Markdown frontmatter
  that Claude Code loads directly, and `sync_agents.py` neither reads it nor
  emits a Codex equivalent (Codex's knob is `model_reasoning_effort`).
- Generated files under `plugins/atelier/.codex/agents/` should not be edited by
  hand; update the Markdown source instead.

## Global Contract

`instructions/AGENTS.md` is the operator's contract and code policy for every
agent. It is installed per machine, never copied into a repository.
`scripts/install.py` links it into each provider's user-level instructions
(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`).

Grok reads `~/.claude/CLAUDE.md` through its Claude compatibility
(`compat.claude.agents`, on by default). Every agent reads whatever the
checkout holds, so keep it an up-to-date `main`. A repository without
`CLAUDE.md` relies on Claude Code reading `AGENTS.md` when no `CLAUDE.md`
exists (v2.1.277+, the default "Project instructions" setting
`claude-md-or-agents-md`).

## Repository Layout Check

`scripts/check_root_layout.py` holds the root to the allowlist the "Repository
layout" section of `instructions/AGENTS.md` describes, and refuses a tracked symlink
anywhere in the tree: a consumer's `uses:` checks the whole repository out, so
a link that resolves nowhere breaks every consuming build. A new root entry or
top-level directory needs its owner named and an entry added to that script.

```bash
python3 scripts/check_root_layout.py
```

## Skill Check

`scripts/check_skills.py` holds every `plugins/*/skills/*/SKILL.md` to the
rules a machine can check: known frontmatter fields only, a valid `name` equal
to its directory, a non-empty `description` of at most 1,024 characters
without XML tags, relative links that resolve, and a body of at most 500
lines. The line limit is a ratchet over `scripts/check_skills_baseline.json`:
an oversize skill may not grow, and a baseline entry is deleted once its skill
reaches the limit.

```bash
python3 scripts/check_skills.py
```

CI runs these checks next to the agent sync check.

## Quality Gate

CI calls the `overnightworks/quality` gate. `quality/config.toml` names the
mandatory job `Sync check and tests`; the reusable gate adds hygiene, the
SonarCloud scan with coverage, and the verdict. `quality / verdict` is the
required check for merging into `main`.

## Hook Behavior

The marketplace plugin is the source owner for this portable hook. Its
configuration lives at the standard plugin path `hooks/hooks.json`, which both
plugin hosts can load from the plugin payload without duplicating the hook
declaration in the host-specific manifests.

Before a direct `git commit`, the hook runs the target repository's `lint` Nox
session when present and otherwise its `agent` session. It opts in only when the
resolved repository has `uv.lock`, `noxfile.py`, and one of those sessions, so
unrelated repositories are unaffected. Codex exposes the session directory to a
hook but not a Bash tool's separate workdir; a commit targeting another worktree
must therefore make that root visible as `git -C <root> commit ...`. Commands
that merely carry the words `git` and `commit` as data do not start the gate.
