// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeError } from '../shared/errors.js';
import {
  IpcChannel,
  type DaemonStatusPayload,
  type MenuConfigSnapshot,
  type MenuOpenPayload,
} from '../shared/ipc.js';
import { DEFAULT_MENU_CONFIG, DEFAULT_TRIGGER_BUTTON, type MenuConfig } from '../shared/menu.js';
import type { DaemonEvent } from '../shared/protocol.js';

import { BUILTIN_PLUGIN } from './builtins/index.js';
import { DaemonClient } from './daemon-client.js';
import { openEditorWindow, sendToEditor, setAppQuitting } from './editor-window.js';
import { KWinCursorService } from './kwin-cursor.js';
import { loadMenuConfig, menuConfigSearchPaths } from './menu-loader.js';
import { markSelfWrite, watchMenuConfig } from './menu-watcher.js';
import { writeMenuConfig } from './menu-writer.js';
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

// Overlay mode is the production look: transparent, frameless,
// click-through, hidden until the trigger button fires. True for
// packaged installs by default; setting SPACEUX_OVERLAY_MODE=1
// forces the same look in an unpackaged dev run so the production
// overlay surface can be tested without electron-builder packaging.
const OVERLAY_MODE = app.isPackaged || Boolean(process.env.SPACEUX_OVERLAY_MODE);

// Caps the dev-mode framed window so it fits on a typical laptop
// display without forcing the developer to alt-drag it smaller.
// Overlay mode ignores these — the window covers the full display
// under the cursor.
const DEV_WINDOW_MAX_WIDTH = 900;
const DEV_WINDOW_MAX_HEIGHT = 700;

// On KDE Plasma Wayland, Electron's screen.getCursorScreenPoint()
// is frozen (Wayland forbids clients from polling the global
// cursor). We round-trip through a KWin script over DBus when this
// flag is true. Other Wayland compositors (GNOME, Hyprland, ...)
// need their own backends; X11 doesn't need one because the
// Electron API works there.
const IS_KDE_WAYLAND =
  process.platform === 'linux' &&
  process.env.XDG_SESSION_TYPE === 'wayland' &&
  (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().includes('kde');

let mainWindow: BrowserWindow | null = null;
// Held at module scope so V8 doesn't garbage-collect the Tray — a
// collected tray icon silently vanishes from the system tray.
let tray: Tray | null = null;
let kwinCursor: KWinCursorService | null = null;
const daemon = new DaemonClient();
let actionIndex: ReturnType<typeof indexActions> = {};
let menuConfig: MenuConfig | null = null;
// Conflict-detection + write-back state for the editor. `mtime` is the
// on-disk mtime the live config was last read/written at; `source` is
// the file it came from (null = running on defaults, never saved).
// `searchPaths` is captured at startup so a write can fall back to the
// preferred XDG path when nothing has been saved yet.
let menuConfigMtime: number | null = null;
let menuConfigSource: string | null = null;
let menuSearchPaths: string[] = [];
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
  // an opaque region). Overlay mode drops the frame and goes
  // transparent + click-through as designed. OVERLAY_MODE is true
  // for packaged installs and when SPACEUX_OVERLAY_MODE=1 is set
  // from a dev run.
  const devMode = !OVERLAY_MODE;

  mainWindow = new BrowserWindow({
    width: devMode ? Math.min(DEV_WINDOW_MAX_WIDTH, width) : width,
    height: devMode ? Math.min(DEV_WINDOW_MAX_HEIGHT, height) : height,
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
    // On KDE Plasma Wayland (and other wlroots-based compositors)
    // a plain toplevel client cannot reposition itself — setBounds()
    // is a silent no-op because Wayland leaves window placement to
    // the compositor. Specific window types (`toolbar`, `utility`,
    // `dock`) are an opt-out: the compositor treats them as panel-
    // adjacent surfaces that may set their own geometry. We use
    // `toolbar` on KDE for that reason (`dock` would also let
    // setBounds() through, but it loses keyboard focus). We only set
    // it on Linux + overlay mode — the dev window stays a normal
    // toplevel so the dev WM treats it as a regular framed window.
    type: OVERLAY_MODE && process.platform === 'linux' ? 'toolbar' : undefined,
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

  if (!devMode) {
    // Promote the overlay above regular alwaysOnTop — on Plasma some
    // compositor placement rules apply differently to screen-saver-
    // level windows.
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
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

/** Pull the live cursor position. Prefers the KWin DBus service
 *  on KDE Wayland; falls back to Electron's API everywhere else
 *  (or when the KWin path fails for any reason). */
async function getCursor(): Promise<{ x: number; y: number }> {
  if (kwinCursor) {
    try {
      return await kwinCursor.getCursor();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] KWin script failed, falling back: ${describeError(err)}`);
    }
  }
  return screen.getCursorScreenPoint();
}

/**
 * Open the pie at the cursor. In overlay mode the window is first
 * moved + resized onto the display containing the cursor, so the pie
 * lands on the right monitor in multi-display setups. In dev mode
 * the small framed window stays put — moving it between displays on
 * every trigger would just confuse the developer flow, and the
 * cursor is almost certainly already inside the dev window anyway.
 */
async function openMenuAtCursor(window: BrowserWindow): Promise<void> {
  const cursor = await getCursor();
  let originX: number;
  let originY: number;
  if (OVERLAY_MODE) {
    const targetDisplay = screen.getDisplayNearestPoint(cursor);
    // Use workArea, not bounds: workArea excludes the desktop's
    // reserved zones (Plasma panels, taskbars, autohide-docks). Using
    // bounds places the overlay across the full display and lets the
    // pie sit under the panel, where the user can't see or click it.
    // workArea also makes the renderer-side clampPieAnchor consistent
    // across monitors with and without panels: window.innerWidth/Height
    // matches the visible area in both cases.
    window.setBounds(targetDisplay.workArea);
    originX = targetDisplay.workArea.x;
    originY = targetDisplay.workArea.y;
  } else {
    const bounds = window.getBounds();
    originX = bounds.x;
    originY = bounds.y;
  }
  const payload: MenuOpenPayload = {
    x: cursor.x - originX,
    y: cursor.y - originY,
  };
  if (OVERLAY_MODE) window.show();
  window.webContents.send(IpcChannel.MENU_OPEN, payload);
  // Light the SpaceMouse LED to mirror the pie's open state — calm
  // dark indicator at rest, bright while the user is making a
  // selection. daemon.setLed() short-circuits when the daemon
  // reported no LED capability, so the call is cheap on hosts
  // where the feature isn't available.
  daemon.setLed(true);
  menuShown = true;
}

/** Send the commit event to the renderer without hiding the window.
 *  The renderer decides whether the commit drills into a submenu
 *  (menu stays open) or actually closes — in the latter case it
 *  calls back via `IpcChannel.CLOSE_MENU` which triggers
 *  `hideMenuWindow` below. */
function commitMenu(window: BrowserWindow): void {
  window.webContents.send(IpcChannel.MENU_COMMIT);
}

/** Actually tear down the menu UI: drop the LED, hide the overlay
 *  window (dev mode keeps the framed window visible so the debug
 *  panel stays alive between interactions), and flip `menuShown`
 *  so the next trigger press opens a fresh menu. */
function hideMenuWindow(window: BrowserWindow): void {
  daemon.setLed(false);
  if (OVERLAY_MODE) window.hide();
  menuShown = false;
}

/**
 * Trigger-button handler. The active button comes from the live
 * menu config (`triggerButton`) and falls back to
 * :data:`DEFAULT_TRIGGER_BUTTON` when the user hasn't pinned one —
 * so a hot-reload of menu.json swaps the trigger live without an
 * app restart.
 *
 * Click-to-toggle UX: press 1 opens; subsequent presses commit the
 * currently-highlighted sector. A commit on a branch drills into
 * its submenu and the menu stays open — pressing the trigger again
 * commits within the deeper ring. A commit on a leaf (or with no
 * selection) closes the menu via the renderer-initiated
 * CLOSE_MENU IPC. Release events are intentionally ignored so the
 * user can navigate the open pie without holding the button down.
 */
function handleTriggerButton(bnum: number, pressed: boolean): void {
  if (!mainWindow) return;
  const activeTrigger = menuConfig?.triggerButton ?? DEFAULT_TRIGGER_BUTTON;
  if (bnum !== activeTrigger || !pressed) return;
  if (menuShown) {
    commitMenu(mainWindow);
  } else {
    void openMenuAtCursor(mainWindow).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[menu] openMenuAtCursor failed: ${describeError(err)}`);
    });
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
          // Older daemons (pre-#6) omit the field — coerce to false
          // so the renderer never sees `undefined` and the absence
          // is treated as "no injection" (matching the conservative
          // default in the type docs).
          inject: ev.inject === true,
          // Same `=== true` narrowing for the LED capability flag.
          led: ev.led === true,
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
      await handler(config, makeActionContext(entry.plugin.manifest.id, daemon));
    },
  );

  // Renderer-pulled menu config. Pull-based so the renderer can fetch
  // the current value at mount-time without racing the push-based
  // channel that handles hot-reloads later.
  ipcMain.handle(IpcChannel.GET_MENU_CONFIG, () => menuConfig);

  // Renderer requests a real close (leaf-commit or silent dismiss).
  // The trigger button only sends MENU_COMMIT now; it's the
  // renderer's job to decide whether the commit drills into a
  // submenu (no callback needed) or actually closes the menu
  // (this fire-and-forget callback hides the window). Uses
  // `ipcMain.on` rather than `handle` because there's no return
  // value the renderer would await — and a meaningless promise
  // round-trip would invite confused error-handling on the caller.
  ipcMain.on(IpcChannel.CLOSE_MENU, () => {
    if (mainWindow) hideMenuWindow(mainWindow);
  });
}

/** Editor-window IPC: the config read/write loop. */
function wireEditorIpc(): void {
  // Pull-based, like the renderer's GET_MENU_CONFIG: the editor gets the
  // current snapshot (config + mtime baseline) at mount without racing a
  // push. mtime feeds the editor's conflict detection on later writes.
  ipcMain.handle(
    IpcChannel.EDITOR_GET_MENU_CONFIG,
    (): MenuConfigSnapshot => ({
      config: menuConfig ?? DEFAULT_MENU_CONFIG,
      mtime: menuConfigMtime,
    }),
  );

  // Editor write-back. Validate + atomic-write happen in menu-writer;
  // here we pick the target path, arm the watcher's self-write guard so
  // our own write doesn't echo back, and on success adopt the new mtime
  // and hot-reload the live pie. Conflicts/validation errors are
  // returned verbatim for the editor to surface.
  ipcMain.handle(
    IpcChannel.EDITOR_SET_MENU_CONFIG,
    async (_evt, config: MenuConfig, expectedMtime: number | null) => {
      const target = menuConfigSource ?? menuSearchPaths[0];
      if (target === undefined) {
        return { ok: false as const, reason: 'no writable config path available' };
      }
      // Arm before writing so the rename's inotify event is suppressed.
      markSelfWrite(target);
      const result = await writeMenuConfig(target, config, expectedMtime);
      if (result.ok === true) {
        // Adopt the normalized config the writer persisted (not the raw
        // IPC arg) so the in-memory copy matches the file exactly.
        menuConfig = result.config;
        menuConfigMtime = result.mtime;
        menuConfigSource = target;
        // Hot-reload the live pie so an editor save takes effect at once.
        mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, result.config);
      }
      return result;
    },
  );

  // Editor mounted. No-op: the editor pulls via EDITOR_GET_MENU_CONFIG;
  // the handler exists so the renderer's fire-and-forget `ready()` has a
  // registered listener.
  ipcMain.on(IpcChannel.EDITOR_READY, () => {});
}

/** Create the system-tray icon and its context menu. The tray is the
 *  primary entry point to the editor window (the pie overlay has no
 *  chrome of its own). Icon is resolved from the repo `assets/` dir;
 *  nativeImage auto-selects `tray-icon@2x.png` on HiDPI displays. */
function createTray(repoRoot: string): void {
  // TODO(packaging): repoRoot is `__dirname/../..`, which points at the
  // real assets/ only while running unpackaged. Once app.isPackaged,
  // __dirname lives inside the asar and this path won't resolve — the
  // tray icon (and plugin/asset loading, which share this assumption)
  // need an extraResource/files bundling strategy.
  const icon = nativeImage.createFromPath(path.join(repoRoot, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('SpaceUX');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Editor', click: () => void openEditorWindow() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);
  // Left-click is inconsistent across Linux tray hosts (many route
  // everything through the context menu), but where it fires it's the
  // expected "open the app" gesture.
  tray.on('click', () => void openEditorWindow());
}

app.whenReady().then(async () => {
  if (OVERLAY_MODE && !app.isPackaged) {
    // eslint-disable-next-line no-console
    console.info(
      '[overlay] SPACEUX_OVERLAY_MODE=1 — window stays hidden until the trigger button fires',
    );
  }

  // Set up the KWin cursor service on KDE Wayland so the pie can
  // open under the real mouse on multi-display setups. Init failures
  // (no DBus, no KWin, unexpected version) leave kwinCursor null and
  // the app falls back to screen.getCursorScreenPoint().
  if (OVERLAY_MODE && IS_KDE_WAYLAND) {
    const service = new KWinCursorService();
    try {
      await service.init();
      kwinCursor = service;
      // eslint-disable-next-line no-console
      console.info('[cursor] KWin DBus cursor service ready');
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] KWin DBus cursor service unavailable: ${describeError(err)}`);
    }
  }

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
  menuSearchPaths = searchPaths;
  const menuResult = await loadMenuConfig(searchPaths);
  if (menuResult.fallbackReason) {
    // eslint-disable-next-line no-console
    console.warn(`[menu-config] using defaults: ${menuResult.fallbackReason}`);
  }
  menuConfig = menuResult.config;
  menuConfigMtime = menuResult.mtime;
  menuConfigSource = menuResult.source;

  // Hot-reload: re-read on every menu.json edit and push the new config
  // to both renderers. The editor's own writes are suppressed by the
  // watcher's self-write window, so a reload here always means an
  // *external* change — push it to the editor too (EDITOR_MENU_CONFIG_
  // CHANGED) so it resyncs instead of overwriting the external edit.
  stopMenuWatcher = watchMenuConfig(searchPaths, (result) => {
    if (result.fallbackReason) {
      // eslint-disable-next-line no-console
      console.warn(`[menu-config] reload fell back to defaults: ${result.fallbackReason}`);
    } else if (result.source) {
      // eslint-disable-next-line no-console
      console.info(`[menu-config] reloaded from ${result.source}`);
    }
    menuConfig = result.config;
    menuConfigMtime = result.mtime;
    menuConfigSource = result.source;
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, result.config);
    sendToEditor(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, {
      config: result.config,
      mtime: result.mtime,
    } satisfies MenuConfigSnapshot);
  });

  wireActionDispatch();
  wireEditorIpc();
  wireDaemonEvents();
  daemon.start();

  createTray(repoRoot);
  await createWindow();
});

// Let the editor window close for real on quit — without this its
// hide-on-close interceptor would veto the close and stall the exit.
app.on('before-quit', () => {
  setAppQuitting();
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
