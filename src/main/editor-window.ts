// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same dev/prod switch the pie window uses: Vite serves the editor at
// /editor/index.html in dev (multi-page build, see vite.config.ts);
// production loads the built file next to the compiled main process.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let editorWindow: BrowserWindow | null = null;
let appIsQuitting = false;

/**
 * Flip the editor into "let me close for real" mode. Called from the
 * app's `before-quit` handler so the hide-on-close interceptor below
 * doesn't veto an actual quit (which would otherwise hang the exit).
 */
export function setAppQuitting(): void {
  appIsQuitting = true;
}

/**
 * Show the editor window, creating it on first use.
 *
 * Closing the window only *hides* it (the `close` interceptor below),
 * so reopening from the tray is instant and — once later PRs add
 * editor state — preserves the in-memory selection. The window is
 * destroyed for real only on app quit; the `closed` handler nulls the
 * reference so a post-destroy open cleanly re-creates rather than
 * touching a dead BrowserWindow.
 */
export function openEditorWindow(): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    if (editorWindow.isMinimized()) editorWindow.restore();
    editorWindow.show();
    editorWindow.focus();
    return editorWindow;
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'SpaceUX Editor',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: {
      // editor-preload.cjs (not preload.cjs): the editor renderer gets
      // window.editor, not window.spaceux. Bundled to .cjs by esbuild.
      preload: path.join(__dirname, 'editor-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    editorWindow = null;
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('editor/index.html', VITE_DEV_SERVER_URL).toString());
  } else {
    void win.loadFile(path.join(__dirname, '../editor/index.html'));
  }

  editorWindow = win;
  return win;
}
