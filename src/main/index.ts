// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IpcChannel, type DaemonStatusPayload, type MenuOpenPayload } from '../shared/ipc.js';
import { DEFAULT_TRIGGER_BUTTON, type MenuConfig } from '../shared/menu.js';
import type { DaemonEvent } from '../shared/protocol.js';

import { BUILTIN_PLUGIN } from './builtins/index.js';
import { DaemonClient } from './daemon-client.js';
import { loadMenuConfig, menuConfigSearchPaths } from './menu-loader.js';
import { watchMenuConfig } from './menu-watcher.js';
import {
  indexActions,
  loadPlugins,
  makeActionContext,
  pluginSearchPaths,
} from './plugin-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev mode hands Vite the renderer; in production we load the built
// index.html from disk. The env var is the same one Vite's electron
// templates use so future tooling Just Works.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
const daemon = new DaemonClient();
let actionIndex: ReturnType<typeof indexActions> = {};
let menuConfig: MenuConfig | null = null;
let stopMenuWatcher: (() => void) | null = null;
// True between MENU_OPEN and MENU_COMMIT — drives the click-to-toggle
// trigger lifecycle so a second press commits instead of re-opening.
let menuShown = false;

async function createWindow(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  // Dev mode uses a normal opaque framed window so KDE Plasma
  // Wayland actually renders the surface (transparent + frameless
  // overlays often paint nothing visible until the compositor sees
  // an opaque region). Production drops the frame and goes
  // transparent + click-through as designed.
  const devMode = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: devMode ? Math.min(900, width) : width,
    height: devMode ? Math.min(700, height) : height,
    x: devMode ? undefined : 0,
    y: devMode ? undefined : 0,
    frame: devMode ? true : false,
    transparent: devMode ? false : true,
    backgroundColor: devMode ? '#101218' : undefined,
    alwaysOnTop: devMode ? false : true,
    skipTaskbar: devMode ? false : true,
    resizable: devMode,
    movable: devMode,
    show: devMode,
    title: 'SpaceUX (dev)',
    webPreferences: {
      // .cjs extension: preload is bundled by esbuild as CommonJS so
      // Electron's sandboxed preload context (which doesn't grok ESM
      // import statements) can load it. The main process itself stays
      // ESM — only this single file gets the CJS treatment.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Click-through only matters for the production transparent
  // overlay; the dev window is a normal interactive surface so
  // we can resize / click DevTools / etc.
  if (!devMode) {
    mainWindow.setIgnoreMouseEvents(true);
  }

  // Auto-open DevTools while we're still in MVP shake-down.
  // 'undocked' produces a true separate window that KDE Plasma
  // tracks individually; 'detach' was getting bundled under the
  // overlay's task-bar entry and disappearing visually.
  if (devMode) {
    mainWindow.webContents.openDevTools({ mode: 'undocked' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Trigger-button handler. Today the trigger is hard-wired to
 * DEFAULT_TRIGGER_BUTTON (Button 1 on the puck); Phase 2 of the
 * roadmap moves this into the user-editable menu config.
 *
 * Lifecycle:
 *   press   → capture cursor, show the overlay, send MENU_OPEN(x, y)
 *             so the renderer positions the pie at the cursor.
 *   release → send MENU_COMMIT (renderer picks the highlighted sector
 *             or dismisses if none) and hide the overlay.
 *
 * Multi-monitor caveat: the overlay window currently only covers the
 * primary display (see createWindow). If the cursor is on a secondary
 * display when the trigger fires, the pie still renders but lands
 * outside the visible window. Phase 3 of the roadmap resizes the
 * overlay to the display containing the cursor before show().
 */
function handleTriggerButton(bnum: number, pressed: boolean): void {
  if (!mainWindow) return;
  if (bnum !== DEFAULT_TRIGGER_BUTTON) return;
  // Click-to-toggle UX: press 1 opens, press 2 commits + closes.
  // Release events are intentionally ignored so the user can navigate
  // the open pie without holding the button down.
  if (!pressed) return;

  // show()/hide() drives the production transparent-overlay lifecycle.
  // In dev mode the window stays permanently visible so the debug
  // panel keeps showing axes between menu interactions.
  const togglesVisibility = app.isPackaged;

  if (menuShown) {
    mainWindow.webContents.send(IpcChannel.MENU_COMMIT);
    if (togglesVisibility) mainWindow.hide();
    menuShown = false;
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  const payload: MenuOpenPayload = {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
  };
  if (togglesVisibility) mainWindow.show();
  mainWindow.webContents.send(IpcChannel.MENU_OPEN, payload);
  menuShown = true;
}

function wireDaemonEvents(): void {
  daemon.on('connected', () => {
    daemon.subscribeAll();
  });

  daemon.on('event', (ev: DaemonEvent) => {
    if (!mainWindow) return;
    switch (ev.event) {
      case 'axes':
        mainWindow.webContents.send(IpcChannel.AXES, ev.values);
        break;
      case 'button':
        mainWindow.webContents.send(IpcChannel.BUTTON, { bnum: ev.bnum, pressed: ev.pressed });
        handleTriggerButton(ev.bnum, ev.pressed);
        break;
      case 'hello': {
        const payload: DaemonStatusPayload = {
          state: 'connected',
          axes: ev.axes,
          buttons: ev.buttons,
        };
        mainWindow.webContents.send(IpcChannel.DAEMON_STATUS, payload);
        break;
      }
    }
  });

  daemon.on('disconnected', () => {
    if (!mainWindow) return;
    const payload: DaemonStatusPayload = { state: 'disconnected', reason: 'socket closed' };
    mainWindow.webContents.send(IpcChannel.DAEMON_STATUS, payload);
  });

  daemon.on('error', (err: Error) => {
    // Daemon-side errors (ECONNREFUSED when the daemon isn't running)
    // are expected during development. Log but don't crash.
    // eslint-disable-next-line no-console
    console.warn(`[daemon] ${err.message}`);
  });
}

function wireActionDispatch(): void {
  ipcMain.handle(
    IpcChannel.INVOKE_ACTION,
    async (_evt, key: string, config: Record<string, unknown>) => {
      const entry = actionIndex[key];
      if (!entry) {
        throw new Error(`unknown action: ${key}`);
      }
      const handler = entry.plugin.handlers[entry.descriptor.name];
      if (!handler) {
        throw new Error(
          `plugin "${entry.plugin.manifest.id}" has no handler for "${entry.descriptor.name}"`,
        );
      }
      await handler(config, makeActionContext(entry.plugin.manifest.id));
    },
  );

  // Renderer-pulled menu config. Pull-based so the renderer can fetch
  // the current value at mount-time without racing the push-based
  // channel that handles hot-reloads later.
  ipcMain.handle(IpcChannel.GET_MENU_CONFIG, () => menuConfig);
}

app.whenReady().then(async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const { plugins, errors } = await loadPlugins(pluginSearchPaths(repoRoot));
  for (const err of errors) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin] skipped ${err.dir}: ${err.reason}`);
  }
  // Built-ins go first so they appear in error messages with the
  // friendly id; third-party plugins layered on top can shadow a
  // built-in only by colliding on the same composite action key,
  // which the indexer reports through its normal duplicate path.
  actionIndex = indexActions([BUILTIN_PLUGIN, ...plugins]);

  const searchPaths = menuConfigSearchPaths();
  const menuResult = await loadMenuConfig(searchPaths);
  if (menuResult.fallbackReason) {
    // eslint-disable-next-line no-console
    console.warn(`[menu-config] using defaults: ${menuResult.fallbackReason}`);
  }
  menuConfig = menuResult.config;

  // Hot-reload: re-read on every menu.json edit and push the new
  // config to the renderer. Renderer treats the push as authoritative
  // so the live pie reflects the file without an app restart.
  stopMenuWatcher = watchMenuConfig(searchPaths, (result) => {
    if (result.fallbackReason) {
      // eslint-disable-next-line no-console
      console.warn(`[menu-config] reload fell back to defaults: ${result.fallbackReason}`);
    } else if (result.source) {
      // eslint-disable-next-line no-console
      console.info(`[menu-config] reloaded from ${result.source}`);
    }
    menuConfig = result.config;
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, result.config);
  });

  wireActionDispatch();
  wireDaemonEvents();
  daemon.start();

  await createWindow();
});

app.on('window-all-closed', () => {
  daemon.stop();
  stopMenuWatcher?.();
  stopMenuWatcher = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
