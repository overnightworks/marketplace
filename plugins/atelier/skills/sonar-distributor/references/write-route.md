# Last resort, and it writes: a whole tree's findings when the branch scope is refused

Part of the sonar-distributor skill. Sections quoted by name ("API access", "Clean as You Code", the procedure) live in `../SKILL.md`; "Shell rules" lives in `rules-by-language.md`.

**This route creates an analysis and replaces what other people read.** The
zero-write answer to the same question is already in the procedure above: land
the change and re-measure main (step 5). That finds the same finding one landing
later without touching anything anyone else sees, and it is what a reader should
reach for first. Take this route only when the answer must exist *before* the
landing, only on a pull request you own, and re-trigger CI on that head when you
are done.

It exists because nothing else reports a finding that is already in the tree
under a configuration main does not carry yet: a pull request analysis reports
**new code only**, main's analysis answers for main as main is configured, and
the branch scope is refused (below). Running the scanner in a pull request scope
with source-control detection off leaves the analysis no blame to date lines by,
so it reports the whole tree as new.

What a run costs, before you decide to make one:

- **It replaces the pull request's SonarCloud analysis** with one made outside
  CI — every line new, no coverage report — **and posts its own `SonarCloud Code
  Analysis` check run onto that commit.** GitHub shows only the latest check run
  per name, so yours becomes the one a reviewer reads; the CI run survives only
  in the API under `filter=all`. Measured on this repository's PR #31, commit
  `2c755a5`: three such check runs, of which CI made one, the displayed one was
  produced locally, and a hidden one still links to a branch scope that has since
  been deleted and that this plan refuses to read.
- **The repair is a new push or a manual CI re-run**, and neither happens by
  itself — on a branch whose work is finished there may never be another
  analysis, so the locally made one stays the answer on that commit.
- **The gate can flip in either direction.** Every line new and no coverage
  report is a different question from the one CI asked; where that check is
  required, it can block a clean change or clear a dirty one.
- **The decorations are permanent.** A branch entry deletes, a check run does
  not. Cleanup is best effort, so the only real containment is not running this
  where others read: an analysis nobody is allowed to read still changed what
  everybody sees.
- **The mess and the broom need different rights.** Creating a branch entry
  needs analysis rights, which any scan token has; deleting it needs
  `Administer` on the project (`api/webservices/list` states it for
  `api/project_branches/delete`). Check you hold both, or name the owner who
  does, before the first run.

Use the scanner the action runs at the version it resolves — the `scannerVersion`
default of `action.yml` at the SHA the workflow pins (this repository pins
`sonarqube-scan-action` v8.2.1, whose default is `8.1.0.6389`) — and verify the
download against the checksum the publisher ships beside it, since this is a
large binary run with the project's credential:

```bash
version=8.1.0.6389
archive="sonar-scanner-cli-$version-linux-x64.zip"
base="https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/$archive"
curl -fsSLO "$base" && curl -fsSLO "$base.sha256" &&
  printf '%s  %s\n' "$(cat "$archive.sha256")" "$archive" | sha256sum -c - &&
  unzip -q "$archive" &&
  SONAR_TOKEN="$(cat <credential>)" SONAR_HOST_URL=https://sonarcloud.io \
    "./sonar-scanner-$version-linux-x64/bin/sonar-scanner" \
    -Dsonar.pullrequest.key=<n> -Dsonar.pullrequest.branch=<head> -Dsonar.pullrequest.base=main \
    -Dsonar.scm.disabled=true -Dsonar.qualitygate.wait=false
```

It is one `&&` chain on purpose: a checksum that only prints its mismatch while
the next line unpacks and runs the binary anyway is the guard this ledger's own
cited finding is about. `-f` belongs on both downloads for the same reason one
step earlier: without it an error page is written into the file and the chain
stops at a checksum that cannot parse, which names the wrong cause and one step
too late.

The token goes in the environment, never `-Dsonar.token=`, for the `ps` reason
of "API access". Read the result under `pullRequest=<n>` with the API route in
SKILL.md "API access", and `api/components/tree` in the same scope for the file list, which
tells a finding that was fixed apart from a file that dropped out of scope.

Two refusals a reader hits first (measured here, 07.09.2026, scanner CLI
`8.1.0.6389`):

- **The branch scope is not the way out, and it is not refused where you
  expect.** `-Dsonar.branch.name=<branch>` uploads and processes — the compute
  engine task answers `SUCCESS` — and only the read is refused, HTTP 403
  `Organization is not allowed to access data from non main branches.` from
  `api/measures/component` and `api/issues/search` alike. A scan that was
  accepted is not an analysis you can read. The run leaves the branch in the
  project (`api/project_branches/list` shows it `SHORT`, no analysis date, no
  status); `POST api/project_branches/delete` with form fields `project` and
  `branch` removes it, under the rights named above. That message is quoted from
  the run's transcript and is not re-verified here, because re-verifying it means
  writing another analysis.
- **A pull request key that does not exist stops before anything is uploaded**:
  `ERROR Could not find the pullrequest with key '999999'`, `EXECUTION FAILURE`,
  no entry created. The key names a pull request that really exists; there is no
  inventing a scratch scope to keep the run out of everyone's way.

What the route is for, in one case: `githubactions:S8544` ("Python dependencies
should be locked to verified versions", type vulnerability) sat on this
repository's CI workflow, on a line no change touched, where every route in SKILL.md
("API access" and the procedure) reported zero. It was read this way and fixed in commit `3f02341`. The before-and-after pair was
measured in that lane and is deliberately not re-measured here — CI has since
overwritten the analysis that held it, exactly as the warning above says, and a
fresh measurement would mean another write.
