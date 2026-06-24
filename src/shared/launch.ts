// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Launcher CLI contract (#497). The single `spaceux` launcher
 * (scripts/install.sh) runs the core for both interactive starts (app menu,
 * terminal) and the login autostart entry. The two differ only in whether the
 * editor opens:
 *
 *   - interactive (no flag): bring the core up and open the editor, so the very
 *     first click does something visible instead of just dropping a tray icon.
 *   - autostart (BACKGROUND_FLAG): bring the core up silently, no editor.
 *
 * The core (src/core-host/main.ts) reads the flag from argv; the autostart
 * entry carries it (src/main/autostart.ts). The bash launcher forwards its
 * arguments verbatim, so this string is the one source of truth on the Node
 * side; the launcher heredoc references it by name in a comment.
 */
export const BACKGROUND_FLAG = '--background';
