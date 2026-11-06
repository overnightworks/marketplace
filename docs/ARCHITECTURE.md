# Architecture

Reader: a human operator or engineer asking where agent guidance lives and why
it is never copied. Install and verification commands live in the
[README](../README.md), rules in the [contract](../instructions/AGENTS.md) and
its [head part](../instructions/HEAD.md), and
the list of documents a repository carries in the
[write-docs skill](../plugins/atelier/skills/write-docs/references/document-types.md#repository-document-set).
The [fleet standards](standards.md) index names each standard that covers
several of the operator's repositories and links to its owner.

## 1. Context and Scope

Guidance has three owners, and each reaches an agent by its own route: the
contract and code policy by a per-machine link, the plugin by plugin install,
and a repository's own facts through git. This repository owns the first two.
Outside it stand the hosts that read the guidance (Claude Code, Codex, Grok),
the operator's machine, and every repository the operator's agents work in.

```mermaid
flowchart LR
    subgraph marketplace["overnightworks/marketplace"]
        contract["instructions/AGENTS.md<br/>contract + code policy"]
        headfile["instructions/HEAD.md<br/>head contract"]
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
    headfile -- head reads beside the link --> host
    plugin -- plugin install --> host
    plugin -- sync_agents --> codexagents
    facts -- git --> host
    docs -- git --> host
```

## 2. Building Block View

- `instructions/` holds the contract and code policy (`AGENTS.md`, for every
  agent) and the head contract (`HEAD.md`, for the head alone).
- `plugins/atelier/` is the plugin: skills shared by both hosts, the Markdown
  source of every agent, and the Claude Code workflows. The Codex agent files
  are generated from that source.
- `scripts/install.py` is the one installer: it links the contract and installs
  the plugin into each host. The other scripts check the sources and generate
  the Codex agents. The [README](../README.md) owns the layout and commands.

## 3. Runtime View

The core flow is an install: one command puts the contract and the plugin in
front of every host on the machine.

```mermaid
sequenceDiagram
    actor Operator
    participant Installer as scripts/install.py
    participant Home as ~/.claude, ~/.codex
    participant Hosts as claude, codex CLIs
    Operator->>Installer: run
    Installer->>Home: link instructions/AGENTS.md
    Installer->>Hosts: marketplace add or update, plugin install or update
    Operator->>Hosts: new session or /reload-plugins
```

Grok reads `~/.claude/CLAUDE.md` through its Claude compatibility
(`compat.claude.agents`, on by default).

No provider loads `instructions/HEAD.md` by itself. `AGENTS.md` tells the head
to read it before its first answer, and again after a compaction or a resume,
with one command that resolves the link and prints "HEAD.md not read" when it
fails. A helper is told apart by its first message, another agent's brief that
opens with the delegated line; it reads only a section of `HEAD.md` its brief
names.

## 4. Deployment View

Nothing runs as a service. The checkout on the operator's machine is the
source: the contract is read through links into it, and the plugin is copied
into each host by the host's own plugin command, from this checkout or from the
published GitHub copy. CI runs on GitHub Actions.

## 5. Crosscutting Concepts

**Trust.** The operator and his agents write the contract and the plugin; a
change to a contract rule lands only with the operator's ruling, and `main` is
protected by the org ruleset that requires the `quality / verdict` check. The
installer is trusted with the operator's home directory: it replaces only the
two contract links (and refuses to overwrite anything else there) and runs the
`claude` and `codex` CLIs with fixed arguments, nothing built from external
input. The plugin hosts are trusted to load what they install: skills, agents
and workflows run with the permissions the operator gives the host, and this
repository adds no sandbox around them. Dependencies are pinned: CI actions and
the shared quality workflows by commit SHA, `uv` and Python by version, test
dependencies in `uv.lock`; Dependabot proposes monthly bumps that are reviewed
like any change. No narrower trust model than the audit skill's default is
declared.

**Proof strategy.** CI on every pull request checks that the generated Codex
agents match their source, that no symlink is tracked, that the contract fits
Codex's instruction-file size limit, that every skill is valid and every
workflow's metadata parses, and runs the workflow tests and the script tests
at 100 % branch coverage; the shared quality gate then judges the whole.
Documentation is proven by review.

## 6. Constraints and reasons

- **No copies of the contract.** A rule copied into a repository is owned by
  nobody: the copies drifted by dozens of lines and contradicted current rules,
  and repositories that were never seeded had no code policy at all. One file
  installed on the machine reaches every repository at once and cannot diverge.
- **Generated agents are never edited.** The Markdown source is the only
  owner; the Codex files follow it, and CI fails when they differ.
- **One file per audience.** `HEAD.md` stays apart from `AGENTS.md` so helpers
  do not carry the head's coordination rules; the contract stays under the
  Codex size limit.

## 7. Not chosen

- Copying the contract into each repository: the copies drift. Reopen if a
  host stops reading user-level instructions.
- Loading `HEAD.md` through a provider: none loads it by itself. Reopen when a
  host offers a channel for one agent role only.

## 8. Risks and Technical Debt

- Agents read whatever the checkout holds, so it must be an up-to-date `main`;
  a stale or half-merged checkout silently changes every agent's rules.
- Grok depends on another provider's compatibility setting to see the
  contract.
- After an install, a running session keeps the plugin version it loaded.
