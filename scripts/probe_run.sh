#!/usr/bin/env bash
# Run a probe stack's drive once the machine has room, capped and tied to this process.
#
# usage: probe-run [-k K CAP] [--] COMMAND [ARGUMENT...]
#
# Waits (up to an hour) until the 1-minute load average is below 1.5 x cores, then
# execs: setpriv --pdeathsig TERM timeout -k K CAP COMMAND...
# K is the seconds a stack gets to tear down after TERM (default 30), CAP the seconds
# it may run (default 1800); CAP + K stays within 1830.
#
# The tests inject PROBE_RUN_LOADAVG_FILE (the load source, default /proc/loadavg),
# PROBE_RUN_POLL_SECONDS (default 5) and PROBE_RUN_WAIT_SECONDS (default 3600).

set -euo pipefail

readonly LOAD_PER_CORE=1.5
readonly MAXIMUM_TOTAL_SECONDS=1830
kill_after=30
cap=1800

fail() {
  echo "probe-run: $1" >&2
  exit 2
}

# Four digits keep every duration far below the Bash integer limit before they are added.
is_positive_integer() {
  [[ $1 =~ ^[1-9][0-9]{0,3}$ ]]
}

if [[ ${1:-} == -k ]]; then
  [[ $# -ge 3 ]] || fail "-k needs K and CAP"
  kill_after=$2
  cap=$3
  shift 3
fi
[[ ${1:-} != -- ]] || shift
[[ $# -ge 1 ]] || fail "no command given; usage: probe-run [-k K CAP] [--] COMMAND [ARGUMENT...]"
is_positive_integer "$kill_after" || fail "K must be a positive integer of at most 4 digits, got '$kill_after'"
is_positive_integer "$cap" || fail "CAP must be a positive integer of at most 4 digits, got '$cap'"
((cap + kill_after <= MAXIMUM_TOTAL_SECONDS)) ||
  fail "CAP + K must be at most $MAXIMUM_TOTAL_SECONDS, got $((cap + kill_after))"

loadavg_file=${PROBE_RUN_LOADAVG_FILE:-/proc/loadavg}
poll_seconds=${PROBE_RUN_POLL_SECONDS:-5}
wait_seconds=${PROBE_RUN_WAIT_SECONDS:-3600}
cores=$(nproc)

load_is_below_limit() {
  local load
  read -r load _ <"$loadavg_file" || fail "cannot read a load average from $loadavg_file"
  [[ $load =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "no valid 1-minute load in $loadavg_file, got '$load'"
  awk -v load="$load" -v limit="$(awk -v c="$cores" -v p="$LOAD_PER_CORE" 'BEGIN { print c * p }')" \
    'BEGIN { exit !(load < limit) }'
}

waited=0
until load_is_below_limit; do
  if ((waited >= wait_seconds)); then
    fail "the 1-minute load stayed at or above $LOAD_PER_CORE x $cores cores for ${wait_seconds}s; no probe stack was started"
  fi
  sleep "$poll_seconds"
  waited=$((waited + poll_seconds))
done

exec setpriv --pdeathsig TERM timeout -k "$kill_after" "$cap" "$@"
