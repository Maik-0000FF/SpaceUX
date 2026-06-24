#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Boots the headless core and the Qt editor on a private session bus and runs
# the AT-SPI smoke (scripts/atspi-smoke.py). Expects to run under BOTH
# dbus-run-session and an X server (xvfb-run in CI):
#   xvfb-run -a dbus-run-session -- bash scripts/atspi-smoke.sh <spaceux-editor>
set -euo pipefail

EDITOR_BIN="${1:?usage: atspi-smoke.sh <path/to/spaceux-editor>}"

# Isolated state: the smoke must never read or touch a real configuration.
XDG_CONFIG_HOME="$(mktemp -d)"
XDG_DATA_HOME="$(mktemp -d)"
XDG_STATE_HOME="$(mktemp -d)"
export XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME

CORE_PID=""
EDITOR_PID=""
cleanup() {
    [ -n "$EDITOR_PID" ] && kill "$EDITOR_PID" 2>/dev/null || true
    [ -n "$CORE_PID" ] && kill "$CORE_PID" 2>/dev/null || true
}
trap cleanup EXIT

node dist/core-host/main.js &
CORE_PID=$!

# Wait for the core to own its bus name, so the editor's startup pulls land
# on a ready service instead of racing the bring-up. A core that never comes
# up fails the run HERE, with its own message, instead of as a confusing
# empty-editor assertion later.
core_ready=0
for _ in $(seq 1 60); do
    if dbus-send --session --dest=org.freedesktop.DBus --print-reply \
        /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner \
        string:org.spaceux.Core 2>/dev/null | grep -q 'boolean true'; then
        core_ready=1
        break
    fi
    sleep 0.5
done
if [ "$core_ready" -ne 1 ]; then
    echo "FAIL: the core never claimed org.spaceux.Core on the session bus" >&2
    exit 1
fi

# Force the Qt accessibility bridge on: a bare CI session has no desktop
# a11y flag, so without this the editor never registers on the AT-SPI bus.
QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 "$EDITOR_BIN" &
EDITOR_PID=$!

python3 scripts/atspi-smoke.py
