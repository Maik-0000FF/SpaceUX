// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The editor-data slice of the core service: menu config + write-back, theme,
 * actions, plugins, catalog, bridge and context. The live menu-config state
 * stays with the caller and is reached through the injected `deps`.
 */

import type {
  ContextSeedResult,
  EditorAction,
  PluginBridgeActionResult,
  PluginBridgeStatus,
  PluginCatalogResult,
  PluginImportResult,
  PluginKind,
  PluginsState,
  PluginUninstallDescriptorRequest,
  PluginUninstallResult,
  PluginUsageReport,
  ProfileActionResult,
} from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';
import type { HostEnvironment } from '../shared/plugin-types.js';

import type { CoreService } from './core-service.js';
import { isWindowSize, loadEditorSettings, saveEditorSettings } from './editor-settings.js';
import { markSelfWrite } from './menu-watcher.js';
import { writeMenuConfig } from './menu-writer.js';

export interface EditorIpcDeps {
  getConfig: () => MenuConfig | null;
  getMtime: () => number | null;
  /** The first-run fallback config when none is loaded yet: the icon-enriched
   *  default menu (#327 follow-up) so the editor's initial snapshot shows the
   *  showcase with themed icons, not the bare structural default. */
  getDefaultConfig: () => MenuConfig;
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
  uninstallPlugin: (kind: PluginKind, id: string) => Promise<PluginUninstallResult>;
  /** Scan saved menu configs + the global appearance for references to a
   *  plugin (#265): the Plugin Manager's Remove confirm shows where the
   *  plugin is in use before the user clicks through. */
  scanPluginUsages: (pluginId: string, kind: PluginKind) => Promise<PluginUsageReport>;
  /** Ask main for a plugin's uninstall hook descriptor (#267): main calls
   *  the plugin's `provideUninstall(ctx)`, caches the closure, and returns
   *  the user-facing message for the secondary Remove confirm. */
  getPluginUninstallHook: (pluginId: string) => Promise<PluginUninstallDescriptorRequest>;
  /** Run the cached uninstall-hook perform-closure for `pluginId` (#267). */
  performPluginUninstallHook: (pluginId: string) => Promise<ProfileActionResult>;
  /** Pull a plugin's command catalog for the editor palette (#76 D2): invokes
   *  the plugin's `provideCatalog` with a timeout. */
  getPluginCatalog: (pluginId: string, loadAll: boolean) => Promise<PluginCatalogResult>;
  /** Read the JS source of a shape plugin's `shape.entry` file (#107 PR2)
   *  for the renderer's Blob-URL dynamic import. Returns null when the
   *  plugin isn't found / wrong kind / source can't be read; main logs
   *  the precise reason. */
  getShapeSource: (pluginId: string) => Promise<string | null>;
  /** Ids of curated per-context pies that exist on disk (#193). */
  getContextMenus: () => Promise<string[]>;
  /** Seed a curated pie for a context from the live catalog (#193): pull the
   *  catalog, build the pie, write the file. `overwrite` re-seeds an existing
   *  pie (only on a successful pull). Resolves with the new `ctx:` id, or a
   *  failure reason (bridge down / context missing). */
  seedContext: (
    pluginId: string,
    contextKey: string,
    overwrite: boolean,
  ) => Promise<ContextSeedResult>;
  /** Delete a curated context pie (#207); clears the override if active. */
  deleteContext: (pluginId: string, contextKey: string) => Promise<ProfileActionResult>;
  /** A plugin's bridge install status, via its `provideBridge` hook (#288). */
  getPluginBridge: (pluginId: string) => Promise<PluginBridgeStatus>;
  /** Install / update a plugin's bridge into its resolved target (#288). */
  installPluginBridge: (pluginId: string) => Promise<PluginBridgeActionResult>;
  /** Remove a plugin's installed bridge (#288). */
  uninstallPluginBridge: (pluginId: string) => Promise<PluginBridgeActionResult>;
  /** The detected desktop/distro (#386), so the action-icon resolver can read
   *  the active icon theme the way the rest of the host does. */
  hostEnvironment: HostEnvironment;
}

export type EditorCoreService = Pick<
  CoreService,
  | 'GetMenuConfig'
  | 'SetMenuConfig'
  | 'GetAvailableActions'
  | 'GetTheme'
  | 'SetTheme'
  | 'GetEditorWindow'
  | 'SetEditorWindow'
  | 'GetPlugins'
  | 'ImportPlugin'
  | 'UninstallPlugin'
  | 'ScanPluginUsages'
  | 'GetPluginUninstallHook'
  | 'PerformPluginUninstallHook'
  | 'GetPluginCatalog'
  | 'GetShapeSource'
  | 'GetContextMenus'
  | 'SeedContext'
  | 'DeleteContext'
  | 'GetPluginBridge'
  | 'InstallPluginBridge'
  | 'UninstallPluginBridge'
>;

export function createEditorCoreService(deps: EditorIpcDeps): EditorCoreService {
  return {
    // Snapshot (config + mtime baseline) for the editor's mount + conflict check.
    GetMenuConfig: () => ({
      config: deps.getConfig() ?? deps.getDefaultConfig(),
      mtime: deps.getMtime(),
    }),
    // Write-back: pick the target, arm the watcher's self-write guard so our own
    // write doesn't echo back, atomic-write via menu-writer, and on success adopt
    // the normalised config + new mtime and hot-reload the live pie. Conflicts /
    // validation errors return verbatim for the editor to surface.
    SetMenuConfig: async (config, expectedMtime) => {
      const target = deps.getWriteTarget();
      if (target === undefined) {
        return { ok: false as const, reason: 'no writable config path available' };
      }
      markSelfWrite(target);
      const result = await writeMenuConfig(target, config, expectedMtime);
      if (result.ok === true) deps.applyWrite(result.config, result.mtime, target);
      return result;
    },
    GetAvailableActions: () => deps.listActions(),
    GetPlugins: () => deps.getPlugins(),
    ImportPlugin: (srcDir) => deps.importPlugin(srcDir),
    UninstallPlugin: (kind, id) => deps.uninstallPlugin(kind as PluginKind, id),
    ScanPluginUsages: (id, kind) => deps.scanPluginUsages(id, kind as PluginKind),
    GetPluginUninstallHook: (id) => deps.getPluginUninstallHook(id),
    PerformPluginUninstallHook: (id) => deps.performPluginUninstallHook(id),
    GetPluginCatalog: (id, loadAll) => deps.getPluginCatalog(id, loadAll),
    GetShapeSource: (id) => deps.getShapeSource(id),
    GetContextMenus: async () => ({ ids: await deps.getContextMenus() }),
    SeedContext: (id, key, overwrite) => deps.seedContext(id, key, overwrite),
    DeleteContext: (id, key) => deps.deleteContext(id, key),
    GetPluginBridge: (id) => deps.getPluginBridge(id),
    InstallPluginBridge: (id) => deps.installPluginBridge(id),
    UninstallPluginBridge: (id) => deps.uninstallPluginBridge(id),
    GetTheme: async () => (await loadEditorSettings()).theme ?? 'system',
    SetTheme: (theme) => {
      void saveEditorSettings({ theme });
    },
    GetEditorWindow: async () => {
      const saved = (await loadEditorSettings()).window;
      return saved ? { width: saved.width, height: saved.height } : null;
    },
    SetEditorWindow: (size) => {
      // Validate at the boundary: a malformed wire value is dropped. Round:
      // under fractional scaling the QML width/height are reals, but the
      // remembered size is whole pixels.
      if (!isWindowSize(size)) return;
      void saveEditorSettings({
        window: { width: Math.round(size.width), height: Math.round(size.height) },
      });
    },
  };
}
