// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * IPC channel identifiers shared between Electron main and renderer.
 *
 * Centralising the channel names here means refactoring renames in one
 * place. Both sides import the same constants so a typo doesn't
 * silently break a channel only one side knows about.
 */

import type { MenuConfig } from './menu';

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
   *  callback for the "actually close" path. Fire-and-forget
   *  (renderer→main via `ipcRenderer.send`) — no return value, no
   *  error path, the renderer just signals intent. */
  CLOSE_MENU: 'spaceux:close-menu',

  // ── Editor window (separate renderer; window.editor bridge) ────────
  /** Editor renderer signals it has mounted. Fire-and-forget for now
   *  (PR Editor-1); a later PR will have main respond on this channel
   *  by pushing the current config so the editor never races startup. */
  EDITOR_READY: 'spaceux:editor:ready',
  /** Editor pulls the current config snapshot ({config, mtime}) on
   *  mount via ipcRenderer.invoke — same pull-not-push rationale as
   *  GET_MENU_CONFIG for the pie renderer. The mtime is the editor's
   *  conflict-detection baseline for later writes. */
  EDITOR_GET_MENU_CONFIG: 'spaceux:editor:menu-settings:get',
  /** Editor pushes an edited config back to main via invoke; main
   *  validates, writes atomically, and resolves with a MenuWriteResult
   *  (ok+new mtime / validation error / conflict). */
  EDITOR_SET_MENU_CONFIG: 'spaceux:editor:menu-settings:set',
  /** Main pushes a fresh snapshot to the editor when the file changed
   *  on disk from *outside* the editor (the editor's own writes are
   *  suppressed by the watcher's self-write window). Lets the editor
   *  resync instead of clobbering an external edit. */
  EDITOR_MENU_CONFIG_CHANGED: 'spaceux:editor:menu-settings:changed',
  /** Editor pulls the persisted theme choice on mount. */
  EDITOR_GET_THEME: 'spaceux:editor:theme:get',
  /** Editor persists a new theme choice (fire-and-forget). */
  EDITOR_SET_THEME: 'spaceux:editor:theme:set',
  /** Editor opens a native file-open dialog (for an exec command path);
   *  resolves to the chosen absolute path, or null if cancelled. */
  EDITOR_PICK_FILE: 'spaceux:editor:pick-file',
  /** Main forwards live SpaceMouse axis snapshots to the editor (only
   *  while the editor window exists) so the preview can highlight the
   *  sector under the puck in real time — the same stream as AXES. */
  EDITOR_AXES: 'spaceux:editor:axes',
  /** Main forwards button press/release to the editor (same stream as
   *  BUTTON) so live preview can commit/drill on the trigger button. */
  EDITOR_BUTTON: 'spaceux:editor:button',
} as const;

/** Editor colour theme. `system` follows the OS light/dark preference;
 *  `spaceux` is the branded palette. Persisted in editor-settings.json. */
export type ThemeChoice = 'system' | 'light' | 'dark' | 'spaceux';

/** Config plus the on-disk mtime it was read at. The editor snapshots
 *  the mtime and echoes it back on a write so main can detect a
 *  file-changed-underneath conflict. mtime is null when no file backed
 *  the config (fresh install running on DEFAULT_MENU_CONFIG). */
export type MenuConfigSnapshot = { config: MenuConfig; mtime: number | null };

/** Outcome of an editor write-back. Mirrors menu-writer's result so the
 *  same shape crosses the IPC boundary. The success case carries the
 *  *normalized* config (as written to disk) so main can keep its
 *  in-memory copy identical to the file. */
export type MenuWriteResult =
  | { ok: true; mtime: number; config: MenuConfig }
  | { ok: false; reason: string }
  | { ok: 'conflict'; mtime: number | null };

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
