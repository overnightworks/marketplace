# marketplace

## Commands

- `python3 scripts/sync_agents.py`: regenerates `plugins/atelier/.codex/agents/` from `plugins/atelier/agents/`; add `--check` to fail on a difference.
- `python3 scripts/check_skills.py`: validates the skills.
- `node scripts/check_workflow_meta.mjs plugins/*/workflows/*.js`: validates the workflow metadata.
- `python3 scripts/install.py`: the operator's install and update; precondition: no Codex job runs. `--from-checkout` installs this checkout, which a lane started from a checkout needs.

## Rules

- Never edit `plugins/atelier/.codex/agents/`; change the Markdown in `plugins/atelier/agents/` and run `sync_agents.py`.
- A change to the plugin raises `version` in `plugins/atelier/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and in `plugins/atelier/.codex-plugin/plugin.json` to the same number with `+codex.<UTC YYYYMMDDHHMMSS>`.

## Owners

- The operator owns `instructions/`; the plugin under `plugins/atelier/` belongs to this repository's head.

## Documents

- `README.md`: read to install, update, verify or find where parts live.
- `docs/ARCHITECTURE.md`: read for where agent guidance lives and why it is never copied.
- `docs/VISION.md`: read for what this repository is for and is not.
- `docs/standards.md`: read to find which fleet standards cover a repository.
- `instructions/AGENTS.md`: the contract and code policy; `instructions/HEAD.md`: what only the head reads.
