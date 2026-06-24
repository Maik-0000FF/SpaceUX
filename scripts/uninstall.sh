#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# SpaceUX uninstaller (alpha). Removes only what scripts/install.sh added:
# the launcher, the desktop entry, the udev rule + uinput modules-load file, and
# optionally SpaceUX's own user data. It NEVER removes upstream dependencies
# (spacenavd, libspnav, Qt, Node, ...) or system packages, even if the installer
# offered to install them: other software may rely on them. The source checkout
# itself stays; delete the cloned folder by hand when you're done.
#
# Usage:
#   scripts/uninstall.sh             # remove launcher + desktop entry + system files
#   scripts/uninstall.sh --data      # also remove SpaceUX user data (config, plugins)
#   scripts/uninstall.sh --yes       # skip the confirmation prompt
# Flags combine.

set -euo pipefail

WITH_DATA=0
ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --data) WITH_DATA=1 ;;
        --yes | -y) ASSUME_YES=1 ;;
        -h | --help)
            sed -n '4,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "unknown flag: $arg (try --help)" >&2
            exit 2
            ;;
    esac
done

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }

LAUNCHER="$HOME/.local/bin/spaceux"
DESKTOP_FILE="$HOME/.local/share/applications/spaceux.desktop"
AUTOSTART_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/spaceux.desktop"
UDEV_RULE=/etc/udev/rules.d/99-spaceux-uinput.rules
UDEV_RULE_HIDRAW=/etc/udev/rules.d/99-spaceux-hidraw.rules
MODULES_CONF=/etc/modules-load.d/spaceux-uinput.conf
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/spaceux"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/spaceux"
SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/spaceux.sock"

say "Will remove (SpaceUX only):"
echo "  a running SpaceUX (core, tray, editor) is stopped first"
echo "  $LAUNCHER"
echo "  $DESKTOP_FILE"
echo "  $AUTOSTART_FILE (if you enabled launch-on-login)"
echo "  $UDEV_RULE        (sudo)"
echo "  $UDEV_RULE_HIDRAW       (sudo)"
echo "  $MODULES_CONF (sudo)"
if [[ $WITH_DATA -eq 1 ]]; then
    echo "  $CONFIG_DIR"
    echo "  $DATA_DIR"
    echo "  $SOCK"
fi

if [[ $ASSUME_YES -ne 1 ]]; then
    read -r -p "Proceed? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || {
        echo "aborted"
        exit 0
    }
fi

# ── Stop a running instance ─────────────────────────────────────────────────
# Uninstall means everything goes, including what is currently running: the
# deleted files cannot stop the live processes (the tray icon would survive in
# the panel, served by the old process). Close the editor through its own bus
# method (its close path flushes state), then stop the core by its bus-owner
# pid; the launcher's exit trap takes the daemon down with it. Best-effort:
# nothing here may abort the removal.
stop_running() {
    command -v gdbus >/dev/null 2>&1 || {
        warn "gdbus not found; stop a running SpaceUX yourself (tray > Quit)."
        return 0
    }
    gdbus call --session --dest org.spaceux.Editor \
        --object-path /org/spaceux/Editor \
        --method org.spaceux.Editor1.Quit >/dev/null 2>&1 || true
    local reply pid
    reply="$(gdbus call --session --dest org.freedesktop.DBus \
        --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.GetConnectionUnixProcessID \
        org.spaceux.Core 2>/dev/null)" || return 0
    # Reply form: (uint32 12345,); the LAST number is the pid (the first
    # belongs to the "uint32" type tag).
    pid="$(printf '%s' "$reply" | grep -o '[0-9]\+' | tail -1)"
    if [[ -n "$pid" ]]; then
        say "Stopping the running SpaceUX (pid $pid)"
        kill "$pid" 2>/dev/null || true
    fi
}
stop_running

say "Removing launcher + desktop entry"
rm -f -- "$LAUNCHER" "$DESKTOP_FILE" "$AUTOSTART_FILE"

if [[ -f "$UDEV_RULE" || -f "$UDEV_RULE_HIDRAW" || -f "$MODULES_CONF" ]]; then
    say "Removing system files (sudo)"
    sudo rm -f -- "$UDEV_RULE" "$UDEV_RULE_HIDRAW" "$MODULES_CONF"
    sudo udevadm control --reload-rules 2>/dev/null || true
fi

if [[ $WITH_DATA -eq 1 ]]; then
    say "Removing SpaceUX user data"
    # Guard: every target must end in a spaceux marker so an unset var can't
    # expand to something dangerous (mirrors private/cleanstart.sh).
    for t in "$CONFIG_DIR" "$DATA_DIR" "$SOCK"; do
        case "$t" in
            */spaceux | */spaceux.sock) ;;
            *)
                warn "skipping unexpected target: $t"
                continue
                ;;
        esac
        if [[ -e "$t" ]]; then
            rm -rf -- "$t"
            echo "  removed $t"
        fi
    done
fi

say "Done."
echo "Left untouched on purpose (remove by hand if you no longer want them):"
echo "  - spacenavd / libspnav (FreeCAD/Blender use these), and any other system packages"
echo "  - your membership in the 'input' group (gpasswd -d $(id -un) input to drop it)"
echo "  - the source checkout (delete the cloned folder yourself)"
[[ $WITH_DATA -eq 1 ]] || echo "  - SpaceUX user data (re-run with --data to remove it)"
