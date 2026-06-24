#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# End-to-end check of the single-instance guard (#415, #457 D6): a second launch
# of the core must defer to the running one instead of double-owning the bus. It
# brings up a real core, launches a second, and asserts the second exits 0
# promptly while the first stays the sole owner of org.spaceux.Core.
#
# Run under a private session bus, passing the core command, e.g.:
#   dbus-run-session -- bash scripts/second-launch-smoke.sh node dist/core-host/main.js
# Both launches use --background so neither tries to spawn the editor (no display
# needed); --background only suppresses the editor, the single-instance path is
# the same one an interactive launch takes.
set -uo pipefail

CORE=("$@")
[ ${#CORE[@]} -gt 0 ] || {
  echo "usage: $0 <core command...>" >&2
  exit 2
}
command -v gdbus >/dev/null || {
  echo "SKIP: gdbus not available" >&2
  exit 0
}
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || {
  echo "SKIP: no session bus (run under dbus-run-session)" >&2
  exit 0
}

NAME=org.spaceux.Core

# Isolate config/state so the test never reads or seeds the real user's files.
WORK="$(mktemp -d)"
export HOME="$WORK" XDG_CONFIG_HOME="$WORK/config" XDG_DATA_HOME="$WORK/data"

FIRST=""
cleanup() {
  [ -n "$FIRST" ] && kill "$FIRST" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

owner_of() {
  gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.GetNameOwner "$NAME" 2>/dev/null | tr -d "(),'"
}

# First core in the background; wait until it owns the bus name (up to ~15s).
"${CORE[@]}" --background >"$WORK/first.log" 2>&1 &
FIRST=$!
owner1=""
for _ in $(seq 1 60); do
  if ! kill -0 "$FIRST" 2>/dev/null; then
    echo "FAIL: the first core exited during startup"
    cat "$WORK/first.log"
    exit 1
  fi
  owner1="$(owner_of)"
  [ -n "$owner1" ] && break
  sleep 0.25
done
[ -n "$owner1" ] || {
  echo "FAIL: the first core never claimed $NAME"
  cat "$WORK/first.log"
  exit 1
}
echo "first core owns $NAME as $owner1"

# Second launch in the foreground: it must defer and exit 0 promptly. timeout
# guards against a hang (which would itself be the bug: a second core spinning up).
timeout 15 "${CORE[@]}" --background >"$WORK/second.log" 2>&1
ec=$?
echo "second launch exit code: $ec"
cat "$WORK/second.log"
[ "$ec" -eq 0 ] || {
  echo "FAIL: the second launch did not defer cleanly (exit $ec)"
  exit 1
}

# The first core must still be the sole owner: no takeover, no second instance.
owner2="$(owner_of)"
[ "$owner2" = "$owner1" ] || {
  echo "FAIL: $NAME owner changed ($owner1 -> ${owner2:-<none>})"
  exit 1
}
kill -0 "$FIRST" 2>/dev/null || {
  echo "FAIL: the first core is no longer running"
  exit 1
}

echo "ok: the second launch deferred; $NAME still owned by the first core"
