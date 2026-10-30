`instructions/` owns the operator's contract: `AGENTS.md` holds what every agent
follows and the code policy, `HEAD.md` the head's coordination; this file adds
only this repository's facts. Keep project facts, provider glue, architecture
state, tool commands, and plans outside the contract.

Entry points (pointers only; the facts live there): `README.md` owns the plugin
layout, source-versus-generated ownership, installation, update, and verification
commands; `docs/ARCHITECTURE.md` owns the overview of where agent guidance lives.
