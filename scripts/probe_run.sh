#!/usr/bin/env bash
# Run a probe stack's drive once the machine has room, capped and tied to this process.
#
# usage: probe-run [-k K CAP] [--] COMMAND [ARGUMENT...]
#        probe-run -h | --help
#
# Waits (up to an hour) until the 1-minute load average is below 1.5 x cores, then runs
# setpriv --pdeathsig TERM timeout -k K CAP COMMAND... as its child and waits for it.
# K is the seconds a stack gets to tear down after TERM (default 30), CAP the seconds
# it may run (default 1800); CAP + K stays within 1830.
#
# While it waits it watches the process that started it and ends without starting the
# command once that process is gone. The child checks once more after setpriv has armed the
# signal, since a probe-run or starter gone before that is never signalled, and then execs
# timeout.
# After the start the starter is watched on: once it ends, the command gets TERM and the
# status is 4.
#
# The command gets probe-run's stdin and the default INT and QUIT handling.
#
# SIGINT during the wait ends the script at once, without starting the command. After the
# start, SIGINT, SIGHUP and SIGTERM to probe-run (to its pid or, as Ctrl-C, to its process
# group) reach the command as one TERM through timeout, so its teardown runs and KILL follows
# only after K. timeout itself would KILL the command at once on a received INT or HUP.
#
# Exit status: 2 bad arguments or an unreadable load, 75 the load stayed at or
# above the limit for the whole wait (no command was started), 4 the starting process died
# (no command was started, or the started one got TERM), 130 interrupted during the wait (no
# command was started). After the start the status is the command's, except 130 after a
# SIGINT and 129 after a SIGHUP to probe-run.
#
# The tests inject PROBE_RUN_LOADAVG_FILE (the load source, default /proc/loadavg),
# PROBE_RUN_POLL_SECONDS (default 5) and PROBE_RUN_WAIT_SECONDS (default 3600); both
# durations are positive integers of at most 4 digits.

set -euo pipefail

readonly LOAD_HALVES_PER_CORE=3
readonly MAXIMUM_TOTAL_SECONDS=1830
readonly EXIT_BAD_INPUT=2
readonly EXIT_LOAD_TIMEOUT=75
readonly EXIT_PARENT_GONE=4
readonly EXIT_INTERRUPTED=130
readonly EXIT_HANGUP=129
kill_after=30
cap=1800
starter=$PPID
starter_ended_message="the process that started probe-run ended during the wait; no probe stack was started"

fail() {
  echo "probe-run: $1" >&2
  exit "${2:-$EXIT_BAD_INPUT}"
}

print_usage() {
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
}

# Four digits keep every duration far below the Bash integer limit before they are added.
is_positive_integer() {
  local candidate=$1
  [[ $candidate =~ ^[1-9][0-9]{0,3}$ ]]
}

if [[ ${1:-} == -h || ${1:-} == --help ]]; then
  print_usage
  exit 0
fi
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
poll_seconds=${PROBE_RUN_POLL_SECONDS-5}
wait_seconds=${PROBE_RUN_WAIT_SECONDS-3600}
is_positive_integer "$poll_seconds" || fail "PROBE_RUN_POLL_SECONDS must be a positive integer of at most 4 digits, got '$poll_seconds'"
is_positive_integer "$wait_seconds" || fail "PROBE_RUN_WAIT_SECONDS must be a positive integer of at most 4 digits, got '$wait_seconds'"
cores=$(nproc)

limit_text="$((LOAD_HALVES_PER_CORE / 2)).$((LOAD_HALVES_PER_CORE % 2 * 5))"
limit_whole=$((cores * LOAD_HALVES_PER_CORE / 2))
limit_has_half=$((cores * LOAD_HALVES_PER_CORE % 2))

# Pure Bash: the limit is a whole number or a whole number and a half, so compare the whole
# parts, and on a tie the first fraction digit against the half.
load_is_below_limit() {
  local load
  read -r load _ <"$loadavg_file" || fail "cannot read a load average from $loadavg_file"
  [[ $load =~ ^([0-9]{1,9})(\.([0-9]+))?$ ]] || fail "no valid 1-minute load in $loadavg_file, got '$load'"
  local whole=$((10#${BASH_REMATCH[1]})) fraction=${BASH_REMATCH[3]:-0}
  ((whole < limit_whole)) && return 0
  ((whole > limit_whole || !limit_has_half)) && return 1
  ((${fraction:0:1} < 5))
}

# setpriv --pdeathsig applies only from the exec, so the wait watches the starter itself.
starter_is_alive() {
  [[ -d /proc/$starter ]]
}

# Bash runs a trap only between commands, so the wait sleeps in the background and waits on it.
sleeper=""
end_wait_on_interrupt() {
  [[ -z $sleeper ]] || kill "$sleeper" 2>/dev/null || true
  echo "probe-run: interrupted during the wait; no probe stack was started" >&2
  exit "$EXIT_INTERRUPTED"
}
trap end_wait_on_interrupt INT

waited=0
while true; do
  starter_is_alive || fail "$starter_ended_message" "$EXIT_PARENT_GONE"
  load_is_below_limit && break
  if ((waited >= wait_seconds)); then
    fail "the 1-minute load stayed at or above $limit_text x $cores cores for ${wait_seconds}s; no probe stack was started" "$EXIT_LOAD_TIMEOUT"
  fi
  sleep "$poll_seconds" &
  sleeper=$!
  wait "$sleeper"
  sleeper=""
  waited=$((waited + poll_seconds))
done

# The signal survives the exec into the guard and on into timeout. A probe-run that ended since
# the last check is never signalled, and one whose own parent (the starter) ended has been
# given a new parent, which the guard sees.
readonly PARENT_GUARD='starter_now=$(sed -n "s/^PPid:[[:space:]]*//p" "/proc/$1/status" 2>/dev/null)
[[ $PPID == "$1" && $starter_now == "$2" ]] || { echo "probe-run: $4" >&2; exit "$3"; }; shift 4; exec "$@"'

# Bash runs a trap only between commands, so the child runs in the background and is waited on.
# Its status is reported as 130 or 129 once probe-run itself was interrupted or hung up.
child=""
requested_status=""
stop_requested=""
stop_stack() {
  [[ -z ${1:-} ]] || requested_status=$1
  stop_requested=1
  [[ -z $child ]] || kill -TERM "$child" 2>/dev/null || true
}
trap 'stop_stack "$EXIT_INTERRUPTED"' INT
trap 'stop_stack "$EXIT_HANGUP"' HUP
trap stop_stack TERM

# An async list in a script gets /dev/null as stdin and ignored INT and QUIT, so the command
# gets probe-run's stdin back and the default dispositions.
setpriv --pdeathsig TERM env --default-signal=INT,QUIT bash -c "$PARENT_GUARD" probe-run \
  "$$" "$starter" "$EXIT_PARENT_GONE" "$starter_ended_message" timeout -k "$kill_after" "$cap" "$@" <&0 &
child=$!
[[ -z $stop_requested ]] || kill -TERM "$child" 2>/dev/null || true

# A signal to probe-run's process group can end the watcher too, so its end alone proves nothing:
# a starter that ended has left probe-run a new parent.
starter_has_ended() {
  local key value
  while read -r key value; do
    [[ $key != PPid: ]] || { [[ $value != "$starter" ]]; return; }
  done <"/proc/$$/status"
}

# Waiting on the starter's pid directly is impossible, since it is not this process's child.
tail --pid="$starter" -f /dev/null &
starter_watcher=$!
watched=("$child" "$starter_watcher")
child_status=0
while true; do
  finished=""
  wait -n -p finished "${watched[@]}" && child_status=0 || child_status=$?
  [[ ${finished:-} != "$child" ]] || break
  if [[ ${finished:-} == "$starter_watcher" ]]; then
    if starter_has_ended; then
      echo "probe-run: the process that started probe-run ended; ending the probe stack" >&2
      stop_stack "$EXIT_PARENT_GONE"
    fi
    watched=("$child")
  fi
done
kill "$starter_watcher" 2>/dev/null || true
exit "${requested_status:-$child_status}"
