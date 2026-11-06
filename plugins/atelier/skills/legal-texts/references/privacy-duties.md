# Privacy duties

The information duties for a privacy notice, each in a few words with its law,
its article or paragraph and a link to the official text; the wording that
binds is the official text, read as `SKILL.md` Reading the law says. "Per"
says whether a duty is checked once for the app or once per processing in the
inventory. "Usually" is where the duty tends to be met when one controller
runs several apps; the composed pages decide, not this column.

## Editions read

- GDPR, Regulation (EU) 2016/679, CELEX 32016R0679 ([EUR-Lex][gdpr]): read
  through the Publications Office at consolidated CELEX `02016R0679-20160504`,
  header "Consolidated TEXT: 32016R0679 — EN —
  04.05.2016", "Corrected by" listing only the corrigendum of OJ L 127,
  23.5.2018; the SPARQL listing for `02016R0679` returned only this version.
  The EUR-Lex link answered `curl` with 202 and an empty body, so its page is
  `unverified` beyond the CELEX number; whether later corrigenda exist outside
  the consolidated text is `unverified`.
- TDDDG ([gesetze-im-internet.de][tdddg-25], slug `ttdsg`): `xml.zip`,
  "Zuletzt geändert durch Art. 3 G v. 10.3.2026 I Nr. 64".

## Which article applies

- **[GDPR Art. 13][gdpr]**: data collected from the data subject (what the
  user types or uploads, what the app records about the user's own use).
- **[GDPR Art. 14][gdpr]**: data not obtained from the data subject, such as
  data about other persons that a user uploads or data from another
  controller's service. Whether sign-in claims count as collected from the
  subject is a judgement: name it. Art. 14 adds the categories of data and
  the source; its exceptions (Art. 14(5)) are each a judgement to name, never
  to assume.
- The composed page is the one notice the subject receives: a duty a shared
  section on it meets is met for the app, so the part points there. GDPR
  Art. 13(4) and Art. 14(5)(a) waive a duty only where and insofar as the
  subject already has the information; name that judgement when used.

## Form

| Duty | Law | Per | Usually |
|---|---|---|---|
| Concise, transparent, intelligible, easily accessible, in clear and plain language | [GDPR Art. 12(1)][gdpr] | app | app part (the minimality pass) |
| In writing or by other means, electronically where appropriate | [GDPR Art. 12(1)][gdpr] | app | composed page |
| Free of charge | [GDPR Art. 12(5)][gdpr] | app | shared |
| Given when the data are obtained; for data from elsewhere within a month, at first contact or at first disclosure | [GDPR Art. 13(1), 14(3)][gdpr] | app | app code: the notice is reachable before sign-in or collection |

## Content

| Duty | Law | Per | Usually |
|---|---|---|---|
| Controller's identity and contact, representative where there is one | [GDPR Art. 13(1)(a), 14(1)(a)][gdpr] | app | shared |
| Data protection officer's contact, where there is one | [GDPR Art. 13(1)(b), 14(1)(b)][gdpr] | app | shared, or `n/a` with the reason |
| Purposes and legal basis | [GDPR Art. 13(1)(c), 14(1)(c)][gdpr] | processing | app part |
| Legitimate interests, where the basis is Art. 6(1)(f) | [GDPR Art. 13(1)(d), 14(2)(b)][gdpr] | processing | app part |
| Categories of data (data from elsewhere only) | [GDPR Art. 14(1)(d)][gdpr] | processing | app part |
| Recipients or their categories | [GDPR Art. 13(1)(e), 14(1)(e)][gdpr] | processing | app part; shared for recipients every app uses |
| Transfer to a third country: adequacy decision or safeguards, and how to get them | [GDPR Art. 13(1)(f), 14(1)(f)][gdpr] | processing | app part per recipient |
| Storage period, or the criteria for it | [GDPR Art. 13(2)(a), 14(2)(a)][gdpr] | processing | app part |
| Rights of access, rectification, erasure, restriction, objection, portability | [GDPR Art. 13(2)(b), 14(2)(c)][gdpr] | app | shared |
| Right to withdraw consent, where the basis is consent | [GDPR Art. 13(2)(c), 14(2)(d)][gdpr] | processing | app part, or `n/a` when no basis is consent |
| Right to complain to a supervisory authority | [GDPR Art. 13(2)(d), 14(2)(e)][gdpr] | app | shared |
| Whether providing the data is required by law or contract, whether the subject must, and what follows if not | [GDPR Art. 13(2)(e)][gdpr] | processing | app part |
| Source of the data, and whether it is public (data from elsewhere only) | [GDPR Art. 14(2)(f)][gdpr] | processing | app part |
| Automated decision-making including profiling: its logic, significance and consequences | [GDPR Art. 13(2)(f), 14(2)(g)][gdpr] | app | shared when no app does it; app part when this one does |
| A further purpose is announced before the further processing | [GDPR Art. 13(3), 14(4)][gdpr] | processing | app part, or `n/a` |

## Further duties

| Duty | Law | Per | Usually |
|---|---|---|---|
| The right to object is shown explicitly, clearly and apart from other information, at the latest at first communication | [GDPR Art. 21(4)][gdpr] | app | shared when the composed page presents the right to object explicitly, clearly and separately and the app part names Art. 6(1)(f) at each processing resting on it; a gap for the composing repository without such a notice |
| Storing or reading information on the user's device needs informed consent, unless strictly necessary for a service the user explicitly asked for; checked only where the inventory shows device storage | [TDDDG § 25(1), (2) Nr. 2][tdddg-25] | each stored key | app part: the key's purpose and why it is strictly necessary; a key that is not needs a consent the code asks for |

[gdpr]: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
[tdddg-25]: https://www.gesetze-im-internet.de/ttdsg/__25.html
