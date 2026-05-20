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

import type { DaemonStatusPayload, MenuOpenPayload } from './ipc';
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
};

/**
 * Editor-window bridge — what `window.editor` exposes to the editor
 * React app (src/editor). A deliberately separate, smaller contract
 * from SpaceUxBridge: the editor only reads/writes config, it never
 * subscribes to live puck axes or drives the pie. Implemented in
 * src/main/editor-preload.ts.
 *
 * PR Editor-1 is read-only (mount → fetch config → render). Mutating
 * methods (`setMenuConfig`, change subscriptions) land in PR Editor-3a.
 */
export type EditorBridge = {
  /** Signal main that the editor renderer has mounted. Fire-and-forget. */
  ready(): void;
  /** Pull the current menu config once on mount. */
  getMenuConfig(): Promise<MenuConfig>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    spaceux: SpaceUxBridge;
    editor: EditorBridge;
  }
}
