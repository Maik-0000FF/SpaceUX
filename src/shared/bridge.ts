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
  EditorAction,
  EditorDeviceInfo,
  MenuConfigChange,
  MenuConfigSnapshot,
  MenuOpenPayload,
  MenuWriteResult,
  PickIconResult,
  PieAppearance,
  PieBadges,
  PluginCatalogResult,
  PluginCategory,
  PluginImportResult,
  PluginInvalidatedPayload,
  PluginsState,
  PluginUninstallResult,
  FreecadBridgeInstallResult,
  FreecadBridgeStatus,
  ProfileActionResult,
  ProfilesState,
  ThemeChoice,
  WorkbenchMenusState,
  WorkbenchSeedResult,
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
  /** Pie corner indicators (#186 / #229): the active plugin's app icon and the
   *  active workbench's icon, each a data URI or null. Pushed just before
   *  onMenuOpen. */
  onPieBadge(handler: (badges: PieBadges) => void): () => void;
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
  /** Pull a shape plugin's entry-file source (#107). Mirrors the editor
   *  bridge's `getShapeSource`: the live overlay needs the same access
   *  so the pie can render plugin-supplied layouts via PieMenu. Resolves
   *  to the raw JS string, or null when the plugin can't be found /
   *  read. The renderer creates a Blob URL from the source and
   *  dynamic-imports it (script-src 'self' blob:). */
  getShapeSource(pluginId: string): Promise<string | null>;
  /** Subscribe to plugin-invalidation events (#269): a plugin was
   *  uninstalled or re-imported, so any renderer-side cache keyed on its
   *  id (currently the shape-modules store) should drop its entry. The
   *  handler filters on `kind` because each cache only owns one kind.
   *  Returns an unsubscribe fn. */
  onPluginInvalidated(handler: (payload: PluginInvalidatedPayload) => void): () => void;
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
  /** Subscribe to out-of-band config changes — an external file edit or a
   *  device/profile switch ({@link MenuConfigChange} carries the cause).
   *  Returns an unsubscribe fn. */
  onMenuConfigChanged(handler: (change: MenuConfigChange) => void): () => void;
  /** Pull the persisted theme choice once on mount (default 'system'). */
  getTheme(): Promise<ThemeChoice>;
  /** Persist a new theme choice. Fire-and-forget. */
  setTheme(theme: ThemeChoice): void;
  /** Open a native file-open dialog; resolves to the chosen absolute
   *  path, or null if cancelled. */
  pickFile(): Promise<string | null>;
  /** Open an image picker for a node icon; main encodes the chosen file into
   *  an inline data URI (size-guarded, SVG sanitized). */
  pickIcon(): Promise<PickIconResult>;
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
  /** Pull the connected device (button count + VID/PID/name + active
   *  profile id) on mount: clamps the button pickers (#66) and labels the
   *  active device/profile (#113). All-zero / null when no device. */
  getDeviceInfo(): Promise<EditorDeviceInfo>;
  /** Subscribe to device changes (hotplug swap / (un)plug, daemon
   *  (re)connect, or a profile switch) so the pickers re-clamp and the
   *  active-device display tracks live. Returns an unsubscribe fn. */
  onDeviceInfo(handler: (info: EditorDeviceInfo) => void): () => void;
  /** Pull the list of available actions (builtins + loaded plugins) on
   *  mount, to populate the Action dropdown. Id = the composite
   *  `pluginId/actionName` key; label/description for display. */
  getAvailableActions(): Promise<EditorAction[]>;
  /** Subscribe to "the action set changed" (plugins were re-loaded after an
   *  import/uninstall). The handler should re-pull getAvailableActions.
   *  Returns an unsubscribe fn. */
  onActionsChanged(handler: () => void): () => void;
  /** Pull the installed-plugins state (plugins + load errors) on mount. */
  getPlugins(): Promise<PluginsState>;
  /** Open a native folder picker and import the chosen plugin folder: main
   *  validates the manifest, copies it into the managed tree by `kind`, and
   *  reloads. Resolves with the outcome. */
  importPlugin(): Promise<PluginImportResult>;
  /** Uninstall an installed plugin (delete its managed folder) by kind + id;
   *  resolves to the new state after the reload. */
  uninstallPlugin(kind: PluginCategory, id: string): Promise<PluginUninstallResult>;
  /** Pull a plugin's command catalog for the palette (#76 D2). `loadAll`
   *  requests the complete set even when that's expensive (FreeCAD cycles
   *  every workbench). Resolves with the catalog or a failure reason. */
  getPluginCatalog(pluginId: string, loadAll: boolean): Promise<PluginCatalogResult>;
  /** Pull a shape plugin's entry-file source (#107 PR2): resolves to the
   *  raw JS string, or null when the plugin can't be found / read. The
   *  renderer creates a Blob URL from the source and dynamic-imports it
   *  to load the plugin's `layout` + `hitTest` functions into the
   *  renderer process. Cached by the renderer's shape-modules store. */
  getShapeSource(pluginId: string): Promise<string | null>;
  /** Subscribe to plugin-invalidation events (#269): a plugin was
   *  uninstalled or re-imported, so any renderer-side cache keyed on its
   *  id (currently the shape-modules store) should drop its entry. The
   *  handler filters on `kind` because each cache only owns one kind.
   *  Returns an unsubscribe fn. */
  onPluginInvalidated(handler: (payload: PluginInvalidatedPayload) => void): () => void;
  /** Pull the ids of curated per-workbench pies on mount (#193). */
  getWorkbenchMenus(): Promise<WorkbenchMenusState>;
  /** Subscribe to curated-pie add/remove changes. Returns an unsubscribe fn. */
  onWorkbenchMenusChanged(handler: (state: WorkbenchMenusState) => void): () => void;
  /** Seed a curated pie for a workbench from the live catalog (#193): resolves
   *  with the new `wb:` id (set it as the override next), or a failure reason.
   *  `overwrite` re-seeds an existing pie — only on a successful catalog pull,
   *  so a bridge error leaves the current file intact (#207). */
  seedWorkbench(
    pluginId: string,
    workbenchKey: string,
    overwrite?: boolean,
  ): Promise<WorkbenchSeedResult>;
  /** Delete a curated workbench pie (#207); clears the override if it was
   *  active. Resolves ok, or a failure reason. */
  deleteWorkbench(pluginId: string, workbenchKey: string): Promise<ProfileActionResult>;
  /** Pull the FreeCAD bridge-addon install status (#189): resolved Mod dir +
   *  whether the addon is installed, or why it can't be resolved. */
  getFreecadBridge(): Promise<FreecadBridgeStatus>;
  /** Install the bundled FreeCAD bridge addon into the resolved Mod dir (#189);
   *  re-running updates it. Resolves the destination path or a reason. */
  installFreecadBridge(pluginId: string): Promise<FreecadBridgeInstallResult>;
  /** Remove the installed FreeCAD bridge addon (#189). */
  uninstallFreecadBridge(): Promise<ProfileActionResult>;
  /** Pull the per-device profile list + manual override on mount (#113). */
  getProfiles(): Promise<ProfilesState>;
  /** Subscribe to profile-list / override changes (create / delete /
   *  override set). Returns an unsubscribe fn. */
  onProfilesChanged(handler: (state: ProfilesState) => void): () => void;
  /** Set the manual profile override (a profile id, or null for "Auto"
   *  device auto-detect). Resolves once the active config has re-resolved. */
  setProfileOverride(id: string | null): Promise<void>;
  /** Save the current active config as the connected device's profile.
   *  Fails when no device is connected. */
  saveProfile(): Promise<ProfileActionResult>;
  /** Delete a profile by id. */
  deleteProfile(id: string): Promise<ProfileActionResult>;
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
