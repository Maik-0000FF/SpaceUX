// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * IPC channel identifiers shared between Electron main and renderer.
 *
 * Centralising the channel names here means refactoring renames in one
 * place. Both sides import the same constants so a typo doesn't
 * silently break a channel only one side knows about.
 */

export const IpcChannel = {
  /** Renderer subscribes; main pushes every axes snapshot. */
  AXES: 'spaceux:axes',
  /** Renderer subscribes; main pushes button press/release transitions. */
  BUTTON: 'spaceux:button',
  /** Main pushes connection-state changes (connected / disconnected / hello). */
  DAEMON_STATUS: 'spaceux:daemon-status',
  /** Renderer pulls the validated MenuConfig (defaults or user file)
   *  on mount via ipcRenderer.invoke. Pull instead of push so the
   *  startup race ("main sends before renderer subscribes") is
   *  unobservable — invoke returns the current value at call time. */
  GET_MENU_CONFIG: 'spaceux:get-menu-config',
  /** Main pushes a new config to the renderer on hot-reload (Phase 2
   *  uses fs.watch; the channel is wired now so we don't re-route
   *  later). The renderer treats this as authoritative for the
   *  current value. */
  MENU_CONFIG: 'spaceux:menu-config',
  /** Main signals the renderer to open the pie menu at the given anchor
   *  (renderer-window coordinates — main does the screen-to-window
   *  translation so the renderer never has to know about multi-monitor
   *  offsets). */
  MENU_OPEN: 'spaceux:menu-open',
  /** Main signals the renderer to commit the currently-highlighted
   *  sector (or dismiss if none is highlighted). Fires on trigger-
   *  button release. */
  MENU_COMMIT: 'spaceux:menu-commit',
  /** Renderer pushes user-action invocations toward main (which dispatches
   *  to the matching plugin handler). */
  INVOKE_ACTION: 'spaceux:invoke-action',
  /** Renderer asks main to actually hide the menu window. The
   *  trigger-button handler in main no longer hides on commit —
   *  it only sends MENU_COMMIT and lets the renderer decide whether
   *  to drill into a submenu (menu stays open) or actually close
   *  (leaf-commit, silent-dismiss). This channel is the renderer's
   *  callback for the "actually close" path. */
  CLOSE_MENU: 'spaceux:close-menu',
} as const;

export type DaemonStatusPayload =
  | {
      state: 'connected';
      axes: number;
      buttons: number;
      /** True if the daemon can inject keyboard chords (i.e. /dev/uinput
       *  was reachable at startup). Falsey means key-combo bindings
       *  will silently no-op — the UI should surface that. */
      inject: boolean;
      /** True if the daemon can drive the SpaceMouse status LED (i.e.
       *  it found and opened the matching hidraw node). Falsey means
       *  SET_LED commands silently no-op. */
      led: boolean;
    }
  | { state: 'disconnected'; reason: string };

/** Anchor point for the pie menu, in renderer-window pixel coords.
 *  The renderer centres the pie SVG on this point. */
export type MenuOpenPayload = {
  x: number;
  y: number;
};
