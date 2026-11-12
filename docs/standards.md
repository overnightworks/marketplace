# Fleet standards

Reader: a head asking which fleet standards cover its repository, or how a
standard is ruled, recorded and deviated from. One entry per standard: name,
repository kind, and a link to the owner's standard document.

## Standards

- **Document set**, every repository: [write-docs' document set](../plugins/atelier/skills/write-docs/references/document-types.md#repository-document-set).
- **Release path**, repositories that publish a release and apps that ship an image; owner overnightworks/quality: [quality's release path](https://github.com/overnightworks/quality/blob/main/docs/release.md).
- **App on the platform**, every app that runs on the platform or moves onto it; owner overnightworks/platform: [an app on the platform](https://github.com/overnightworks/platform/blob/main/docs/app.md).
- **Calling an agent**, every fleet app that has a place an agent with an account of its own can join; owner overnightworks/agents: [calling an agent](https://github.com/overnightworks/agents/blob/main/docs/calling.md).
- **Languages**, every app with a user-facing surface and the shared kit; owner overnightworks/design: [languages](https://github.com/overnightworks/design/blob/main/docs/languages.md).
- **Run-time installs in CI**, every repository that runs quality's gate, forks of third-party projects excluded; owner overnightworks/quality: [quality's `runtime-install` rule](https://github.com/overnightworks/quality/blob/main/docs/rules.md).

## How a standard works

This section holds contract rules: they bind like `instructions/AGENTS.md`
and change only as its preamble says.

- After a plan review, the operator rules each standard: its owning repository,
  the repositories it covers and its adoption trigger. It is then a requirement
  and invariant for those repositories, subject to the trigger, and can justify
  conformance work.
- The owning head keeps the standard's entry here current when it lands, moves
  or retires; its scope, triggers and deviations live at the owner.
- The owner records each change of the standard there and tells the covered
  heads it can reach live. Until adoption is due, that replaces the board
  notice a release would need and opens no conformance item. A release of a
  package a repository already depends on stays an ordinary release.
- A deviation request names enduring harm (a lost capability, recurring upkeep,
  an unmet operational constraint or a credible risk) with its uncertainty
  stated. The owning head reviews it; only the operator rules it, and the
  ruling is recorded at the owner.
