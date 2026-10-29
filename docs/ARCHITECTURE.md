# Architecture

Reader: a human operator or engineer asking where agent guidance lives and why
it is never copied. Install and verification commands live in the
[README](../README.md), rules in the [contract](../instructions/AGENTS.md), and
the list of documents a repository carries in the
[write-docs skill](../plugins/atelier/skills/write-docs/references/document-types.md#repository-document-set).
The [fleet standards](standards.md) index names each standard that covers
several of the operator's repositories and links to its owner.

## Mental model

Guidance has three owners, and each reaches an agent by its own route:

- **The contract and code policy** are one file, written once, installed per
  machine.
- **The plugin** carries skills, agents and workflows to every host that
  installs it.
- **A repository** carries only its own facts, through git.

```mermaid
flowchart LR
    subgraph marketplace["overnightworks/marketplace"]
        contract["instructions/AGENTS.md<br/>contract + code policy"]
        plugin["plugins/atelier<br/>skills, agents, workflows"]
        codexagents["plugins/atelier/.codex/agents<br/>generated from agents/"]
    end
    subgraph machine["each machine"]
        userfiles["~/.claude/CLAUDE.md<br/>~/.codex/AGENTS.md"]
        host["Claude, Codex, Grok"]
    end
    subgraph repository["any repository"]
        facts["AGENTS.md (facts)<br/>CLAUDE.md = @AGENTS.md"]
        docs["docs/VISION.md<br/>docs/ARCHITECTURE.md, specs"]
    end
    contract -- symlink --> userfiles --> host
    plugin -- plugin install --> host
    plugin -- sync_agents --> codexagents
    facts -- git --> host
    docs -- git --> host
```

## Why there are no copies

A rule copied into a repository is owned by nobody: the copies drifted by dozens
of lines and contradicted current rules, and repositories that were never
seeded had no code policy at all. One file installed on the machine reaches
every repository at once and cannot diverge. The price is that the checkout
must be an up-to-date `main`, because agents read whatever it holds.

## How the contract reaches each host

`scripts/install.py` links `instructions/AGENTS.md` to `~/.claude/CLAUDE.md`
and `~/.codex/AGENTS.md`. Grok reads `~/.claude/CLAUDE.md` through its Claude
compatibility (`compat.claude.agents`, on by default).
