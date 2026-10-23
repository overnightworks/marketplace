# Standards lens

Find which laws and standards apply to the operator's system and where each
requirement stands. Two passes: applicability, then the map. A reading of
public texts against the repositories, not legal advice. Pass 1 needs the
network and runs on a Claude auditor (`SKILL.md` External sources); on Codex it
reports "not reached" and decides nothing. The skill holds no list of laws: a
list rots, so instruments are found each run through primary indexes.

Standing audit: every 90 days, and when a questionnaire fact changes or an
application date in the register has passed. Standing-item subject: standards.

Hand-offs: platform.md (a duty that is an operational area), security.md.

## Register

The register is the body of the standing item for the subject "standards", on
the private board of the platform repository the dispatch names. The head that
dispatched the run writes it; the audit stays read-only and returns the text.
It never lives in a public repository. Per instrument:

- the identifier and the version identifier (consolidated CELEX, or the Stand
  line);
- the application dates;
- the result (`in scope`, `out of scope`, `unknown`) with the quoted scope test;
- the facts the result rested on;
- the duty list.

Facts are stored as threshold answers ("fewer than 10 persons, turnover at most
EUR 2 M"), never as raw headcount or turnover. A fact the repository's
`docs/VISION.md` already holds (who uses it today) is read from there, not
copied.

Skip rule: when the version identifier, the application dates and the facts the
result rested on are unchanged, the result and duty list carry over without a
re-read.

## Pass 1: applicability

1. Read the register, if one exists. Without one, this is the first run.
2. Fill the fact questionnaire from the repositories (README, auth and session
   code, storage keys, third-party requests, model calls). Mark each fact
   `code`, `operator` or `unknown`. Never assume an operator fact.
   - legal form and EU establishment;
   - commercial or private use, offered to third parties or not;
   - the size thresholds (persons, turnover, balance sheet), as thresholds;
   - who the users are, how many, where, minors, consumers;
   - data categories, special categories, retention, processors, transfers
     outside the EU;
   - AI role: builds a model, wraps one under its own name, or only uses one;
     decisions about persons; synthetic output;
   - cookies and device storage, third-party requests;
   - contracts concluded online with consumers;
   - content hosted for others;
   - software shipped to others in the course of a commercial activity.

   Pass 1 returns its `unknown` facts to the head as questions, each with a
   recommended default. A result stays `unknown` until the operator answers: a
   default is a recommendation, never an answer.
3. Discover candidates by family, not by list: data protection; device storage
   and telecom; provider information duties; accessibility and consumer; AI;
   product and cyber security; network security; platform liability;
   sector-specific duties (money, employees). Search the primary indexes
   below by title or subject. Further candidates come from the register and the
   operator. Training memory proposes nothing the index does not confirm. The
   report lists the families searched and the index queries run.
4. For each candidate fetch the scope article and its definitions from the
   primary text into scratch and find them with grep; never read a whole
   consolidated act into context. Judge the quoted test against the facts:
   `in scope`, `out of scope` (quote the exemption) or `unknown` (name the
   missing fact). A route that fails gives "primary text not read" and no
   result.
5. Read the consolidated version identifier and the application dates, and flag
   amendments the source marks as pending.
6. For an instrument in scope extract the duties from its operative articles,
   with article and application date, and class each:
   - `required`: a binding text that applies because of a named fact;
   - `recognised route`: a way to prove a required duty, such as a harmonised
     standard listed in the Official Journal (presumption of conformity), or
     BSI IT-Grundschutz where a law asks for the state of the art;
   - `recommended`: regulator guidance that does not bind;
   - `yardstick`: a voluntary standard (ISO/IEC 27001 and 27002, OWASP ASVS and
     the like). It becomes `required` only when a contract or an applicable law
     names it. Never claim certification.

## Pass 2: the map

A fresh auditor maps each duty to evidence in the repositories. The head hands
it pass 1's register text in its brief. It maps only `in scope` instruments;
`unknown` ones stay open questions. Marks as in `platform.md` (Marks): `100 %`,
`partial`, `0 %`, `n/a`, `unverified (host | operator)`. A duty that exists on
paper, such as a signed processor contract or an incident procedure, is
`unverified (operator)` with its question, never `0 %`. Each duty gets an owner
from a board search, open and closed, as in `platform.md` (Modern and already
planned). Yardsticks get a short gap list for a one-person setup, not a full
checklist.

## Access routes

Every route below was probed on 23.10.2026 (the Stand or edition noted). A
route that refuses follows the drift route in `SKILL.md` External sources.
`eur-lex.europa.eu` and `data.europa.eu/eli` answer agents with a bot challenge
(HTTP 202 or 307, empty body); do not use them.

| Anchor | Taken on | Re-check |
|---|---|---|
| EU law, Publications Office Cellar | consolidated `02024R1689-20260727` (header "Consolidated TEXT ... 27.07.2026") | the Cellar command below |
| EU consolidated versions, SPARQL | `02024R1689` lists `-20240712` and `-20260727` | the SPARQL command below |
| German federal law, gesetze-im-internet.de | `bfsg` Stand "Art. 32 G v. 6.5.2024"; `bsig_2025` carries a pending amendment note | the `gii` commands below |
| BSI IT-Grundschutz-Kompendium | Edition 2023 (the edition page: "seit dem 1. Februar 2023 verfügbar") | the BSI commands below |
| OWASP ASVS | tag `v5.0.0_release` | the ASVS command below |
| ISO/IEC standards | paid; `iso.org` answers 403 | none: cite clause titles only, no normative text |

Rules that make the routes work:

- Cellar needs `Accept-Language: eng`; without it the answer is 400. Always read
  the latest consolidated CELEX (`0YYYYRNNNN-YYYYMMDD`), found through SPARQL:
  the original `3`-prefixed act can be outdated by later amendments.
- A German statute's Stand line is the first `<standkommentar>` in its
  `xml.zip`; later ones are amendment notes (`bsig_2025` has four). Slugs
  come from `gii-toc.xml`; the slug of a statute may carry its year
  (`bsig_2025`). A note "textlich nachgewiesen, dokumentarisch noch nicht
  abschließend bearbeitet" is a pending amendment: re-read the text.
- The BSI server refuses `HEAD` and ignores `Range` (it answers 200 and sends
  the whole PDF, about 5.7 MB): cap the transfer with `--max-filesize 1000`
  (curl exit 63 is expected). The `?__blob=publicationFile` suffix is required.
  `Last-Modified` is not always sent, so the edition page is the anchor.
- ASVS moves on its default branch: pin a release tag. Read the file at the tag
  through `raw.githubusercontent.com`.

```sh
curl -sL -o cellar.xhtml -w '%{http_code}\n' -H 'Accept: application/xhtml+xml' -H 'Accept-Language: eng' https://publications.europa.eu/resource/celex/02024R1689-20260727; grep -o -m1 'Consolidated TEXT[^<]*' cellar.xhtml
curl -sG -w '\n%{http_code}\n' -H 'Accept: application/sparql-results+json' --data-urlencode 'query=PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT ?c WHERE { ?w cdm:resource_legal_id_celex ?c . FILTER(STRSTARTS(STR(?c),"02024R1689")) } ORDER BY DESC(?c)' https://publications.europa.eu/webapi/rdf/sparql
curl -s -o toc.xml -w '%{http_code}\n' https://www.gesetze-im-internet.de/gii-toc.xml; grep -o -m1 '<link>[^<]*bfsg/xml.zip' toc.xml
curl -s -o bfsg.zip -w '%{http_code}\n' https://www.gesetze-im-internet.de/bfsg/xml.zip; unzip -p bfsg.zip | grep -o '<standkommentar>[^<]*'
curl -s -o /dev/null -D - --max-filesize 1000 'https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/IT-GS-Kompendium/IT_Grundschutz_Kompendium_Edition2023.pdf?__blob=publicationFile' | grep -E '^HTTP'
curl -sL -o bsi.html -w '%{http_code}\n' https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/IT-Grundschutz-Kompendium/it-grundschutz-kompendium_node.html; grep -o -m1 'Edition 2023 ist seit[^.]*' bsi.html
curl -sG -w '\n%{http_code}\n' -H 'Accept: application/sparql-results+json' --data-urlencode 'query=PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?c WHERE { ?e cdm:expression_title ?t . ?e cdm:expression_belongs_to_work ?w . ?w cdm:resource_legal_id_celex ?c . FILTER(CONTAINS(LCASE(STR(?t)),"general data protection regulation")) FILTER(STRSTARTS(STR(?c),"02016R0679")) }' https://publications.europa.eu/webapi/rdf/sparql
grep -i '<title>[^<]*Barrierefreiheit' toc.xml
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/README.md
```

The commands print status 200 and the identifiers in the table; the BSI PDF
probe prints 200 and curl stops at the cap. The SPARQL title query prints
`02016R0679-20160504` and the `gii-toc.xml` grep prints the BFSG titles: they
show how discovery by title works on each index. Bound the title filter by a
short CELEX stem, a year such as `02024` or a decade such as `0202`; an
unbounded title scan times out. The full `02016R0679` stem in the example only
demonstrates the join. Run them in an empty scratch directory.

## Limits

- The result is an assessment, not legal advice. Terms such as "provider",
  "large scale", "likely high risk" and "commercial" are judgement calls with
  case law and regulator opinions behind them.
- A point with arguments both ways is marked uncertain, with the sources for
  each side.
- The report names what needs a lawyer or the data protection authority: a
  data protection impact assessment outcome, "large scale", a gray provider or
  deployer role, sector assignment, high-risk AI classification, transfers
  outside the EU, minors, employee data, any claim of compliance made to third
  parties.

## Output

The finding record gains no field; `<lens>/<check>` is `standards/<instrument>`
and `file:line` the missing or failing evidence. Report, in order:

1. the applicability table: instrument, version, result, quoted test, facts;
2. the open fact questions, each with its recommended default;
3. the requirement map: duty, class, article, mark, evidence, owner;
4. findings in the finding record, ranked by severity;
5. the `0 %` duties, on their own;
6. the uncertain points;
7. the families and index queries searched;
8. the sources not read, each with its status line;
9. examined and kept;
10. suspected and unproven;
11. the register text for the head to write.

Severity examples:

- `HIGH`: a required duty that applies now, with `0 %` and no owner.
- `MEDIUM`: a required duty that applies within 12 months with no owner, or
  applies now with gaps but an owner.
- `LOW`: a recommended duty missing.

Prevention check: name which fact change should trigger a re-run (a new AI
feature, a new cookie or third-party request, a first paying consumer, a
headcount change).
