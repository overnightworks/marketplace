# Marketplace vision

## The wish

> „ich will ballast loswerden, es sollten nur sachen da sein die benötigt werden!“

> „nichts gebaut wird was nicht gebraucht wird“

Marketplace holds how the operator's agents work: the contract in
`instructions/`, which every agent follows, and the skills, agents and workflows
of the atelier plugin, its only plugin, which every host installs. Each is
written once, so that no repository drifts from it.

## Who uses it today

- The operator, who rules the contract and blesses what lands here.
- The agent sessions (Claude Code, Codex, Grok) across the overnightworks
  repositories: they read the contract, and heads and helpers run the plugin's
  skills, agents and workflows.

Every overnightworks repository depends on marketplace, because its agents load
the installed contract on each machine.

## Deliberate non-goals

- No firlefanz and no security theater: „kein firlefanz und security theater“.
  A rule or safeguard stays only for a named failure it prevents.
- No copies of its guidance in other repositories. A repository carries only its
  own facts.
