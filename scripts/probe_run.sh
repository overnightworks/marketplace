#!/usr/bin/env bash
# Run a probe stack's drive once the machine has room, capped and tied to this process.
#
# usage: probe-run [-k K CAP] [--] COMMAND [ARGUMENT...]
#        probe-run --wait-only
#        probe-run -h | --help
#
# Waits (up to an hour) until the 1-minute load average is below 1.5 x cores, then runs
# setpriv --pdeathsig TERM timeout -k K CAP COMMAND... as its child and waits for it.
# --wait-only takes no command: it runs the same wait alone and exits 0 once the load has room.
# K is the seconds a stack gets to tear down after TERM (default 30), CAP the seconds
# it may run (default 1800); CAP + K stays within 1830.
#
# While it waits it watches the process that started it and ends without starting the
# command once that process is gone. It then executes itself under setpriv --pdeathsig TERM,
# which keeps its pid and its parent, and checks that the starter is still the parent, since a
# starter gone before the signal was armed is never signalled. From the start on, the end of
# the starter reaches it as a TERM, which stops the stack like any other stop. The command's
# setpriv is armed the same way, so the stack also ends if probe-run is killed.
#
# The command gets probe-run's stdin and the default INT and QUIT handling.
#
# SIGINT during the wait ends the script at once, without starting the command. After the
# start, SIGINT, SIGHUP and SIGTERM to probe-run (to its pid or, as Ctrl-C, to its process
# group) reach the command as one TERM through timeout, so its teardown runs and KILL follows
# only after K. timeout itself would KILL the command at once on a received INT or HUP.
#
# Exit status: 0 with --wait-only once the load has room, 2 bad arguments or an unreadable load, 75 the load stayed at or
# above the limit for the whole wait (no command was started), 4 the starting process died
# before the command started, 130 interrupted during the wait (no command was started). After
# the start the status is the command's, except 130 after a SIGINT and 129 after a SIGHUP to
# probe-run.
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
readonly SUPERVISE_MARKER=--supervise
starter=$PPID
starter_ended_message="the process that started probe-run ended during the wait"
guard_refused_message="probe-run or the process that started it ended before the command started; no probe stack was started"

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

# The signal survives the exec into the guard and on into the supervisor or timeout. A process
# that ended since the last check is never signalled, and one whose own parent ended has been
# given a new parent, which the guard sees.
readonly PARENT_GUARD='[[ $PPID == "$1" ]] || { echo "probe-run: $3" >&2; exit "$2"; }; shift 3; exec "$@"'

# The supervisor is probe-run itself after the wait: it keeps the pid and the parent. Bash runs
# a trap only between commands, so the command's timeout runs in the background and is waited
# on. Its status is reported as 130 or 129 once probe-run was interrupted or hung up.
child=""
requested_status=""
stop_requested=""
term_sent=""
# A stop is translated into one TERM: timeout forwards each TERM it gets, so every further one
# would reach the command as another.
send_term_once() {
  [[ -n $child && -z $term_sent ]] || return 0
  term_sent=1
  kill -TERM "$child" 2>/dev/null || true
}
stop_stack() {
  [[ -z ${1:-} ]] || requested_status=$1
  stop_requested=1
  send_term_once
}

supervise() {
  local kill_after=$1 cap=$2
  shift 2
  trap 'stop_stack "$EXIT_INTERRUPTED"' INT
  trap 'stop_stack "$EXIT_HANGUP"' HUP
  trap stop_stack TERM
  # An async list in a script gets /dev/null as stdin and ignored INT and QUIT, so the command
  # gets probe-run's stdin back and the default dispositions.
  setpriv --pdeathsig TERM env --default-signal=INT,QUIT bash -c "$PARENT_GUARD" probe-run \
    "$$" "$EXIT_PARENT_GONE" "$guard_refused_message" timeout -k "$kill_after" "$cap" "$@" <&0 &
  child=$!
  [[ -z $stop_requested ]] || send_term_once
  local finished child_status=0
  while true; do
    finished=""
    wait -n -p finished "$child" && child_status=0 || child_status=$?
    [[ ${finished:-} != "$child" ]] || break
  done
  exit "${requested_status:-$child_status}"
}

# The first argument marks the supervisor that probe-run executes itself as once the load has room.
if [[ ${1:-} == "$SUPERVISE_MARKER" ]]; then
  shift
  supervise "$@"
fi
if [[ ${1:-} == -h || ${1:-} == --help ]]; then
  print_usage
  exit 0
fi
readonly WAIT_ONLY_FLAG=--wait-only
wait_only=""
no_stack_note="; no probe stack was started"
if [[ ${1:-} == "$WAIT_ONLY_FLAG" ]]; then
  [[ $# -eq 1 ]] || fail "$WAIT_ONLY_FLAG takes no command and no other argument"
  wait_only=1
  no_stack_note=""
elif [[ ${1:-} == -k ]]; then
  [[ $# -ge 3 ]] || fail "-k needs K and CAP"
  kill_after=$2
  cap=$3
  shift 3
fi
if [[ -z $wait_only ]]; then
  [[ ${1:-} != -- ]] || shift
  [[ $# -ge 1 ]] || fail "no command given; usage: probe-run [-k K CAP] [--] COMMAND [ARGUMENT...] | --wait-only"
  is_positive_integer "$kill_after" || fail "K must be a positive integer of at most 4 digits, got '$kill_after'"
  is_positive_integer "$cap" || fail "CAP must be a positive integer of at most 4 digits, got '$cap'"
  ((cap + kill_after <= MAXIMUM_TOTAL_SECONDS)) ||
    fail "CAP + K must be at most $MAXIMUM_TOTAL_SECONDS, got $((cap + kill_after))"
fi

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

# setpriv --pdeathsig applies only from the exec, so the wait watches the starter itself. A
# starter that ended has left probe-run a new parent, which also holds against pid reuse.
starter_has_ended() {
  local key value
  while read -r key value; do
    [[ $key != PPid: ]] || { [[ $value != "$starter" ]]; return; }
  done <"/proc/$$/status"
}

# Bash runs a trap only between commands, so the wait sleeps in the background and waits on it.
sleeper=""
end_wait_on_interrupt() {
  [[ -z $sleeper ]] || kill "$sleeper" 2>/dev/null || true
  echo "probe-run: interrupted during the wait$no_stack_note" >&2
  exit "$EXIT_INTERRUPTED"
}
trap end_wait_on_interrupt INT

waited=0
while true; do
  ! starter_has_ended || fail "$starter_ended_message$no_stack_note" "$EXIT_PARENT_GONE"
  load_is_below_limit && break
  if ((waited >= wait_seconds)); then
    fail "the 1-minute load stayed at or above $limit_text x $cores cores for ${wait_seconds}s$no_stack_note" "$EXIT_LOAD_TIMEOUT"
  fi
  sleep "$poll_seconds" &
  sleeper=$!
  wait "$sleeper"
  sleeper=""
  waited=$((waited + poll_seconds))
done

[[ -z $wait_only ]] || exit 0

exec setpriv --pdeathsig TERM bash -c "$PARENT_GUARD" probe-run \
  "$starter" "$EXIT_PARENT_GONE" "$guard_refused_message" "${BASH_SOURCE[0]}" "$SUPERVISE_MARKER" "$kill_after" "$cap" "$@"
