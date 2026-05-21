// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Renderer-side bridge type — what `window.spaceux` exposes to React.
 *
 * Lives in shared/ so the renderer never has to import from main/.
 * The actual implementation is in src/main/preload.ts where Electron's
 * contextBridge attaches an object matching this contract to the
 * renderer's globalThis. contextIsolation keeps everything else of
 * main/ invisible to the renderer.
 *
 * Adding a method here is a deliberate cross-process API change:
 *   1. add the method signature to SpaceUxBridge
 *   2. implement it in src/main/preload.ts (and any matching
 *      ipcMain.handle / webContents.send in src/main/index.ts)
 *   3. consume it from the renderer via window.spaceux.<method>()
 */

import type {
  DaemonStatusPayload,
  MenuConfigSnapshot,
  MenuOpenPayload,
  MenuWriteResult,
  PieAppearance,
  ThemeChoice,
} from './ipc';
import type { MenuConfig } from './menu';

/** Six signed axis values: TX, TY, TZ, RX, RY, RZ. */
export type AxesValues = [number, number, number, number, number, number];

/** Button-event payload — bnum is zero-based. */
export type ButtonEventPayload = { bnum: number; pressed: boolean };

export type SpaceUxBridge = {
  onAxes(handler: (values: AxesValues) => void): () => void;
  onButton(handler: (payload: ButtonEventPayload) => void): () => void;
  onDaemonStatus(handler: (payload: DaemonStatusPayload) => void): () => void;
  /** Pull the current menu config — used once on mount so the
   *  renderer never misses the config to a startup race. */
  getMenuConfig(): Promise<MenuConfig>;
  /** Main pushes a new config on hot-reload. */
  onMenuConfig(handler: (config: MenuConfig) => void): () => void;
  /** Pie menu opened at the given anchor (renderer-window coords). */
  onMenuOpen(handler: (payload: MenuOpenPayload) => void): () => void;
  /** Pie menu commit / dismiss request from main (no payload). */
  onMenuCommit(handler: () => void): () => void;
  invokeAction(key: string, config: Record<string, unknown>): Promise<void>;
  /** Ask main to actually hide the pie window. Called after the
   *  renderer's commit handler decides this is a real close (leaf
   *  fire or silent dismiss) and not a drill-into-submenu.
   *  Fire-and-forget — no acknowledgement, no error path. */
  closeMenu(): void;
  /** Pull the current pie appearance (theme + opacity) on mount. */
  getPieAppearance(): Promise<PieAppearance>;
  /** Main pushes the appearance when it changes (editor edit). */
  onPieAppearanceChanged(handler: (appearance: PieAppearance) => void): () => void;
};

/**
 * Editor-window bridge — what `window.editor` exposes to the editor
 * React app (src/editor). A deliberately separate, smaller contract
 * from SpaceUxBridge: the editor only reads/writes config, it never
 * subscribes to live puck axes or drives the pie. Implemented in
 * src/main/editor-preload.ts.
 */
export type EditorBridge = {
  /** Signal main that the editor renderer has mounted. Fire-and-forget. */
  ready(): void;
  /** Pull the current config snapshot ({config, mtime}) once on mount.
   *  The mtime is the baseline for conflict detection on writes. */
  getMenuConfig(): Promise<MenuConfigSnapshot>;
  /** Write an edited config back to disk. `expectedMtime` is the mtime
   *  the editor last saw; main rejects with a `conflict` result if the
   *  file changed underneath. Resolves with the new mtime on success. */
  setMenuConfig(config: MenuConfig, expectedMtime: number | null): Promise<MenuWriteResult>;
  /** Subscribe to out-of-band config changes (the file was edited
   *  outside the editor). Returns an unsubscribe fn. */
  onMenuConfigChanged(handler: (snapshot: MenuConfigSnapshot) => void): () => void;
  /** Pull the persisted theme choice once on mount (default 'system'). */
  getTheme(): Promise<ThemeChoice>;
  /** Persist a new theme choice. Fire-and-forget. */
  setTheme(theme: ThemeChoice): void;
  /** Open a native file-open dialog; resolves to the chosen absolute
   *  path, or null if cancelled. */
  pickFile(): Promise<string | null>;
  /** Subscribe to live SpaceMouse axis snapshots (forwarded by main while
   *  the editor is open) so the preview can highlight the live sector.
   *  Returns an unsubscribe fn. */
  onAxes(handler: (values: AxesValues) => void): () => void;
  /** Subscribe to live button press/release (forwarded by main) so live
   *  preview can commit/drill on the trigger button. Unsubscribe fn. */
  onButton(handler: (payload: ButtonEventPayload) => void): () => void;
  /** Report whether live preview is on, so main suppresses the real
   *  overlay pie (and skips axis forwarding) while the editor drives the
   *  preview with the puck. Fire-and-forget. */
  setLive(on: boolean): void;
  /** Pull the connected device's button count (from the daemon hello) so
   *  the button pickers offer only buttons that exist. 0 when no device
   *  or unknown. */
  getDeviceButtonCount(): Promise<number>;
  /** Subscribe to device button-count changes (hotplug swap / (un)plug,
   *  daemon (re)connect) so the pickers re-clamp live. Returns an
   *  unsubscribe fn. */
  onDeviceButtonCount(handler: (count: number) => void): () => void;
  /** Pull the current pie appearance (theme + opacity) on mount. */
  getPieAppearance(): Promise<PieAppearance>;
  /** Push a partial appearance change (theme and/or opacity). Main
   *  validates, persists, and re-broadcasts. Fire-and-forget. */
  setPieAppearance(patch: Partial<PieAppearance>): void;
  /** Main re-broadcasts the full appearance after any change, so the
   *  preview tracks edits (including this editor's own). */
  onPieAppearanceChanged(handler: (appearance: PieAppearance) => void): () => void;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    spaceux: SpaceUxBridge;
    editor: EditorBridge;
  }
}
