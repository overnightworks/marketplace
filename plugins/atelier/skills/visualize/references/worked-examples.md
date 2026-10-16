# Worked diagram examples

Mermaid, fictional "Acme Notes". Each diagram carries its question and source
caption and every edge is a checked claim (a real call, import or message in
the named source). The altitudes follow the C4 model, <https://c4model.com/>:
context, container, component, code. Pick the level by the audience's
question; the examples show the first two.

## C4 level 1: context

Question: who and what interacts with Acme Notes? Audience: outsiders and
operators. Source: the deployment config and the integration clients.

```mermaid
flowchart LR
  editor(["Editor (person)"])
  notes["Acme Notes"]
  idp["Identity provider (external)"]
  mail["Mail service (external)"]
  editor -->|"edits notes in browser"| notes
  notes -->|"authenticates users via OIDC"| idp
  notes -->|"sends invitations via SMTP"| mail
```

## C4 level 2: container

Question: which deployable parts make up Acme Notes, and what talks to what?
Audience: operators and engineers. Source: one container per entry in the
compose file; one edge per client call in the code.

```mermaid
flowchart LR
  editor(["Editor"])
  subgraph notes["Acme Notes"]
    web["web (SPA)"]
    api["api (HTTP service)"]
    db[("notes-db (PostgreSQL)")]
  end
  idp["Identity provider"]
  editor -->|"HTTPS"| web
  web -->|"JSON over HTTPS"| api
  api -->|"SQL"| db
  api -->|"OIDC"| idp
```

## Sequence: login flow

Question: in which order do the parties act when an editor logs in? Audience:
engineers changing authentication. Source: the login route handler and the
OIDC client.

```mermaid
sequenceDiagram
  actor Editor
  participant Web as web
  participant Api as api
  participant Idp as Identity provider
  Editor->>Web: open /login
  Web->>Idp: redirect with client id and state
  Idp-->>Web: redirect back with authorization code
  Web->>Api: POST /session (code)
  Api->>Idp: exchange code for tokens
  Idp-->>Api: id token
  alt token valid
    Api-->>Web: 200 with session cookie
  else token invalid
    Api-->>Web: 401
  end
```
