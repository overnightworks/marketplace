---
name: legal-texts
description: Write, adapt or check one app's own part of the privacy notice (Datenschutzerklärung) and of the terms of use (Nutzungsbedingungen). Reads the current composed pages and shared sections, inventories what the app's code really processes, reads the current official text of each law it checks (GDPR Art. 12 to 14, BGB §§ 305 to 310), marks every duty as met by a shared section, by the app's part or not applicable, writes only what the app adds and points to the shared sections for the rest, runs a minimality pass and hands the wording to the operator for his yes. Use when asked to write, update, shorten or review an app's privacy notice, Datenschutzerklärung, data protection text, terms of use, Nutzungsbedingungen or AGB, or when an app gains a processing (account, stored data, logs, device storage, a third party or AI provider). Which laws apply at all comes from audit (standards). An assessment, not legal advice.
---

Every app delivers its own privacy part and its own terms part. A part holds
only what that app adds and points to the shared sections for everything
else. It says what is necessary and nothing more, and forgets nothing that is
required. **The result is an assessment of public texts, not legal advice.**

The skill writes only the app's part, in the app's repository, inside the
app's claimed lane. It never edits a shared section or a composed page: those
belong to the repository that composes them.

## Procedure

1. **Read the current pages first.** The repository that composes the legal
   pages owns where they are served, which shared sections exist with their
   ids, what an app ships (file, format, allowed links) and how a part is
   validated. In this fleet that is hal: its architecture overview's section
   on the legal pages and their section contract. Elsewhere, take it from the
   dispatch or the app's `README.md`; when neither names one, stop and ask
   whoever dispatched the run. Read that document at the composing
   repository's default branch, never from a working tree. This skill copies
   none of its paths, ids or URLs, because they go stale: read them there each
   run. Then fetch the composed privacy and terms pages into scratch, and read
   every shared section and the app's current part, if any, in full. Note what
   each shared section already says.
2. **Inventory what the code really processes.** Read the app's code at the
   revision that ships with these texts (the claimed lane's tree, so a
   processing the lane adds is included), not its documentation, and list
   every processing with a
   `file:line`:
   - accounts and sign-in: which identity provider, which claims the app
     reads and stores;
   - stored data: tables, files, object stores and in-memory stores (chat
     replay, sessions, rate-limit counters keyed by address), with the
     personal fields;
   - logs: what a request or job logs (addresses, user ids, content) and how
     long logs live;
   - device storage: cookies, local and session storage, IndexedDB, caches
     and service workers, each with its key and purpose. The app's own source
     is not enough: dependencies and the framework write storage too (an
     auth library's cookies, a router's session-storage keys), so read the
     locked dependencies' runtime and the built bundle as well;
   - third parties and processors: every outbound request (APIs, AI
     providers, mail, fonts, CDNs) and what it sends;
   - transfers outside the EU: the recipient's location, as the provider
     documents it;
   - sharing with other users or the public;
   - retention and deletion: what deletes what, and when.

   A fact the code cannot show (a processor contract, a provider's location,
   who the users are) is an operator fact: ask it, never assume it.
3. **Take which laws apply from audit.** The audit skill's standards lens
   ([references/standards.md](../audit/references/standards.md)) owns
   applicability; its register is the body of its standing item. Where no
   register exists, or the inventory holds a fact the register did not rest on
   (a new processor, device storage, an AI feature, consumers as contract
   partners), ask whoever dispatched this run for the audit's standards goal
   and mark the affected duties `unverified`. An instrument in scope for which
   this skill has no checklist brings its duty list from the register, and
   each of its duties enters the check only with its official link.
4. **Read the current law.** Before checking, read the current official text
   of every article or paragraph the check needs, through the links in the
   checklists and the route under [Reading the law](#reading-the-law). Compare
   its edition with the one the checklist was read at; where it changed, read
   the changed provisions and mark every duty they touch `unverified` until
   the checklist is updated.
5. **Check each duty.** Walk
   [references/privacy-duties.md](references/privacy-duties.md) and
   [references/terms-duties.md](references/terms-duties.md) against the
   inventory. Mark every duty, per processing where the checklist says so, as
   exactly one of:
   - `shared <section id>`: a shared section already meets it for this app,
     so the part points there;
   - `app part`: only the app can say it, so the part says it;
   - `n/a`: the duty does not arise, with the reason (the code fact or the
     register line);
   - `unverified`: a fact or a source is missing; name which.

   A duty met by text but not by code (the notice is not reachable before
   sign-in, a cookie needs consent the app never asks for) is a gap in the
   app, reported, never papered over by wording.
6. **Write only the app's part**, in the language of the composed pages and
   in the format the section contract prescribes. Each `app part` duty gets
   the shortest complete sentence; each `shared` duty a pointer in the form
   the contract accepts. The terms part says at least what the app's service
   is, which no shared section can know, and adds a clause only where the app
   deviates from or adds to the shared terms. A gap in a shared section (a
   duty every app needs and none covers) goes to the composing repository's
   owner as a finding; the part does not fill it. Where the section contract
   names a validator, run it on the draft in scratch.
7. **Minimality pass.** Re-read the draft sentence by sentence:
   - every sentence traces to a code fact (`file:line`) or a cited duty, or is
     a pointer;
   - a sentence that says what a shared section says becomes a pointer;
   - a sentence about a processing the code does not do, or a hedge ("may",
     "for example", "possibly") about one it does, is cut or made exact;
   - a terms clause that only restates the statute is cut (the terms
     checklist's BGB § 307(3) row);
   - one fact is said once.

   Then re-check completeness: every inventory row is covered by the part or
   by a pointer, and every duty marked `app part` has its sentence.
8. **Hand the wording to the operator for his yes.** He receives the exact
   draft, never a summary of it, with the trace and duty tables. Only after
   his yes does the app's lane commit the part; it is published only through
   the app's release, as the composing repository reads it.

## Reading the law

Each checklist row names its law and article or paragraph and links its
official text: EU law on EUR-Lex by CELEX number, German federal law on
gesetze-im-internet.de by paragraph. Read and cite as audit's External
sources rule says (the raw text fetched to scratch, one source line each).

- **EUR-Lex** answers an agent's `curl` with HTTP 202 and an empty body. Read
  the same CELEX through the Publications Office: find the latest
  consolidated version with the SPARQL listing in audit's
  [access routes](../audit/references/standards.md#access-routes) (stem
  `02016R0679` for the GDPR), then fetch
  `https://publications.europa.eu/resource/celex/<consolidated CELEX>` with
  `Accept: application/xhtml+xml` and `Accept-Language: deu` (or `eng`). Its
  header line names the edition, its "Berichtigt durch" ("Corrected by") list
  the corrigenda it includes.
- **gesetze-im-internet.de** answers `curl` with 200 for each paragraph page
  (encoded ISO-8859-1). The statute's edition is the `zuletzt geändert` line
  among the `<standkommentar>` entries of its `xml.zip`, not the line of its
  promulgation.

A source that refuses is reported with its status line, and the duties
resting on it stay `unverified`. Hand the questions the standards lens's
Limits list (minors, transfers outside the EU, a grey role, any claim of
compliance) to the operator as needing a lawyer or the authority.

## Hard Limits

- Never write a shared section, a composed page or another app's part.
- Never publish: the operator's yes and the app's release do.
- No sentence without a code fact, a duty or a pointer behind it.
- No processing assumed from documentation, a template or another app.
- Quote legal text only from the official text fetched in this run; the
  checklists name each duty in a few words and are no source to quote.

## Output

Return, in order:

1. the draft parts (privacy, terms), exactly as they would ship;
2. the trace table: sentence, code fact or duty, or the shared section it
   points to;
3. the inventory: processing, `file:line`, covered by (`app part` or
   `shared <section id>`);
4. the duty table: duty, law and article with its link, mark, reason;
5. gaps in the app's code and in shared sections, each with its owner;
6. the operator questions, each with a recommended default;
7. the sources read (URL, HTTP status, retrieval date, edition) and those not
   reached;
8. the line: "An assessment of public texts, not legal advice."
