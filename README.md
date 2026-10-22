# Atelier Marketplace

Atelier is a shared plugin of skills, provider-native agents, Claude Code
workflows and a commit-gate hook, plus the operator's agent contract, for
engineers who run Codex, Claude Code or Grok on their own repositories.

Licensed under the [MIT License](LICENSE).

## Layout

- `plugins/atelier/` is the plugin: `skills/` is shared by both hosts,
  `agents/` holds the Markdown source of every agent (loaded directly by Claude
  Code), `hooks/` holds the commit-gate hook, and `workflows/` holds the Claude
  Code workflows.
- `plugins/atelier/.codex/agents/` is generated from `agents/`; change the
  Markdown source and run `python3 scripts/sync_agents.py`, never edit the
  generated files.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json` are
  the Codex and Claude Code marketplace catalogs.
- `instructions/AGENTS.md` is the operator's contract and code policy.
- A head starts the `lane` workflow by path:
  `Workflow({scriptPath: "<plugin dir>/workflows/lane.js", args: {...}})`, where
  `<plugin dir>` is the installed copy at
  `~/.claude/plugins/cache/atelier/atelier/<version>/` or `plugins/atelier/` in a
  checkout.

## Install And Update

```bash
python3 scripts/install.py
```

The same command serves a first install and every later update;
`--from-checkout` adds the marketplace from this checkout, for developing it.
It also links the contract into each provider's user-level instructions (see
[Architecture](docs/ARCHITECTURE.md)).

`codex plugin add` removes the previously installed version directory, so
update between Codex jobs. Afterwards start a new Codex thread or run
`/reload-plugins` in Claude Code.

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
python3 scripts/check_root_layout.py
python3 scripts/check_skills.py
```
