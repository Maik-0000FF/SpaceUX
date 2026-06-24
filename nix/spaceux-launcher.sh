#!@bash@/bin/bash
# shellcheck disable=SC2239  # @bash@ is a Nix build-time placeholder, substituted to an absolute bash path in nix/package.nix
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Launcher baked into the Nix package: starts the daemon in the background and
# runs the TypeScript core in the foreground (the core spawns the overlay /
# editor). SPACEUX_RESOURCE_ROOT points the core at the packaged binaries
# (build/) and assets; the Qt search paths let the spawned overlay/editor find
# their QML modules + the Wayland platform plugin. @placeholders@ are filled by
# substitute in nix/package.nix.
set -euo pipefail

export SPACEUX_RESOURCE_ROOT="@share@"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-wayland}"
export QML2_IMPORT_PATH="@qmlPath@${QML2_IMPORT_PATH:+:$QML2_IMPORT_PATH}"
export QT_PLUGIN_PATH="@pluginPath@${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"

"@share@/build/spaceux-daemon" &
DAEMON=$!
# Foreground core; the EXIT trap reaps the daemon when the core stops (mirrors
# the from-source launcher in scripts/install.sh).
trap 'kill "$DAEMON" 2>/dev/null || true' EXIT
exec "@node@/bin/node" "@share@/dist/core-host/main.js" "$@"
