// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IpcChannel, type DaemonStatusPayload, type MenuOpenPayload } from '@/shared/ipc';
import { DEFAULT_TRIGGER_BUTTON, type MenuConfig } from '@/shared/menu';
import type { DaemonEvent } from '@/shared/protocol';

import { BUILTIN_PLUGIN } from './builtins';
import { DaemonClient } from './daemon-client';
import { loadMenuConfig } from './menu-loader';
import { indexActions, loadPlugins, makeActionContext, pluginSearchPaths } from './plugin-loader';

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

async function createWindow(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false, // Render the pie offscreen first; renderer toggles visibility.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Click-through by default. Phase 1 controls the pie purely with
  // the SpaceMouse — mouse interaction lands here later if we add
  // a "pick-with-cursor" mode.
  mainWindow.setIgnoreMouseEvents(true);

  // Push the current menu config to the renderer now that webContents
  // is ready. Done here (rather than blindly on app start) so the
  // renderer never receives a config before its IPC subscription is
  // installed.
  if (menuConfig) {
    mainWindow.webContents.send(IpcChannel.MENU_CONFIG, menuConfig);
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

  if (pressed) {
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const payload: MenuOpenPayload = {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
    };
    mainWindow.show();
    mainWindow.webContents.send(IpcChannel.MENU_OPEN, payload);
  } else {
    mainWindow.webContents.send(IpcChannel.MENU_COMMIT);
    mainWindow.hide();
  }
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

  const menuResult = await loadMenuConfig();
  if (menuResult.fallbackReason) {
    // eslint-disable-next-line no-console
    console.warn(`[menu-config] using defaults: ${menuResult.fallbackReason}`);
  }
  menuConfig = menuResult.config;

  wireActionDispatch();
  wireDaemonEvents();
  daemon.start();

  await createWindow();
});

app.on('window-all-closed', () => {
  daemon.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
