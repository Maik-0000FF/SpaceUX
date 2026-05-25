// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { BrowserWindow, dialog, ipcMain } from 'electron';

import { ICON_MIME, MAX_ICON_BYTES, sanitizeSvg } from '../core/icon.js';
import { describeError } from '../shared/errors.js';
import {
  IpcChannel,
  type EditorAction,
  type FreecadBridgeInstallResult,
  type FreecadBridgeStatus,
  type MenuConfigSnapshot,
  type PickIconResult,
  type PluginCatalogResult,
  type PluginCategory,
  type PluginImportResult,
  type PluginsState,
  type PluginUninstallResult,
  type ProfileActionResult,
  type ThemeChoice,
  type WorkbenchMenusState,
  type WorkbenchSeedResult,
} from '../shared/ipc.js';
import { DEFAULT_MENU_CONFIG, type MenuConfig } from '../shared/menu.js';

import { loadEditorSettings, saveEditorSettings } from './editor-settings.js';
import { setEditorLive } from './editor-window.js';
import { markSelfWrite } from './menu-watcher.js';
import { writeMenuConfig } from './menu-writer.js';

/**
 * Hooks the editor IPC layer into main's live menu-config state. The
 * state itself stays in the app entry (it's shared with the pie trigger,
 * the watcher, and action dispatch); this layer reaches it through the
 * accessors here rather than owning it.
 */
export interface EditorIpcDeps {
  getConfig: () => MenuConfig | null;
  getMtime: () => number | null;
  /** Path the editor write should target, or undefined if none is known. */
  getWriteTarget: () => string | undefined;
  /** Adopt a successful write: update the in-memory config/mtime/source
   *  and hot-reload the live pie. */
  applyWrite: (config: MenuConfig, mtime: number, target: string) => void;
  /** The actions the editor can offer in the Action dropdown (builtins +
   *  loaded plugins), flattened from main's action index. */
  listActions: () => EditorAction[];
  /** Installed plugins + load errors for the plugin manager. */
  getPlugins: () => Promise<PluginsState>;
  /** Import the plugin folder at `srcDir`: validate, copy into the managed
   *  tree by `kind`, reload, and resolve with the outcome. */
  importPlugin: (srcDir: string) => Promise<PluginImportResult>;
  /** Uninstall a plugin (delete its managed folder) and reload; resolves to the
   *  refreshed state plus whether the delete actually succeeded (#221). */
  uninstallPlugin: (kind: PluginCategory, id: string) => Promise<PluginUninstallResult>;
  /** Pull a plugin's command catalog for the editor palette (#76 D2): invokes
   *  the plugin's `provideCatalog` with a timeout. */
  getPluginCatalog: (pluginId: string, loadAll: boolean) => Promise<PluginCatalogResult>;
  /** Ids of curated per-workbench pies that exist on disk (#193). */
  getWorkbenchMenus: () => Promise<string[]>;
  /** Seed a curated pie for a workbench from the live catalog (#193): pull the
   *  catalog, build the pie, write the file. `overwrite` re-seeds an existing
   *  pie (only on a successful pull). Resolves with the new `wb:` id, or a
   *  failure reason (bridge down / workbench missing). */
  seedWorkbench: (
    pluginId: string,
    workbenchKey: string,
    overwrite: boolean,
  ) => Promise<WorkbenchSeedResult>;
  /** Delete a curated workbench pie (#207); clears the override if active. */
  deleteWorkbench: (pluginId: string, workbenchKey: string) => Promise<ProfileActionResult>;
  /** FreeCAD bridge-addon install status: resolved Mod dir + installed? (#189). */
  getFreecadBridge: () => FreecadBridgeStatus;
  /** Install the bundled FreeCAD bridge addon into the resolved Mod dir (#189). */
  installFreecadBridge: (pluginId: string) => Promise<FreecadBridgeInstallResult>;
  /** Remove the installed FreeCAD bridge addon (#189). */
  uninstallFreecadBridge: () => Promise<ProfileActionResult>;
}

/**
 * Register the editor window's IPC handlers: config read/write, theme
 * get/set, and the native file picker.
 */
export function wireEditorIpc(deps: EditorIpcDeps): void {
  // Pull-based, like the renderer's GET_MENU_CONFIG: the editor gets the
  // current snapshot (config + mtime baseline) at mount without racing a
  // push. mtime feeds the editor's conflict detection on later writes.
  ipcMain.handle(
    IpcChannel.EDITOR_GET_MENU_CONFIG,
    (): MenuConfigSnapshot => ({
      config: deps.getConfig() ?? DEFAULT_MENU_CONFIG,
      mtime: deps.getMtime(),
    }),
  );

  // Editor write-back. Validate + atomic-write happen in menu-writer;
  // here we pick the target path, arm the watcher's self-write guard so
  // our own write doesn't echo back, and on success adopt the new mtime
  // and hot-reload the live pie (via deps.applyWrite). Conflicts /
  // validation errors are returned verbatim for the editor to surface.
  ipcMain.handle(
    IpcChannel.EDITOR_SET_MENU_CONFIG,
    async (_evt, config: MenuConfig, expectedMtime: number | null) => {
      const target = deps.getWriteTarget();
      if (target === undefined) {
        return { ok: false as const, reason: 'no writable config path available' };
      }
      // Arm before writing so the rename's inotify event is suppressed.
      markSelfWrite(target);
      const result = await writeMenuConfig(target, config, expectedMtime);
      // Adopt the normalized config the writer persisted (not the raw IPC
      // arg) so the in-memory copy matches the file exactly.
      if (result.ok === true) deps.applyWrite(result.config, result.mtime, target);
      return result;
    },
  );

  // Available actions for the Action dropdown. Pulled on mount, and re-pulled
  // when EDITOR_ACTIONS_CHANGED fires after a plugin import/uninstall.
  ipcMain.handle(IpcChannel.EDITOR_GET_ACTIONS, (): EditorAction[] => deps.listActions());

  // Plugin manager: list installed plugins, import a downloaded folder, or
  // uninstall one. Import opens a native folder picker (parented to the
  // editor) and hands the chosen path to main, which validates + copies it
  // into the managed tree and reloads.
  ipcMain.handle(IpcChannel.EDITOR_GET_PLUGINS, (): Promise<PluginsState> => deps.getPlugins());
  ipcMain.handle(IpcChannel.EDITOR_IMPORT_PLUGIN, async (): Promise<PluginImportResult> => {
    const parent = BrowserWindow.getFocusedWindow();
    const result = await (parent
      ? dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }));
    if (result.canceled || result.filePaths.length === 0) return { ok: 'cancelled' };
    return deps.importPlugin(result.filePaths[0]!);
  });
  ipcMain.handle(
    IpcChannel.EDITOR_UNINSTALL_PLUGIN,
    (_evt, kind: PluginCategory, id: string): Promise<PluginUninstallResult> =>
      deps.uninstallPlugin(kind, id),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_GET_PLUGIN_CATALOG,
    (_evt, pluginId: string, loadAll: boolean): Promise<PluginCatalogResult> =>
      deps.getPluginCatalog(pluginId, loadAll),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_GET_WORKBENCH_MENUS,
    async (): Promise<WorkbenchMenusState> => ({ ids: await deps.getWorkbenchMenus() }),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_SEED_WORKBENCH,
    (
      _evt,
      pluginId: string,
      workbenchKey: string,
      overwrite: boolean,
    ): Promise<WorkbenchSeedResult> => deps.seedWorkbench(pluginId, workbenchKey, overwrite),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_DELETE_WORKBENCH,
    (_evt, pluginId: string, workbenchKey: string): Promise<ProfileActionResult> =>
      deps.deleteWorkbench(pluginId, workbenchKey),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_GET_FREECAD_BRIDGE,
    (): FreecadBridgeStatus => deps.getFreecadBridge(),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_INSTALL_FREECAD_BRIDGE,
    (_evt, pluginId: string): Promise<FreecadBridgeInstallResult> =>
      deps.installFreecadBridge(pluginId),
  );
  ipcMain.handle(
    IpcChannel.EDITOR_UNINSTALL_FREECAD_BRIDGE,
    (): Promise<ProfileActionResult> => deps.uninstallFreecadBridge(),
  );

  // Editor mounted. No-op: the editor pulls via EDITOR_GET_MENU_CONFIG;
  // the handler exists so the renderer's fire-and-forget `ready()` has a
  // registered listener.
  ipcMain.on(IpcChannel.EDITOR_READY, () => {});

  // Live-preview on/off. Recorded in editor-window so the daemon-event path
  // can suppress the overlay pie (when focused) and gate axis forwarding.
  ipcMain.on(IpcChannel.EDITOR_LIVE, (_evt, on: boolean) => {
    setEditorLive(on === true);
  });

  // Theme preference, persisted in editor-settings.json (best-effort).
  ipcMain.handle(IpcChannel.EDITOR_GET_THEME, async (): Promise<ThemeChoice> => {
    return (await loadEditorSettings()).theme ?? 'system';
  });
  ipcMain.on(IpcChannel.EDITOR_SET_THEME, (_evt, theme: ThemeChoice) => {
    void saveEditorSettings({ theme });
  });

  // Native file-open dialog for the exec command path. Parented to the
  // focused window (the editor) so it's modal to it.
  ipcMain.handle(IpcChannel.EDITOR_PICK_FILE, async (): Promise<string | null> => {
    const parent = BrowserWindow.getFocusedWindow();
    const result = await (parent
      ? dialog.showOpenDialog(parent, { properties: ['openFile'] })
      : dialog.showOpenDialog({ properties: ['openFile'] }));
    return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
  });

  // Node-icon image picker: pick an image, read + encode it to an inline data
  // URI on main (size-guarded, SVG sanitized) so the renderer can draw it the
  // same way it will draw a plugin/bridge-provided icon.
  ipcMain.handle(IpcChannel.EDITOR_PICK_ICON, async (): Promise<PickIconResult> => {
    const parent = BrowserWindow.getFocusedWindow();
    const filters = [{ name: 'Images', extensions: ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }];
    const result = await (parent
      ? dialog.showOpenDialog(parent, { properties: ['openFile'], filters })
      : dialog.showOpenDialog({ properties: ['openFile'], filters }));
    if (result.canceled || result.filePaths.length === 0) return { ok: 'cancelled' };

    const file = result.filePaths[0]!;
    const mime = ICON_MIME[path.extname(file).toLowerCase()];
    if (mime === undefined) return { ok: false, reason: 'unsupported image type' };

    // Check the size via stat before reading, so a huge pick is rejected
    // without loading it all into memory first.
    let buf: Buffer;
    try {
      const { size } = await fs.stat(file);
      if (size > MAX_ICON_BYTES) {
        return {
          ok: false,
          reason: `image too large (${Math.round(size / 1024)} KB; max ${MAX_ICON_BYTES / 1024} KB)`,
        };
      }
      buf = await fs.readFile(file);
    } catch (err) {
      return { ok: false, reason: `cannot read file: ${describeError(err)}` };
    }

    const payload =
      mime === 'image/svg+xml' ? Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8') : buf;
    return { ok: true, dataUri: `data:${mime};base64,${payload.toString('base64')}` };
  });
}
