# Code policy

Read by the agents that (`AGENTS.md`, Code policy) names, after `AGENTS.md`,
which binds them too.

Rules for all code written for the operator. A violation is a defect to fix
before the work is called done.

## Growth and ownership

- Grow a repository only to remove a named problem, keep a real invariant or
  enable a named capability. Reuse an existing owner first; a new boundary
  needs a decision no existing owner can own. An index, vector store or
  knowledge graph over the code also needs a named consumer and a measurement
  that beats plain search.
- Before editing, identify the owner, state, configuration, failure modes and
  verification. Behaviour lives in the module that owns the decision.
- Before writing a function, module, test helper or fixture, search for code
  that does the job; extend or refactor it so every caller shares it, and write
  new code only when none fits. Reuse only for the same domain idea, owner and
  invariant. Remove duplication that must evolve together; keep short
  duplication where an abstraction would hide meaning or couple unrelated
  concepts. Other new code that repeats existing code is blocking.
- A rule a machine can check belongs in the repository's checks, one only
  judgement can see in a scheduled agent audit at a fixed cadence (one
  distributor item per run), never in a sentence every agent must remember.
- The root holds only what a tool must find there and the entry documents,
  as quality's `root-layout` rule lists them. Everything else lives in its owner's
  directory (a baseline beside its check, a fixture beside its test, a helper
  under `scripts/`), with no catch-all directory and no deeper hierarchy than
  the owner needs; below the root, placement is judgement.
- Use a maintained library for a solved hard problem the standard library
  lacks; vet its maintenance, security and size, which become yours. No
  dependency for one trivial helper, style or speculative flexibility; say what
  complexity a new one removes.

## Code

- No abstraction, extension point, compatibility layer or option without a
  current caller; leave a clean seam only where later change would be hard.
  Cases of one shape are data in the one owner of their decision, so the next
  case is an addition in one place.
- Build vertically first: shapes early, surfaces thin, hardening after use. A
  capability's first slice is the thinnest honest end-to-end proof. Edge cases
  precede its first run only where their absence corrupts durable state, loses
  data or lets the system lie; every other edge is named as a gap on the owning
  item and waits for usage evidence, at the latest until the capability reaches
  people beyond the operator. A review judges a slice by its declared
  sentences, not by all conceivable hardness.
- A slice is one coherent change a reviewer reads in one sitting, within ten
  production files and 400 changed production lines (additions and deletions
  apart, tests and generated files excluded); beyond that, the dispatch says in
  one sentence why it does not split. This is reported, never gated.
- Code reached only by tests is dead; reachability counts from real entry
  points (composition root, routes, CLI, workflows). Code built ahead of its
  caller is frozen only while an open item names it as caller: it stays, keeps
  its tests, gets no hardening or new tests, and is listed against that item. At
  that item's pull it is used or deleted; if the item closes or drops it, it
  goes. Other unused code is deleted, and the commit says it stays recoverable
  from git. An audit never deletes a feature someone uses; that is the
  operator's call.
- Generate only declared derived artefacts, and only what a generator produces
  deterministically; once its generator exists, an empty regeneration diff is
  the gate.
- Match existing style unless it breaks these rules or keeps a known defect;
  never copy a mess, and leave what you touch better.
- Code reads like prose: full names that carry intent (abbreviations only where
  established), small functions and modules with one job each. What you cannot
  name in a few words does too much.
- Prefer typed, immutable state: enums over loose strings, records over bare
  dicts, path types over strings, illegal states unrepresentable. No direct
  `Any` parameter in contract, port, application or API layers (`ANN401`); a
  nested `dict[str, Any]` is counted debt that must not grow.
- Choose data structures by access pattern: set or dict for membership and
  keyed lookup, list for order.
- Keep side effects visible at the call site and pure logic pure. Isolate
  filesystem, process, network, clock, randomness and external services behind
  narrow boundaries.
- Comments give only an unavoidable why: an external constraint, security
  reason, protocol quirk, data-loss risk or non-obvious tradeoff, in the
  present tense. A comment, docstring or test name cites no item, ruling or
  record and carries no date or ageing narrative ("formerly", "superseded").
- Fix scanner and linter findings in code. An exception needs a code route that
  was tried and measured or judged counterproductive, and lives in the
  repository beside its reason (a rule-specific line marker, or a properties
  entry naming its stronger owner); never a SonarCloud status change or a
  file-wide ignore. A program's one output owner, the file whose job is
  printing, declares itself as `# ruff: noqa: T201 - <reason>`, the form
  quality's `python-print` rule accepts; that names the owner and is no
  file-wide ignore.
- Size, complexity and duplication are held by ratchets over a baseline, not by
  repository-wide allowlists: files from 800 lines, functions from 60,
  cyclomatic complexity above 15 and near-identical function pairs are debt,
  not a quality seal. A new or grown one, or an orphaned baseline entry, is red
  (cases: quality's `size` and `clone` rules); the baseline shrinks in owned
  slices.

## Configuration and value ownership

- Values that vary by user, project, environment, provider, deployment or
  runtime boundary are configuration; a stable internal invariant is not made
  externally configurable just to avoid a constant.
- Before adding a literal, constant, default or fixture value, classify its
  owner:
  - Runtime, user, provider, project, environment and boundary values come
    through commands, configuration, environment, fakes or call-site
    parameters; never hardcode prompts, provider output, ids, paths, clocks,
    credentials or user choices.
  - Domain concepts, protocol tokens, persisted keys, event names, statuses,
    ids, commands and records have one production owner, preferably a typed
    contract. Adapter representation stays inside the adapter unless a caller
    has a real contract with it.
  - Test values are local scenario data in builders, fixtures or scenario
    objects, not top-level constant blocks that mix contracts, examples and
    adapter internals. Tests reuse production contracts
    but never repeat production construction, serialisation, path or
    derivation logic to compute an expected result.
  - A test or probe does not restate a value chosen in a shipped file
    (configuration, Compose, Dockerfile, lockfile, realm export, CI workflow),
    ruled choices included. An assertion stays only if it checks validity, a
    constraint more than today's value satisfies, a relationship read from both
    owners (never a literal, never a value as its own expected result), or a
    protective limit (allowlist, deny list, non-root user), even one equal to
    today's value. A ruled choice is proven by reviewing its diff and by
    evidence through its consumer; a missing proof is named on its owner, never
    covered by a static copy. When an item changes a pinned value, each
    affected assertion is judged this way; a pin found need not be kept or
    re-pinned.

## Failure

- Fail loud when durable state, user data, verification, integration, security
  or process ownership could be corrupted; never swallow an error or paper over
  a problem. Fail soft only when the failure is visible, recoverable and
  harmless to important state.
- Validate external input, provider output, configuration and filesystem
  state; trust internal interfaces instead of re-checking impossible states.
- Enforce privileged, irreversible or external side-effect boundaries in code
  or tool permissions; prompts are not controls.
- **Safeguards.** Weigh credible failures and attacks (likelihood, severity,
  recovery) against the cost and risk of building, running, keeping or
  deferring the safeguard, and name uncertainty instead of calling it low;
  credible attacks are those the repository's trust model admits
  (`docs/ARCHITECTURE.md`, Crosscutting Concepts, Trust; else the `audit`
  skill's default). Tell what a standard requires, recommends or leaves
  optional; optional is not unnecessary. Nothing here waives ruled behaviour,
  required checks, mandatory edges or the protection of data, security and
  rights. Leave unjustified additions out and name the remaining risk on the
  owning item.
- **Exceptions end.** An exception to a rule or check, a report-only check and
  a floor below its target included, names its owner and what ends it. A
  repository's count of them only falls, a rise lands only with the operator's
  ruling, and an exception a second repository needs becomes a case of the
  rule.
- **The operator's settings** are deliberate and trusted. Code ships safe
  defaults and accepts whatever he turns on or off, with no refuse list and,
  unless he asks, no warning; a malformed value still fails loud. A safeguard
  against his settings serves only an attacker the trust model admits; one that
  would make a later deliberate setting cost a code change is not built without
  such an attacker.

## Tests

- Tests are executable evidence of approved requirements, never a source of
  product decisions. Each pins one observable behaviour, which its name
  states.
- Assert outcomes, not internals: no private fields, no mock call counts or
  order unless the interaction is the contract, no exact log strings or
  internal shapes outside it. A test a behaviour-preserving refactor breaks
  tests the wrong thing.
- Without a production contract, define the smallest owner and value contract
  first; tests never invent domain owners, protocol values or adapter details.
- For risky behaviour, write the failing test first, derived from the ruled
  sentence or approved plan (code may inform its setup, never its expected
  result), then the smallest implementation, then refactor under it. The
  independent reviewer judges that test against the contract. Syntax or
  mutation metrics gate only after a project pilot proves their signal and
  runtime cost.
- New behaviour gets a focused test, a bug fix a regression test at the
  observable boundary that owns the defect; a port fake only when the defect
  crosses a port.
- Every repository follows one proof strategy; only its numbers and reasoned
  exceptions differ. Tests are one proof beside types and structure rules,
  end-to-end runs through real flows, probes in operation and less code to
  prove; unit tests serve logic with many cases. A live check is a probe in
  operation, not a test layer: outside the gate, coverage and the fake,
  determinism and parallel rules, and never the only proof of logic CI can
  reach.
- Branch coverage is 100 % in every repository, measured over all test layers
  together; a branch an end-to-end test reaches gets no mirror unit test.
  Coverage serves deletion: a line no real flow and no logic rule reaches is
  dead or lacks a spec. Never buy the number with tests that only execute
  lines. Until a repository measures all layers, its CI holds its measured
  coverage as a floor that only rises; a failing check stays blocking.
- Drive flows through real entry points against real state, never through
  production logic re-implemented in the test. What a person does at a surface
  is proven by driving the real interface, never by a unit test.
- Pure logic is callable without a live process, service or network; a test
  that needs one to reach logic shows the logic is in the wrong layer. Real
  dependencies belong to a thin, separate integration layer. Core unit tests
  import no adapter: an adapter-bound module moves whole into the integration
  layer, told apart by its marker and never by a folder, a remaining exception
  carries one registered module marker (never a path allowlist), and the count
  per core directory ratchets toward zero.
- Tests are fast, deterministic and parallel-safe: no sleeps or timing races,
  no order dependence, no state another test can observe; filesystem, process,
  network, clock, randomness and external services come as temporary state or
  fakes. Tests run with the repository's configured parallel execution.
- Test code meets these rules: shared arrangement in fixtures and builders,
  cases that differ only in data as one parametrized test whose case ids state
  the behaviour. A suite several times the size of its code is almost always
  duplication.
- Our handling of agent and provider output is tested for failures and safety
  bounds; the model's answers are the provider's and are not tested.

## Documentation

- Update documentation in the change that alters behaviour, architecture,
  configuration, testing, tooling or usage.
- A document states what is true today, at the highest useful abstraction;
  plans, wishes and open work live in issues, and the landing that makes one
  true updates the document. The tree holds no history: git, pull requests,
  items and release pages keep it; the why stands in the present tense beside
  its code or in the architecture overview.
- Each document serves one named reader at one altitude and answers one
  question; the `write-docs` skill owns the document set and each type's
  reader, content, length budget and picture. Agent documents carry only what
  an agent cannot derive from the code; human overviews lead with the mental
  model and draw structure as diagram-as-code instead of describing it.
- No stale-prone inventories, file maps, line references, command transcripts
  or trivia. A terminal step the operator runs is a command the repository
  ships, named with its purpose, never a copied shell sequence.
- Facts have one owner: update it, never copy guidance. A view for another
  audience names its source and is regenerated, never edited apart. Every line
  is accurate and earns its keep; delete documentation the code no longer
  matches. Give an example only to prevent a likely misread; a code example has
  a real stack, imports, owner and configuration source.

## Reviews

Every review finding is marked **blocking** or **follow-up**.

- **Blocking** is a defect the reviewed diff introduces against the ruled
  sentences, the contract or a repository rule, and always anything touching
  data safety, security, secrets, a public contract or a failing check. It cites
  evidence, names the violated requirement or concrete safety defect, and states
  the consequence of leaving it; a broken check or contract needs no further
  damage estimate, but a proposed remedy still has to earn its complexity.
- The exception is a **tripwire**: a protective component whose owning spec, by
  operator ruling, declares it an aid for cooperative agents and names the
  boundary that stops a non-cooperative one. Its contract is the cases it lists;
  a gap outside them is a follow-up for its owning item and makes no lane
  material risk. An undeclared component counts as a boundary.
- **Follow-up** is polish with no behavioural effect, pre-existing behaviour the
  lane did not change (cite the unchanged evidence), or work outside the lane's
  scope (name its owning item). One inside a file the lane already changed,
  whose fix cannot change behaviour outside the reviewed diff (about ten lines),
  the lane's fixer resolves without a card, in the next fix batch or, when a
  review passes with it open, in one follow-up batch.
- A verdict of `architectural` stops the lane; it is never a follow-up.
- Only blocking findings make a `REVISE`; they go back to a builder step and
  earn a delta re-check. A review may raise the lane to material risk.
- A slice that neither proves a ruled line nor names it as deferred with its
  owner is unfinished.
- A file pinning a printed literal, key, spec ID, default value, command or
  public name the item changes is blocking when the diff neither changes it nor
  the body names it as deliberately untouched; where such pins span more than a
  handful of test modules, CI on the pushed branch is their proof.

## Local runs

- Frontend runs name their files, never `pnpm test` over the whole tree.
- A test that starts a process ends it before its worktree is removed.
