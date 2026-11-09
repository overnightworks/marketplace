# Atelier Marketplace

Atelier is the operator's shared agent toolkit: a plugin of skills,
provider-native agents and Claude Code workflows for Codex and Claude Code, plus
the agent contract and code policy that Codex, Claude Code and Grok all read:
one file for every agent and one more for the head. It serves the agent sessions
across the overnightworks repositories.

Licensed under the [MIT License](LICENSE).

## Layout

- `plugins/atelier/` is the plugin: `skills/` is shared by both hosts,
  `agents/` holds the Markdown source of every agent (loaded directly by Claude
  Code), and `workflows/` holds the Claude Code workflows.
- `plugins/atelier/.mcp.json` registers aco's MCP server (`aco mcp`) for both
  hosts.
- `plugins/atelier/.codex/agents/` is generated from `agents/`; change the
  Markdown source and run `python3 scripts/sync_agents.py`, never edit the
  generated files.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json` are
  the Codex and Claude Code marketplace catalogs.
- `instructions/AGENTS.md` is the operator's contract and code policy for every
  agent; `instructions/HEAD.md` beside it is the part only the head reads.
- A head starts the lane by its name, `atelier:lane`, with the Workflow tool.
  The name, and each child the lane starts by name (`lane-build`, `lane-ci`, `lane-relay`,
  `lane-review`, `lane-test`), resolves to the plugin version the session loaded at its
  start: after an install, a running session runs the new version only once
  the operator types `/reload-plugins`, or in a new session. A run from a
  checkout first installs the checkout with
  `python3 scripts/install.py --from-checkout`; without that flag the
  published copy runs. `lane-build`, `lane-ci`, `lane-relay`, `lane-review` and `lane-test` are internal
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

- [Vision](docs/VISION.md): why marketplace exists, who uses it today and what
  it deliberately is not.
- [Architecture](docs/ARCHITECTURE.md): where agent guidance lives and why it
  is never copied.
- [Contract and code policy](instructions/AGENTS.md): the rules every agent
  follows; [head contract](instructions/HEAD.md): the rules the head adds.

## Verify

CI runs these checks, and the `overnightworks/quality` gate on top; the org
ruleset requires its `quality / verdict` check to merge into `main`.

```bash
python3 scripts/sync_agents.py --check
python3 scripts/check_skills.py
node scripts/check_workflow_meta.mjs plugins/*/workflows/*.js
```

Locally, run only the test module your change touches; the full suites run in
CI on the pushed branch.

```bash
uv run pytest tests/test_<module>.py
node --test tests/<file>.test.mjs
```
