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
- `plugins/atelier/skills/agent-documentation/AGENTS.baseline.md` is the
  generated seed of the root `AGENTS.md`.
- `plugins/atelier/hooks/hooks.json` is the shared quality-gate hook configuration.
- `plugins/atelier/.codex-plugin/plugin.json` is the Codex plugin manifest.
- `plugins/atelier/.claude-plugin/plugin.json` is the Claude Code plugin
  manifest.
- `.github/actions/sonar-findings-gate/` is the SonarCloud findings gate this
  repository publishes to the fleet; it runs `scripts/sonar_findings_gate.py`.

## Published Actions

`.github/actions/sonar-findings-gate` is used by other repositories as
`overnightworks/marketplace/.github/actions/sonar-findings-gate@<commit>`, so
this repository is a runtime dependency of every consumer's CI. Two constraints
follow, and both break every consumer at once when they are broken:

- **This repository stays public.** A consumer's `uses:` checks it out with the
  consumer's own token, which cannot read a private repository here, so making
  it private stops every consuming build.
- **History a consumer pins is never rewritten.** A pinned commit that
  disappears — a force-push, a rewritten branch, a deleted history — makes
  every consumer that pins it fail to resolve the action.

Both failures are loud and immediate, which is the trade this shape accepts
against the failure copying produced: a defect fixed in one repository and left
live in another for weeks.

## Install From GitHub

Run these once on a machine to make the `atelier` plugin available from any
repository.

Codex:

```bash
codex plugin marketplace add git@github.com:FlexOr2/marketplace.git --ref main
codex plugin add atelier@atelier
```

Claude Code:

```bash
claude plugin marketplace add git@github.com:FlexOr2/marketplace.git
claude plugin install atelier@atelier
```

Start a new Codex thread or run `/reload-plugins` in Claude Code after
installing so the plugin components are loaded.

## Install From This Checkout

Codex:

```bash
codex plugin marketplace add "$(pwd)"
codex plugin add atelier@atelier
```

Claude Code:

```bash
claude plugin marketplace add "$(pwd)"
claude plugin install atelier@atelier
```

Use the local checkout commands while developing the marketplace itself.

## Update Existing Installs

Codex:

```bash
codex plugin marketplace upgrade atelier
codex plugin add atelier@atelier
```

Claude Code:

```bash
claude plugin marketplace update atelier
claude plugin update atelier@atelier
```

Start a new Codex thread or run `/reload-plugins` in Claude Code after updating.

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
- Generated files under `plugins/atelier/.codex/agents/` should not be edited by
  hand; update the Markdown source instead.

## Policy Baseline

The root `AGENTS.md` owns the code policy. The seed the `agent-documentation`
skill ships is a view of it: `AGENTS.baseline.md` is generated from that file
plus the seed preamble in `scripts/agents_baseline_preamble.md`, and the
paragraphs that speak about this repository alone stay behind the
`baseline-skip` markers in `AGENTS.md`. Fix a rule in the owner, never in the
view.

To regenerate the baseline after changing the policy:

```bash
python3 scripts/sync_agents_baseline.py
```

To check drift without writing files:

```bash
python3 scripts/sync_agents_baseline.py --check
```

## Repository Layout Check

`scripts/check_root_layout.py` holds the root to the allowlist the "Repository
layout" section of `AGENTS.md` describes, and refuses a tracked symlink
anywhere in the tree: a consumer's `uses:` checks the whole repository out, so
a link that resolves nowhere breaks every consuming build. A new root entry or
top-level directory needs its owner named and an entry added to that script.

```bash
python3 scripts/check_root_layout.py
```

CI runs both checks next to the agent sync check.

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
