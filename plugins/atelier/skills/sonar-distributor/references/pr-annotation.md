# Reading a pull request's own new findings without a token

Part of the sonar-distributor skill. Sections quoted by name ("API access", "Clean as You Code", the procedure) live in `../SKILL.md`; "Shell rules" lives in `rules-by-language.md`.

The pull request analysis writes its findings into the GitHub check run as
annotations, so the caller's own GitHub credential reads them and no SonarCloud
token is involved (measured 06.09.2026 in overnightworks/home-tools and
overnightworks/hopin, independently reproduced). The analysis mode is
irrelevant: hopin runs the CI scanner and annotates exactly like home-tools on
Automatic Analysis.

```bash
head_sha="$(gh api "repos/<owner>/<repo>/pulls/<n>" --jq .head.sha)"
run="$(gh api "repos/<owner>/<repo>/commits/$head_sha/check-runs?per_page=100" --paginate \
  --jq '.check_runs[]
        | select(.name=="SonarCloud Code Analysis" and .status=="completed"
                 and (.conclusion=="success" or .conclusion=="failure"))
        | .id' | head -n1)"
if [ -z "$run" ]; then
  echo "no SonarCloud analysis for $head_sha — nothing was analysed" >&2
  false
else
  gh api "repos/<owner>/<repo>/check-runs/$run/annotations" --paginate
fi
```

Every guard there is load-bearing, because the naive form of the first call is
a silent zero of exactly the kind "API access" above forbids: a bare selector
prints nothing and exits zero when the commit carries no SonarCloud check run —
the app is absent, the fork skip fired, or the run is still queued — and no
output then reads as a count of none. **A query that answered about nothing
must never read as clean**: no identifier back means no analysis exists for
that commit, never a clean commit. Hence the `completed` filter, the explicit
stop, and `per_page=100` with `--paginate`, since a Sonar run that pages out of
a long check-run list looks exactly like one that was never created. Ask the
pull request for its head SHA each time: after a force-push the old head keeps
its check run and answers about code that is gone.

`completed` alone is not enough, and the measured case is cited two paragraphs
down: home-tools check run 101333510647 is `completed` with conclusion
`neutral`, and an identifier for it comes back to a reader who counts the empty
annotation list as zero findings. Only `success` and `failure` mean an analysis
was produced; `neutral`, `cancelled`, `timed_out`, `stale` and `skipped` are
the same nothing as a missing run. Reading the conclusion here is an existence
proof, not an answer about what was found.

This route reads with a different credential from the one that produced the
analysis, and its scope proof is of a different kind: the existence, on this
commit, of a check run that concluded `success` or `failure` is the proof.
That is what makes the stop above mandatory rather than cosmetic, and the
skipped job of "API access" is
the same hole one layer down — where a fork pull request has no token, nothing
is analysed and nothing is asserted.

An annotation carries `path`, `start_line`, `end_line`, `annotation_level`, the
rule message in `title`, and a SonarCloud deep link in `message`. It carries
**no rule key and no type**, and the level was `warning` for everything
measured, vulnerabilities included: two of the six annotations of home-tools
check run 101531038872 (commit `f1f222f`) resolve, read with the token, to
vulnerability-type issues of `githubactions:S8541`. That number also appears in
"Shell rules" below as `shell:S8541`, refused there because a packaged project
cannot take `--no-build`; home-tools declares no build system, so the flag
works and the finding was fixed rather than excepted. Whether a security
hotspot is annotated at all is **unknown** — no run in reach carried one. The
deep link points into the private SonarCloud project and resolves only for a
reader who has a SonarCloud login, so for the reader this route serves it is
decoration.

**Read the annotation count, never the check run's conclusion as the answer.**
Hopin check run 101501941091 (commit `665b41c`) is `success`, titled "Quality
Gate passed", while carrying an annotation for a real finding
(`src/hopin/app.py:24`, unused local variable). That is the ratings-not-counts
trap of the standing rulings below, seen through this route.

Three limits bound what a reader may conclude:

- **A branch analysis does not annotate.** The main-branch check run of
  home-tools, 101333510647, is `neutral`, "Quality Gate not computed", with
  zero annotations, whatever main carries.
- **The scope is the pull request analysis's own, new code** ("Clean as You
  Code" below). Measured positively: hopin's probe finding, introduced by its
  pull request, is annotated. Whether an untouched pre-existing finding is ever
  annotated is not measured from this side — five claudebot pull requests
  returned zero annotations, and a zero is what this entry forbids reading as a
  cause.
- **Only a push head carries a Sonar check run.** On home-tools PR #4 the five
  commits pushed behind the head have none.

The annotations listing pages too, hence `--paginate` on the second call.

The boundary is narrow, and reading it wider is how a lane calls itself clean
without having looked: **a builder in a private repository can read the
findings its own change introduced, and only those.** Zero annotations mean no
new finding, never a clean project — findings already on main stay invisible to
this route, and reading those keeps the credential and the scope proof above,
which stays the head's job.
