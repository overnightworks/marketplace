# Atelier Marketplace

Atelier is the operator's shared agent toolkit: a plugin of skills,
provider-native agents and Claude Code workflows for Codex and Claude Code,
plus the agent contract and code policy that Codex, Claude Code and Grok all
read. It serves the agent sessions across the overnightworks repositories.

Licensed under the [MIT License](LICENSE).

## Layout

- `plugins/atelier/` is the plugin: `skills/` is shared by both hosts,
  `agents/` holds the Markdown source of every agent (loaded directly by Claude
  Code), and `workflows/` holds the Claude Code workflows.
- `plugins/atelier/.codex/agents/` is generated from `agents/`; change the
  Markdown source and run `python3 scripts/sync_agents.py`, never edit the
  generated files.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json` are
  the Codex and Claude Code marketplace catalogs.
- `instructions/AGENTS.md` is the operator's contract and code policy.
- A head starts the lane by its name, `atelier:lane`, with the Workflow tool.
  The name, and each child the lane starts by name (`lane-ci`, `lane-codex`,
  `lane-relay`), resolves to the plugin version the session loaded at its
  start: after an install, a running session runs the new version only once
  the operator types `/reload-plugins`, or in a new session. A run from a
  checkout first installs the checkout with
  `python3 scripts/install.py --from-checkout`; without that flag the
  published copy runs. `lane-ci`, `lane-codex` and `lane-relay` are internal
  to `lane` and are never started by a head.

## Install And Update

```bash
python3 scripts/install.py
```

The same command serves a first install and every later update;
`--from-checkout` adds the marketplace from this checkout, for developing it.
It also links the contract into each provider's user-level instructions (see
[Architecture](docs/ARCHITECTURE.md)).

`codex plugin add` removes the previously installed version directory, so the
script waits until no Codex job runs before it updates Codex. Afterwards start
a new Codex thread or run `/reload-plugins` in Claude Code.

## Read On

- [Architecture](docs/ARCHITECTURE.md): where agent guidance lives and why it
  is never copied.
- [Contract and code policy](instructions/AGENTS.md): the rules every agent
  follows.

## Verify

CI runs these checks, and the `overnightworks/quality` gate on top; the org
ruleset requires its `quality / verdict` check to merge into `main`.

```bash
python3 scripts/sync_agents.py --check
python3 scripts/check_symlinks.py
python3 scripts/check_skills.py
node scripts/check_workflow_meta.mjs plugins/*/workflows/*.js
```
