#!/bin/bash

# Usage: bin/run-tests.sh [playwright test arguments]
#   E2E_SHARDS=1 bin/run-tests.sh   # one stack/worker for debugging
#   bin/run-tests.sh --detach      # survives this shell
#   bin/run-tests.sh --status      # current progress or persisted verdict
#   bin/run-tests.sh --wait        # wait for the active run
#
# Use this wrapper: it bounds runtime, persists results, and reaps orphaned stacks
# and runner trees before/after runs. KIAO_E2E=1 marks harness stacks;
# KIAO_E2E_RUN=<pid> marks runner descendants and protects the current run.
# Manually started verification stacks are deliberately reaped: they hold shard ports.

set -uo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(dirname "$E2E_DIR")"
cd "$E2E_DIR" || exit 1

# Keep logs and JSON outside test-results/: Playwright empties that directory at startup.
LOG_DIR="$REPO_ROOT/log"
RUN_LOG="$LOG_DIR/e2e-run.log"
RUNNER_LOG="$LOG_DIR/e2e-runner.log"
RESULTS="$LOG_DIR/e2e-results.json"
SUMMARY="$LOG_DIR/e2e-summary.txt"
STATE="$LOG_DIR/e2e-run.state"

# Playwright’s globalTimeout should report first; this also bounds a hung Playwright.
BUDGET_SECONDS="${E2E_BUDGET_SECONDS:-2100}"

mkdir -p "$LOG_DIR"

# Persist key=value state for --status across shells and sessions.

state_set() {  # state_set key value...
  local key="$1"; shift
  local tmp="$STATE.tmp"
  { grep -v "^$key=" "$STATE" 2>/dev/null; echo "$key=$*"; } > "$tmp" && mv "$tmp" "$STATE"
}

state_get() { grep -m1 "^$1=" "$STATE" 2>/dev/null | cut -d= -f2-; }

# Keep empty args for whole-suite re-runs; expand the label only for display.
args_shown() { local a; a="$(state_get args)"; echo "${a:-(whole suite)}"; }

# Exclude this run’s descendants; KIAO_E2E_RUN must be exported before reaping.
leftover_pids() {
  local pid marker
  for pid in /proc/[0-9]*; do
    pid="${pid#/proc/}"
    [ "$pid" = "$$" ] && continue
    [ -r "/proc/$pid/environ" ] || continue
    if grep -qz '^KIAO_E2E=1$' "/proc/$pid/environ" 2>/dev/null; then echo "$pid"; continue; fi
    # Silence shell redirection errors too: /proc access can fail after the readability check.
    marker="$({ tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null | grep -m1 '^KIAO_E2E_RUN=' | cut -d= -f2-)"
    [ -n "$marker" ] && [ "$marker" != "${KIAO_E2E_RUN:-}" ] && echo "$pid"
  done
  pgrep -f 'bin/start-env\.sh' 2>/dev/null
}

reap() {
  local when="$1" pids attempt
  pids="$(leftover_pids | sort -un | tr '\n' ' ')"
  if [ -n "${pids// /}" ]; then
    echo "[e2e] reaping ${when}: $(wc -w <<< "$pids") leftover process(es) of an earlier run"
    # TERM lets start-env.sh’s trap remove its temporary store.
    kill -TERM $pids 2>/dev/null
    for attempt in $(seq 20); do
      pids="$(leftover_pids | sort -un | tr '\n' ' ')"
      [ -z "${pids// /}" ] && break
      sleep 0.5
    done
    [ -n "${pids// /}" ] && kill -KILL $pids 2>/dev/null
  fi
  # Remove temporary stores after killing their stacks.
  rm -rf /tmp/kiao-e2e-* 2>/dev/null
  return 0
}

progress() {  # how far a run has got, from the log alone
  local done total
  done="$(grep -c '\[chromium\] ›' "$RUN_LOG" 2>/dev/null)"
  total="$(grep -m1 -oP 'Running \K[0-9]+' "$RUN_LOG" 2>/dev/null)"
  echo "${done:-0}${total:+/$total} tests"
}

running_pid() {  # the pid of a live run, or nothing
  local pid; pid="$(state_get pid)"
  [ -n "$pid" ] && [ "$(state_get state)" = running ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}

# A dead pid without a verdict counts as ended; a live pid may still be recording startup.
verdict_pending() {
  [ -s "$STATE" ] || return 1
  [ "$(state_get announced)" = 1 ] && return 1
  [ -n "$(state_get finished)" ] && return 0
  local pid; pid="$(state_get pid)"
  [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null
}

do_status() {
  if [ ! -s "$STATE" ]; then
    echo "[e2e] no run on record. Start one with: bin/run-tests.sh --detach"
    return 0
  fi
  local state pid; state="$(state_get state)"; pid="$(state_get pid)"

  if [ "$state" = running ]; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "[e2e] RUNNING (pid $pid, started $(state_get started)) — $(progress) so far"
      echo "[e2e] args: $(args_shown)"
      tail -3 "$RUN_LOG" 2>/dev/null
      echo "[e2e] check again with --status, or block on it with --wait"
      return 0
    fi
    echo "[e2e] DIED — the run (pid $pid, started $(state_get started)) was killed before it could"
    echo "[e2e] report. It reached $(progress). Nothing here is a verdict on the code."
    echo "[e2e] run it again with: bin/run-tests.sh --detach $(state_get args)"
    return 3
  fi

  echo "[e2e] $state — started $(state_get started), finished $(state_get finished), exit $(state_get exit)"
  echo "[e2e] args: $(args_shown)"
  cat "$SUMMARY" 2>/dev/null
  [ "$state" = passed ] && return 0 || return 1
}

# Hooks report each finished run once; remain silent when nothing is new.
do_announce() {
  [ -s "$STATE" ] || return 0
  local state pid; state="$(state_get state)"; pid="$(state_get pid)"

  if [ "$state" = running ] && kill -0 "$pid" 2>/dev/null; then
    # Do not mark active runs announced: each turn must know not to start another.
    echo "[e2e] a run is in progress (pid $pid, $(progress)). Do not start another; read it with:"
    echo "[e2e]     e2e/bin/run-tests.sh --status"
    return 0
  fi

  [ "$(state_get announced)" = 1 ] && return 0
  state_set announced 1
  echo "[e2e] the e2e run started at $(state_get started) has ended since the last message:"
  do_status
}

# Only handles flat, single-line word fields: quoted hook_event_name or bare stop_hook_active.
# Missing/unsupported values return empty; callers supply defaults.
payload_field() {  # payload_field name payload
  printf '%s' "$2" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\?\([A-Za-z_]*\).*/\1/p' | head -1
}

# Hook event comes from stdin; the tty guard avoids blocking when invoked by hand.
do_announce_hook() {
  local payload=; [ -t 0 ] || payload="$(cat)"
  local event; event="$(payload_field hook_event_name "$payload")"
  [ -n "$event" ] || event=SessionStart

  [ "$event" = Stop ] && { do_stop_hook "$payload"; return 0; }

  # Hook context must name the actual event. Check Node before do_announce consumes
  # the verdict, or a failed emission would lose the one-time notification.
  command -v node >/dev/null 2>&1 || return 0
  local out; out="$(do_announce)"
  [ -n "$out" ] || return 0
  printf '%s' "$out" | E2E_HOOK_EVENT="$event" node -e 'const c = require("node:fs").readFileSync(0, "utf-8");
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: process.env.E2E_HOOK_EVENT, additionalContext: c,
      },
    }));'
}

# Stop requires a block decision to resume the turn. Only block for a pending verdict.
# do_announce sets announced=1 before returning to prevent repeated blocks;
# stop_hook_active also prevents blocking a continuation requested by a hook.
do_stop_hook() {
  local payload="$1"
  verdict_pending || return 0
  [ "$(payload_field stop_hook_active "$payload")" = true ] && return 0
  command -v node >/dev/null 2>&1 || return 0

  local out; out="$(do_announce)"
  [ -n "$out" ] || return 0
  { printf '%s\n' "$out"
    echo "[e2e] you were about to finish the turn with this unread. Tell the user how the run went"
    echo "[e2e] — and if it failed, what failed. If you have already reported it, one line is enough."
  } | node -e 'const r = require("node:fs").readFileSync(0, "utf-8");
    process.stdout.write(JSON.stringify({ decision: "block", reason: r }));'
}

do_wait() {
  local pid deadline
  pid="$(running_pid)" || true
  if [ -z "$pid" ]; then do_status; return $?; fi
  echo "[e2e] waiting on pid $pid (budget ${BUDGET_SECONDS}s)..."
  deadline=$((SECONDS + BUDGET_SECONDS + 60))
  while kill -0 "$pid" 2>/dev/null; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "[e2e] gave up waiting; the run is still alive."; return 2; }
    sleep 5
  done
  do_status
}

do_run() {
  local status
  # Export before reaping so this run’s descendants are excluded.
  export KIAO_E2E_RUN="$$"

  rm -f "$RESULTS" "$RUN_LOG" "$SUMMARY"
  : > "$STATE"
  state_set state running
  state_set pid "$$"
  state_set started "$(date '+%Y-%m-%d %H:%M:%S')"
  state_set args "$*"

  reap "before the run"
  # SIGKILL skips traps; --status must also check the pid.
  trap 'state_set state killed; reap "after the run"' EXIT

  echo "[e2e] running: playwright test ${*:-(whole suite)}"
  echo "[e2e] output → $RUN_LOG   (budget ${BUDGET_SECONDS}s)"

  timeout --kill-after=30s "${BUDGET_SECONDS}s" \
    npx playwright test "$@" > "$RUN_LOG" 2>&1
  status=$?

  # Timeout may leave partial JSON; retain a log fallback if summarising fails.
  {
    if [ "$status" = 124 ] || [ "$status" = 137 ]; then
      echo "[e2e] TIMED OUT — killed after ${BUDGET_SECONDS}s. What follows is whatever had been"
      echo "[e2e] written by then; raise E2E_BUDGET_SECONDS if the suite legitimately needs longer."
    fi
    if ! { [ -s "$RESULTS" ] && node bin/summarise-run.mjs "$RESULTS"; }; then
      echo "[e2e] no readable JSON report — the run died before Playwright could finish writing one."
      echo "[e2e] last 40 lines of $RUN_LOG:"
      tail -40 "$RUN_LOG" 2>/dev/null || echo "[e2e] (no log either — the run never started)"
    fi
  } > "$SUMMARY" 2>&1

  state_set finished "$(date '+%Y-%m-%d %H:%M:%S')"
  state_set exit "$status"
  case "$status" in
    0)       state_set state passed ;;
    124|137) state_set state "timed out" ;;
    *)       state_set state failed ;;
  esac
  trap 'reap "after the run"' EXIT

  echo
  cat "$SUMMARY"
  echo
  echo "[e2e] exit $status · full output $RUN_LOG · read this again with: bin/run-tests.sh --status"
  return "$status"
}

do_detach() {
  local pid
  if pid="$(running_pid)" && [ -n "$pid" ]; then
    echo "[e2e] a run is already going (pid $pid) — two would fight over the shard ports."
    echo "[e2e] follow it with --status, or kill it first."
    return 2
  fi
  # Clear stale state before spawning; wait for a live pid from the new run.
  : > "$STATE"
  # Use a separate session to survive the caller, and retain startup errors in RUNNER_LOG.
  # Use an absolute path because this script has already changed to E2E_DIR.
  setsid nohup "$E2E_DIR/bin/run-tests.sh" --in-background "$@" > "$RUNNER_LOG" 2>&1 &
  for _ in $(seq 60); do
    pid="$(state_get pid)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && break
    pid=""
    sleep 0.25
  done
  if [ -z "$pid" ]; then
    echo "[e2e] the detached run did not come up — see $RUN_LOG" >&2
    return 1
  fi
  echo "[e2e] started detached: pid $pid at $(state_get started), args: $(args_shown)"
  echo "[e2e] it now survives this shell. Read the verdict at any time, from anywhere:"
  echo "[e2e]     $E2E_DIR/bin/run-tests.sh --status"
}

case "${1:-}" in
  --status)        do_status ;;
  --announce)      do_announce ;;
  --announce-hook) do_announce_hook ;;   # what the SessionStart/UserPromptSubmit/Stop hooks call
  --wait)          do_wait ;;
  --detach)        shift; do_detach "$@" ;;
  --in-background) shift; do_run "$@" ;;   # internal: what --detach re-execs
  *)               do_run "$@" ;;
esac
