// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEditorSettings, saveEditorSettings, type WindowBounds } from './editor-settings.js';
import { resourcePath } from './resources.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same dev/prod switch the pie window uses: Vite serves the editor at
// /editor/index.html in dev (multi-page build, see vite.config.ts);
// production loads the built file next to the compiled main process.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

const DEFAULT_BOUNDS: WindowBounds = { width: 1100, height: 720 };
const GEOMETRY_SAVE_DEBOUNCE_MS = 400;

/**
 * Whether saved bounds are still usable. A size-only record (no x/y) is
 * fine — Electron centres it. With a position, require its top-left to
 * land inside some current display's work area; otherwise the monitor it
 * was last on is gone and restoring would open the window off-screen.
 */
function boundsVisible(bounds: WindowBounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true;
  return screen.getAllDisplays().some(({ workArea: w }) => {
    return (
      bounds.x! >= w.x &&
      bounds.x! < w.x + w.width &&
      bounds.y! >= w.y &&
      bounds.y! < w.y + w.height
    );
  });
}

let editorWindow: BrowserWindow | null = null;
let appIsQuitting = false;
// Whether the editor's live preview is on (reported by the renderer over
// EDITOR_LIVE). Drives two suppressions in the daemon-event path: the real
// overlay pie (only when the editor is also focused) and axis forwarding.
let editorLive = false;

/** Record the editor's live-preview state (EDITOR_LIVE from the renderer). */
export function setEditorLive(on: boolean): void {
  editorLive = on;
}

/** True while the editor is consuming the live puck stream — gates axis
 *  forwarding so frames don't cross the IPC boundary with no subscriber. */
export function isEditorLive(): boolean {
  return editorLive;
}

/** True only when the editor is live *and* focused: in that state the
 *  trigger belongs to the preview, so main must not also pop the overlay
 *  pie. Focus distinguishes "driving the preview" from "puck used elsewhere
 *  with the editor merely open in the background". */
export function isEditorLiveFocused(): boolean {
  return (
    editorLive && editorWindow !== null && !editorWindow.isDestroyed() && editorWindow.isFocused()
  );
}

/**
 * Flip the editor into "let me close for real" mode. Called from the
 * app's `before-quit` handler so the hide-on-close interceptor below
 * doesn't veto an actual quit (which would otherwise hang the exit).
 */
export function setAppQuitting(): void {
  appIsQuitting = true;
}

/**
 * Send an IPC message to the editor renderer, if the window exists and
 * is alive. No-op otherwise (a hidden window still has live webContents,
 * so it stays in sync and is correct the moment it's shown again).
 */
export function sendToEditor(channel: string, payload: unknown): void {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.webContents.send(channel, payload);
  }
}

/**
 * Show the editor window, creating it on first use.
 *
 * On first open the saved geometry (editor-settings.json) is applied;
 * resizes/moves are persisted, debounced, and again on close. Closing
 * only *hides* the window (the `close` interceptor) so reopening from
 * the tray is instant; it's destroyed for real only on app quit, and
 * the `closed` handler nulls the reference so a later open re-creates.
 */
export async function openEditorWindow(): Promise<BrowserWindow> {
  if (editorWindow && !editorWindow.isDestroyed()) {
    if (editorWindow.isMinimized()) editorWindow.restore();
    editorWindow.show();
    editorWindow.focus();
    return editorWindow;
  }

  const settings = await loadEditorSettings();
  // Fall back to centred defaults if the saved position is off every
  // current display (e.g. the monitor it was on got disconnected).
  const bounds =
    settings.window && boundsVisible(settings.window) ? settings.window : DEFAULT_BOUNDS;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 560,
    title: 'SpaceUX Editor',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    // Window/taskbar icon instead of the default Electron logo, resolved
    // via resourcePath so it works both unpackaged and packaged. Sets
    // _NET_WM_ICON on X11. On Wayland the taskbar icon comes from a
    // .desktop file by app_id, not this option — see #50.
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      // editor-preload.cjs (not preload.cjs): the editor renderer gets
      // window.editor, not window.spaceux. Bundled to .cjs by esbuild.
      preload: path.join(__dirname, 'editor-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Persist geometry, debounced, on resize/move. Skip while maximized or
  // minimized so the *restorable* size is what gets remembered.
  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
        void saveEditorSettings({ window: win.getBounds() });
      }
    }, GEOMETRY_SAVE_DEBOUNCE_MS);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  win.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      win.hide();
    }
    // Capture the final geometry now rather than waiting on the debounce.
    if (saveTimer) clearTimeout(saveTimer);
    if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
      void saveEditorSettings({ window: win.getBounds() });
    }
  });
  win.on('closed', () => {
    editorWindow = null;
    // The renderer is gone, so its last EDITOR_LIVE report is stale.
    editorLive = false;
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('editor/index.html', VITE_DEV_SERVER_URL).toString());
  } else {
    void win.loadFile(path.join(__dirname, '../editor/index.html'));
  }

  editorWindow = win;
  return win;
}
