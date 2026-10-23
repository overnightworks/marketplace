# Platform lens

Grade how far each operational area of the operator's platform reaches across
the repositories the dispatch names. A source audit of repositories and their
remotes: the live host is not touched (`SKILL.md` Evidence), so what only the
host or the operator can show is asked, never guessed. The three listings the
shared rule allows (`docker ps`, `docker image ls`, `systemctl --user
list-timers`) run only when the auditor itself runs on the platform host;
otherwise their facts are `unverified (host)` questions.

Standing audit: every 90 days. Standing-item subject: platform.

Hand-offs: security.md (a lead on an exposed boundary), runtime.md.

## Procedure

1. Read the dispatch's repository list. Per repository read the guidance
   (lookup in `SKILL.md`), then its deploy, compose, CI, backup, monitoring and
   runbook files at `origin/<default>`, by the Scope rule.
2. Per area run its checks. A check passes only with evidence of the named type
   at `file:line` or a command; absence is a fail naming the search.
3. Mark each area, then judge "modern" and "already planned?" per finding, then
   re-read each `HIGH` (below), then report.

## Grounding

The checks are the floor of current practice, not perfection: the CIS Controls
v8 Implementation Group 1 safeguards (essential hygiene for small
organisations) and the Basis-graded requirements of the BSI IT-Grundschutz
modules. Never the enhanced tiers (IG2, IG3, BSI Erhöht). NIST CSF 2.0
category IDs are grounding only, never the floor. Cite by ID and paraphrase;
copy no control text.

| Anchor | Edition | Re-check |
|---|---|---|
| CIS Controls | v8 / v8.1, IG1 | the IG1 command below |
| BSI IT-Grundschutz-Kompendium | Edition 2023 | the module list names the edition (URL below); the Basis grade of a requirement is read in the module's PDF, not assumed |
| NIST CSF | 2.0 (CSWP 29) | the CSF command below |
| SRE book (Google, 2016) | first edition, chapters cited by number | the chapter list at `https://sre.google/sre-book/table-of-contents/` shows the numbers (below) |
| DORA capabilities | the live capability catalogue, no edition | `https://dora.dev/capabilities/` lists `deployment-automation` and `documentation-quality` (below) |

Re-check commands:

```sh
curl -sL https://www.cisecurity.org/controls/implementation-groups/ig1 | grep -o 'foundational set of [0-9]* cyber'
curl -sL https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf -o csf.pdf && pdftotext csf.pdf - | grep -c 'PR.AA'
curl -sL https://sre.google/sre-book/table-of-contents/ | grep -o 'Chapter \(6\|8\|10\|13\|14\|15\|26\) - [A-Za-z ]*'
curl -sL https://dora.dev/capabilities/ | grep -o 'deployment-automation\|documentation-quality' | sort -u
```

BSI module list:
`https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/IT-Grundschutz-Kompendium/IT-Grundschutz-Bausteine/Bausteine_Download_Edition_node.html`

An anchor whose edition changed, or a source that refuses, follows the
drift route in `SKILL.md` External sources.

## Areas

Evidence types: config (compose, Dockerfile, unit, settings file), CI (a
workflow job), runbook (a documented runnable command), dated (an artefact with
a date within 90 days of the audit), board (an issue or ruling). A fact only the
host or the operator can show is `unverified (host)` or `unverified (operator)`
with its exact question; it is neither a pass nor a fail.

1. **Inventory and ownership** (CIS 1, 2; CSF ID.AM). Intent:
   every service, host and repository is listed once with an owner.
   - A committed inventory lists each service with owner, deployment place and
     data class (config).
   - Each listed service has a repository or an explicit "external" mark
     (config).
   - The inventory names the image or runtime version source (config).
   - Unverified (host): which containers run now that the inventory lacks
     (the `docker ps` listing, when the auditor runs on the host)?
2. **Identity, sign-in and access** (CIS 5, 6; BSI ORP.4; CSF PR.AA). Intent:
   one sign-in path and a joiner and leaver step.
   - Every app's auth config points at the one identity provider, with no local
     password path left on (config).
   - Roles and who holds them are written down (runbook).
   - A joiner and leaver step exists as runnable commands (runbook).
   - Unverified (operator): is a second factor enforced at the identity
     provider, for every account?
3. **Secrets and configuration** (CIS 3, 4; BSI CON.1, SYS.1.6; CSF PR.DS).
   Intent: no secret in git, images or logs, and a written rotation.
   - A secret scanner runs in CI on every repository (CI).
   - Secrets enter by named store or environment variable, none by value in
     compose or images (config).
   - A rotation procedure names each secret and its command (runbook).
   - Unverified (host): when was each production secret last rotated?
4. **Hardening and exposure, including resource limits** (CIS 4, 12; BSI
   SYS.1.6, SYS.1.3, APP.3.1, APP.3.2, NET.3.2; CSF PR.PS, PR.IR). Intent:
   only the reverse proxy is exposed, containers run least-privileged and
   bounded.
   - Images are pinned by digest or exact tag (config).
   - Containers run non-root with memory and CPU limits set (config).
   - Only the proxy publishes ports; the others stay on internal networks
     (config).
   - TLS and security headers are configured at the proxy (config).
   - Unverified (host): which ports does the firewall allow in?
   - Unverified (host): when does the TLS certificate expire?
5. **Patching and dependencies** (CIS 7; BSI OPS.1.1.3; CSF ID.RA, GV.SC).
   Intent: updates arrive by bot and advisories have a time bound.
   - A dependency bot covers base images and packages in each repository
     (config).
   - Lockfiles are committed (config).
   - A vulnerability or SBOM scan runs in CI (CI).
   - A host patch step with its command and cadence is documented (runbook).
   - Unverified (host): which versions run, and what is the host OS patch
     level?
6. **Deploy and rollback** (BSI OPS.1.1.6; CSF PR.PS; SRE ch. 8; DORA
   deployment automation). Intent: one reproducible deploy, a tested way
   back.
   - Deploy is one command or one CI job from a versioned artefact (CI).
   - A rollback command is documented (runbook).
   - A schema migration is reversible or preceded by a backup step (config).
   - A rollback exercise record exists (dated).
7. **Backup and tested restore** (CIS 11; BSI CON.3, DER.4; CSF PR.DS, RC.RP;
   SRE ch. 26). Intent: every data store is backed up off the host and a
   restore was shown to work.
   - Every data store has a backup job in the repository (config).
   - The backup target is off the host and encrypted, with retention stated
     (config).
   - A restore script exists (runbook).
   - A restore-test log exists (dated).
   - Unverified (host): did the last backup run, and does it sit off the host?
   - Key check: the restore-test log. Without one, whether a restore works is an
     open `unverified (host)` question.
8. **Monitoring and alerting, including capacity** (CIS Control 13 has no
   IG1 safeguard; it grounds the intent, not the floor; BSI DER.1; CSF DE.CM,
   DE.AE; SRE ch. 6, 10). Intent:
   a failure reaches a human.
   - Each service has a health probe (config).
   - Alert rules cover down, disk and memory, certificate expiry and backup
     failure, held as files (config).
   - Alerts name a delivery channel (config).
   - Unverified (operator): does a test alert reach the operator, and when did
     it last?
   - Key check: a test alert reached a person. Without a dated record within 90
     days, delivery is an open `unverified (operator)` question.
9. **Logging and audit trail** (CIS 8; BSI OPS.1.1.5, OPS.1.2.6; CSF DE.CM).
   Intent: sign-in and admin events are kept and bounded.
   - Sign-in and admin actions are logged (config).
   - Retention or rotation is configured (config).
   - Time synchronisation is stated (runbook).
   - Logging code or config redacts secrets and personal data (config).
   - Unverified (host): is the retention in effect on disk?
10. **Incident response and recovery onto a new machine** (CIS 17; BSI DER.2.1,
    DER.4; CSF RS.MA, RS.MI, RC.RP; SRE ch. 13 to 15). Intent: a
    stranger could rebuild.
    - An incident page names who acts, how to contain, whom to tell (runbook).
    - A rebuild-from-nothing procedure lists its commands in order (runbook).
    - A postmortem template exists (runbook).
    - A rebuild or tabletop record exists (dated).
11. **Data lifecycle and deletion, including data-subject export and erasure**
    (CIS 3; BSI CON.2, CON.6, OPS.1.2.2; CSF PR.DS). Intent: each data class has
    a retention and an exit.
    - Data classes and retention are stated (config).
    - A deletion path covers the store, derived copies and the backup policy
      (config).
    - A per-person export path exists (config).
    - Unverified (operator): is a signed processor contract on file for each
      external provider?
12. **Runbooks and documentation** (BSI OPS.1.1.2, ORP.1; DORA documentation
    quality). Intent: each service can be operated from its repository.
    - Each service has deploy, restore and rotate commands in the repository
      (runbook).
    - The README links them (config).
    - Onboarding a new app is a written step list (runbook).
13. **AI feature controls** (judgement: no mature framework covers it; OWASP
    DSOMM's AgenticAI dimension is a lead, not read here). Intent:
    bounded keys, spend and write scope.
    - Provider keys are scoped per use and held as secrets (config).
    - A spend limit or alert is configured (config).
    - An agent's write scope is bounded in code or tool permissions, not by a
      prompt (config).
    - Inputs that carry external text are named as untrusted (config).
    - Unverified (operator): what spend limit is set at the provider?

## Marks

- `100 %`: every check passes, with evidence. The checks alone decide the
  mark; an area's Intent sentence says what its checks serve and is never
  graded.
- `partial`: some checks pass.
- `0 %`: none pass; name the search.
- `n/a`: the area does not apply; say why.
- `unverified (host | operator)`: a fact only the live host or the operator can
  show, with the exact question. Running versions, a backup that ran, a working
  restore, alert delivery, the firewall, TLS expiry and a signed contract
  belong here.

An unverified check is listed, not counted. There is no percentage across
areas. An area whose named key check is open caps at `partial`; areas 7 and 8
name one. Any mark with open `unverified (host | operator)` questions, key check
or not, carries "on repository evidence, N open".

## Modern and already planned

- **Modern:** judge a version or practice against the primary release or
  end-of-life source; name the version found and the current one.
- **Already planned?** Search the owning repository's board, open and closed.
  Cite the owner item and its current `Next`, or "no owner". A closed or
  retired concept follows the shared Refute rule.
- **HIGH check:** before the report, re-read each `HIGH` on the owner's current
  default branch (`gh api repos/<owner>/<repo>/contents/<path>?ref=<default>`,
  or the commits API) and board, and mark one already landed or dispatched.

## Output

The finding record gains no field; `<lens>/<check>` is `platform/<area>` and
`file:line` the failing or missing evidence. Report, in order:

1. the area table: area, mark, one evidence line, owner;
2. findings in the finding record, ranked by severity;
3. the `0 %` areas, on their own;
4. the open host and operator questions;
5. examined and kept;
6. suspected and unproven.

Severity examples: `HIGH` a secret in git, an exposed admin port, a data store
with no backup; `MEDIUM` a backup never restored, no alert path; `LOW` a stale
runbook line.
