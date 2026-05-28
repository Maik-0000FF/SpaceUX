// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * IPC channel identifiers shared between Electron main and renderer.
 *
 * Centralising the channel names here means refactoring renames in one
 * place. Both sides import the same constants so a typo doesn't
 * silently break a channel only one side knows about.
 */

import type { MenuConfig } from './menu';
import type {
  NavStylePresetDescriptor,
  PluginCatalog,
  ShapePluginDescriptor,
} from './plugin-types';

export const IpcChannel = {
  /** Renderer subscribes; main pushes every axes snapshot. */
  AXES: 'spaceux:axes',
  /** Renderer subscribes; main pushes button press/release transitions. */
  BUTTON: 'spaceux:button',
  /** Main pushes connection-state changes (connected / disconnected / hello). */
  DAEMON_STATUS: 'spaceux:daemon-status',
  /** Renderer pulls the validated MenuConfig (defaults or user file)
   *  on mount via ipcRenderer.invoke. Pull instead of push so the
   *  startup race ("main sends before renderer subscribes") is
   *  unobservable — invoke returns the current value at call time. */
  GET_MENU_CONFIG: 'spaceux:get-menu-config',
  /** Main pushes a new config to the renderer on hot-reload (Phase 2
   *  uses fs.watch; the channel is wired now so we don't re-route
   *  later). The renderer treats this as authoritative for the
   *  current value. */
  MENU_CONFIG: 'spaceux:menu-config',
  /** Main pushes the active-plugin badge (#186) to the pie renderer just
   *  before MENU_OPEN — the active plugin's app icon (data URI) for the
   *  bottom-left indicator, or null when no plugin source is active. */
  PIE_BADGE: 'spaceux:pie-badge',
  /** Main signals the renderer to open the pie menu at the given anchor
   *  (renderer-window coordinates — main does the screen-to-window
   *  translation so the renderer never has to know about multi-monitor
   *  offsets). */
  MENU_OPEN: 'spaceux:menu-open',
  /** Main signals the renderer to commit the currently-highlighted
   *  sector (or dismiss if none is highlighted). Fires on trigger-
   *  button release. */
  MENU_COMMIT: 'spaceux:menu-commit',
  /** Renderer pushes user-action invocations toward main (which dispatches
   *  to the matching plugin handler). */
  INVOKE_ACTION: 'spaceux:invoke-action',
  /** Renderer asks main to actually hide the menu window. The
   *  trigger-button handler in main no longer hides on commit —
   *  it only sends MENU_COMMIT and lets the renderer decide whether
   *  to drill into a submenu (menu stays open) or actually close
   *  (leaf-commit, silent-dismiss). This channel is the renderer's
   *  callback for the "actually close" path. Fire-and-forget
   *  (renderer→main via `ipcRenderer.send`) — no return value, no
   *  error path, the renderer just signals intent. */
  CLOSE_MENU: 'spaceux:close-menu',

  // ── Editor window (separate renderer; window.editor bridge) ────────
  /** Editor renderer signals it has mounted. Fire-and-forget for now
   *  (PR Editor-1); a later PR will have main respond on this channel
   *  by pushing the current config so the editor never races startup. */
  EDITOR_READY: 'spaceux:editor:ready',
  /** Editor pulls the current config snapshot ({config, mtime}) on
   *  mount via ipcRenderer.invoke — same pull-not-push rationale as
   *  GET_MENU_CONFIG for the pie renderer. The mtime is the editor's
   *  conflict-detection baseline for later writes. */
  EDITOR_GET_MENU_CONFIG: 'spaceux:editor:menu-settings:get',
  /** Editor pushes an edited config back to main via invoke; main
   *  validates, writes atomically, and resolves with a MenuWriteResult
   *  (ok+new mtime / validation error / conflict). */
  EDITOR_SET_MENU_CONFIG: 'spaceux:editor:menu-settings:set',
  /** Main pushes a fresh snapshot to the editor when the file changed
   *  on disk from *outside* the editor (the editor's own writes are
   *  suppressed by the watcher's self-write window). Lets the editor
   *  resync instead of clobbering an external edit. */
  EDITOR_MENU_CONFIG_CHANGED: 'spaceux:editor:menu-settings:changed',
  /** Editor pulls the persisted theme choice on mount. */
  EDITOR_GET_THEME: 'spaceux:editor:theme:get',
  /** Editor persists a new theme choice (fire-and-forget). */
  EDITOR_SET_THEME: 'spaceux:editor:theme:set',
  /** Editor opens a native file-open dialog (for an exec command path);
   *  resolves to the chosen absolute path, or null if cancelled. */
  EDITOR_PICK_FILE: 'spaceux:editor:pick-file',
  /** Editor opens an image picker for a node icon; main reads + encodes the
   *  chosen file into an inline data URI (size-guarded, SVG sanitized).
   *  invoke → {@link PickIconResult}. */
  EDITOR_PICK_ICON: 'spaceux:editor:pick-icon',
  /** Main forwards live SpaceMouse axis snapshots to the editor (only
   *  while the editor window exists) so the preview can highlight the
   *  sector under the puck in real time — the same stream as AXES. */
  EDITOR_AXES: 'spaceux:editor:axes',
  /** Main forwards button press/release to the editor (same stream as
   *  BUTTON) so live preview can commit/drill on the trigger button. */
  EDITOR_BUTTON: 'spaceux:editor:button',
  /** Editor renderer reports its live-preview on/off state. Main uses it
   *  to (a) suppress the real overlay pie while the editor is focused and
   *  driving the preview with the puck — otherwise the same trigger press
   *  pops the overlay pie and drills the preview — and (b) skip the axis
   *  forwarding above when no one is listening. Fire-and-forget. */
  EDITOR_LIVE: 'spaceux:editor:live',
  /** Editor pulls the connected device (button count + VID/PID/name +
   *  active profile id) on mount: the count clamps its button pickers
   *  (#66), the identity + profile label the active device/profile (#113).
   *  See {@link EditorDeviceInfo}. The pull covers the mount-time value;
   *  live changes arrive on EDITOR_DEVICE below. */
  EDITOR_GET_DEVICE: 'spaceux:editor:device:get',
  /** Main pushes the device ({@link EditorDeviceInfo}) to the editor
   *  whenever it changes (hotplug swap / (un)plug, daemon (re)connect, or
   *  a profile switch) so an open editor re-clamps its pickers (#66 PR 2b)
   *  and updates the active-device/profile display (#113). Pairs with the
   *  EDITOR_GET_DEVICE pull for the initial value. */
  EDITOR_DEVICE: 'spaceux:editor:device',
  /** Editor pulls the per-device profile list + the manual override on
   *  mount ({@link ProfilesState}, #113). */
  EDITOR_GET_PROFILES: 'spaceux:editor:profiles:get',
  /** Main pushes {@link ProfilesState} when the list or the override
   *  changes (create / delete / override set). */
  EDITOR_PROFILES_CHANGED: 'spaceux:editor:profiles:changed',
  /** Editor sets the manual profile override (a profile id, or null for
   *  "Auto" = device auto-detect). invoke; resolves after re-resolution. */
  EDITOR_SET_PROFILE_OVERRIDE: 'spaceux:editor:profiles:override',
  /** Editor saves the current active config as the connected device's
   *  profile. invoke → {@link ProfileActionResult} (fails when no device
   *  is connected). */
  EDITOR_SAVE_PROFILE: 'spaceux:editor:profiles:save',
  /** Editor deletes a profile by id. invoke → {@link ProfileActionResult}. */
  EDITOR_DELETE_PROFILE: 'spaceux:editor:profiles:delete',

  /** Editor pulls the list of available actions on mount, to populate the
   *  Action dropdown ({@link EditorAction}[], builtins + loaded
   *  plugins). invoke. */
  EDITOR_GET_ACTIONS: 'spaceux:editor:actions:get',
  /** Main pushes when the action set changed because plugins were
   *  (re)loaded — i.e. the user imported or removed a plugin. The editor
   *  re-pulls EDITOR_GET_ACTIONS so the Action dropdown reflects a freshly
   *  imported plugin without an editor restart. */
  EDITOR_ACTIONS_CHANGED: 'spaceux:editor:actions:changed',

  // ── Plugin manager (#NNN): plugins live in a managed, per-category tree
  //    under the data dir (extensions/<kind>/<id>/). The user imports a
  //    downloaded plugin folder (it's copied in) rather than configuring
  //    arbitrary load paths. ─────────────────────────────────────────────
  /** Editor pulls the current {@link PluginsState} (installed plugins +
   *  load errors) on mount. invoke. */
  EDITOR_GET_PLUGINS: 'spaceux:editor:plugins:get',
  /** Editor asks main to open a native folder picker and import the chosen
   *  plugin folder: validate its manifest, copy it into the managed tree by
   *  its `kind`, and reload. invoke → {@link PluginImportResult}. */
  EDITOR_IMPORT_PLUGIN: 'spaceux:editor:plugins:import',
  /** Editor uninstalls an installed plugin (deletes its managed folder),
   *  identified by kind + id. invoke → the new {@link PluginsState}. */
  EDITOR_UNINSTALL_PLUGIN: 'spaceux:editor:plugins:uninstall',
  /** Editor pulls a plugin's command catalog for the palette (#76 D2):
   *  invoke({ pluginId, loadAll }) → {@link PluginCatalogResult}. Main calls
   *  the plugin's `provideCatalog` (with a timeout); a plugin without one, or
   *  an unreachable bridge, yields `{ ok: false, reason }`. */
  EDITOR_GET_PLUGIN_CATALOG: 'spaceux:editor:plugins:catalog',
  /** Either renderer pulls a shape plugin's entry-file source (#107):
   *  invoke(pluginId) → string | null. Main resolves the plugin's
   *  `shape.entry` against its install dir, reads the JS file as UTF-8,
   *  and returns the source. The renderer creates a Blob URL and
   *  dynamic-imports it (script-src 'self' blob:); sources are pulled
   *  lazily (first selection) and cached renderer-side. Returns null on
   *  any failure (plugin not found, wrong kind, file read error, size
   *  cap, non-regular file), with the reason logged in main. Used by
   *  both the live overlay's `window.spaceux.getShapeSource` and the
   *  editor's `window.editor.getShapeSource`; one main-side handler. */
  GET_SHAPE_SOURCE: 'spaceux:plugins:shape-source',
  /** Editor pulls the ids of curated per-workbench pies on mount (#193, PR2c):
   *  invoke → {@link WorkbenchMenusState}. Tells the FreeCAD dropdown which
   *  workbenches already have a curated pie. */
  EDITOR_GET_WORKBENCH_MENUS: 'spaceux:editor:workbench-menus:get',
  /** Main pushes {@link WorkbenchMenusState} when a curated pie is added /
   *  removed on disk, so the dropdown's markers stay in sync. */
  EDITOR_WORKBENCH_MENUS_CHANGED: 'spaceux:editor:workbench-menus:changed',
  /** Editor seeds a curated pie for a workbench from the live catalog (#193):
   *  invoke({ pluginId, workbenchKey, overwrite }) → {@link WorkbenchSeedResult}.
   *  Main pulls the catalog, builds the pie, and writes the file; `overwrite`
   *  re-seeds an existing curated pie (only on a successful pull, so a bridge
   *  error leaves the current file intact). Needs the bridge running. */
  EDITOR_SEED_WORKBENCH: 'spaceux:editor:workbench-menus:seed',
  /** Editor deletes a curated workbench pie (#207): invoke({ pluginId,
   *  workbenchKey }) → {@link ProfileActionResult}. Removes the file; if it was
   *  the active source, main clears the override and re-resolves. */
  EDITOR_DELETE_WORKBENCH: 'spaceux:editor:workbench-menus:delete',
  /** Editor pulls the FreeCAD bridge-addon install status (#189): invoke →
   *  {@link FreecadBridgeStatus} (resolved Mod dir + whether the addon is
   *  installed, or why it can't be resolved). */
  EDITOR_GET_FREECAD_BRIDGE: 'spaceux:editor:freecad-bridge:get',
  /** Editor installs the bundled FreeCAD bridge addon into the resolved Mod
   *  dir (#189): invoke({ pluginId }) → {@link FreecadBridgeInstallResult}. */
  EDITOR_INSTALL_FREECAD_BRIDGE: 'spaceux:editor:freecad-bridge:install',
  /** Editor removes the installed FreeCAD bridge addon (#189): invoke →
   *  {@link ProfileActionResult}. */
  EDITOR_UNINSTALL_FREECAD_BRIDGE: 'spaceux:editor:freecad-bridge:uninstall',

  // ── Pie appearance (own app setting, separate from menu.json and the
  //    editor UI theme; consumed by both the live pie and the editor
  //    preview) ─────────────────────────────────────────────────────────
  /** Either renderer pulls the current pie appearance on mount (pull-not-
   *  push, same startup-race rationale as GET_MENU_CONFIG). */
  GET_PIE_APPEARANCE: 'spaceux:pie:appearance:get',
  /** Editor pushes a partial appearance change (theme and/or opacity).
   *  Main validates, persists, and re-broadcasts the full value.
   *  Fire-and-forget. */
  SET_PIE_APPEARANCE: 'spaceux:pie:appearance:set',
  /** Main pushes the full appearance to both renderers after a change so
   *  the live pie hot-reloads and the editor preview tracks it. */
  PIE_APPEARANCE_CHANGED: 'spaceux:pie:appearance:changed',
} as const;

/** The connected device as the editor sees it (#66, #113): the daemon's
 *  button count + USB identity, plus the id of the per-device profile
 *  currently driving the config. All-zero / empty `name` when no device
 *  is attached; `profileId` is null when the global menu.json fallback is
 *  active (no device, no matching profile, or a broken profile). */
export type EditorDeviceInfo = {
  buttons: number;
  vendor: number;
  product: number;
  name: string;
  profileId: string | null;
};

/** One selectable action for the editor's Action dropdown: the composite
 *  `pluginId/actionName` key (the value persisted in a binding) plus the
 *  human label/description from the action descriptor. Built from main's
 *  action index (builtins + loaded plugins). */
export type EditorAction = {
  id: string;
  label: string;
  description?: string;
};

/** A plugin category — the subdirectory of the managed `extensions/` tree a
 *  plugin lives in, and the value of its manifest `kind`. `function` plugins
 *  contribute actions/menus (e.g. FreeCAD); `theme` plugins style the pie
 *  (#47); `nav-style` plugins ship navigation-style presets the editor
 *  picker merges with the built-ins; `shape` plugins contribute a pie
 *  shape model (planets, polygon, ...; #107 as a plugin) whose runtime is
 *  loaded into the renderer alongside the unchanged wedge default. The
 *  folder name, the manifest `kind`, and this union are kept in lockstep
 *  so a plugin is self-describing and the importer can route it. */
export type PluginCategory = 'function' | 'theme' | 'nav-style' | 'shape';

/** One installed third-party plugin, as the editor's plugin manager lists it.
 *  Built-ins are excluded — they aren't user-managed. */
export type PluginInfo = {
  /** Reverse-DNS manifest id (the prefix of every action key it owns). */
  id: string;
  name: string;
  version: string;
  kind: PluginCategory;
  /** Absolute directory the plugin was loaded from. */
  dir: string;
  /** Whether the editor can uninstall it: true only when it lives in the
   *  user-writable managed extensions dir (an imported plugin). A plugin loaded
   *  from the repo dev-fallback or a system dir is bundled and not removable
   *  here, so the UI disables Remove instead of silently no-op'ing (#221). */
  removable: boolean;
  /** How many actions the manifest declares. */
  actionCount: number;
  /** Whether the plugin exports a command catalog (#76 D2) — drives whether
   *  the editor offers its command palette. Only `function` plugins that are
   *  loaded can have one. */
  hasCatalog: boolean;
  /** The plugin's badge icon as a baked data URI (#186), or undefined if it
   *  ships none — shown in the pie corner while this plugin's pie is active. */
  badge?: string;
  /** Navigation-style presets the plugin contributes. Present only for
   *  `kind: 'nav-style'` plugins. The picker merges these with the built-in
   *  presets so installing a nav-style plugin extends the dropdown. Each
   *  entry's `navigation` block has been validated + normalised in main. */
  navStylePresets?: NavStylePresetDescriptor[];
  /** Pie shape model this plugin contributes (#107 as a plugin). Present
   *  only for `kind: 'shape'` plugins; the renderer pulls the entry source
   *  via a separate IPC channel when the shape gets selected (the picker
   *  needs only the descriptor metadata to render the dropdown). */
  shape?: ShapePluginDescriptor;
};

/** A plugin directory that failed to load, with the loader's reason. */
export type PluginLoadError = { dir: string; reason: string };

/** What the editor's plugin manager shows: the installed plugins and any
 *  load failures. Built-ins are omitted. */
export type PluginsState = {
  plugins: PluginInfo[];
  errors: PluginLoadError[];
};

/** Outcome of an import. `cancelled` (the picker was dismissed) is distinct
 *  from a real failure so the UI only shows an error when something actually
 *  went wrong. Success carries the refreshed state and which plugin landed. */
export type PluginImportResult =
  | { ok: true; installed: PluginInfo; state: PluginsState }
  | { ok: 'cancelled' }
  | { ok: false; reason: string };

/** Outcome of an uninstall. Always carries the refreshed state (so the list
 *  updates either way); `ok:false` surfaces a real delete error to the UI
 *  instead of swallowing it (#221). */
export type PluginUninstallResult =
  | { ok: true; state: PluginsState }
  | { ok: false; reason: string; state: PluginsState };

/** Result of an editor command-catalog pull (#76 D2). Failure (no such plugin,
 *  no `provideCatalog`, or an unreachable bridge) carries a reason the palette
 *  shows instead of commands. */
export type PluginCatalogResult =
  | { ok: true; catalog: PluginCatalog }
  | { ok: false; reason: string };

/** The per-device profiles the editor knows about (#113): the ids of the
 *  saved profile files, and the manual override (a profile id force-loaded
 *  by the user, or null = "Auto" device auto-detect). The *active* profile
 *  id is carried separately on {@link EditorDeviceInfo}. */
export type ProfilesState = {
  ids: string[];
  override: string | null;
  /** Plugin-provided menus selectable as the active pie (#76), listed
   *  separately so the dropdown shows plugin names and tells them apart from
   *  device profiles. Selecting one sets `override` to its `id`, which is
   *  `plugin:<pluginId>`. */
  pluginMenus: { id: string; name: string }[];
};

/** The curated per-workbench pies that exist on disk (#193, PR2c): their
 *  `wb:<pluginId>:<workbenchKey>` ids. Lets the FreeCAD workbench dropdown mark
 *  which workbenches already have a curated pie (vs. needing a seed). */
export type WorkbenchMenusState = { ids: string[] };

/** Outcome of seeding a curated workbench pie (#193). Success carries the new
 *  `wb:` id (the editor then sets it as the override); failure carries a reason
 *  (e.g. the bridge is unreachable, or the workbench isn't loaded). */
export type WorkbenchSeedResult = { ok: true; id: string } | { ok: false; reason: string };

/** FreeCAD bridge-addon install status (#189). `resolved` false when no usable
 *  FreeCAD Mod dir was found — `sandbox` distinguishes a Flatpak/Snap install
 *  (the socket can't cross it) from "FreeCAD not found". When resolved, carries
 *  the Mod dir, a human label (e.g. `v1-2`), and whether the addon is present. */
export type FreecadBridgeStatus =
  | { resolved: false; reason: string; sandbox: boolean }
  | { resolved: true; modDir: string; label: string; installed: boolean };

/** Outcome of installing the FreeCAD bridge addon (#189): the destination path
 *  on success, or a reason (no Mod dir resolved / copy failed). */
export type FreecadBridgeInstallResult = { ok: true; dest: string } | { ok: false; reason: string };

/** Result of a profile save/delete action. */
export type ProfileActionResult = { ok: true } | { ok: false; reason: string };

/** Outcome of the node-icon image picker. `cancelled` is distinct from a
 *  real failure (e.g. too large, unreadable) so the UI only shows an error
 *  when something went wrong. Success carries the inline image data URI to
 *  store on the node. */
export type PickIconResult =
  | { ok: true; dataUri: string }
  | { ok: false; reason: string }
  | { ok: 'cancelled' };

/** Editor colour theme. `system` follows the OS light/dark preference;
 *  `spaceux` is the branded palette. Persisted in editor-settings.json. */
export type ThemeChoice = 'system' | 'light' | 'dark' | 'spaceux';

/** Pie-menu colour theme. No `system` (the overlay's look is chosen
 *  explicitly); selected by the `data-pie-theme` attribute via the shared
 *  src/core/pie-theme.css. Persisted in app-settings.json. */
export type PieThemeChoice = 'dark' | 'light' | 'spaceux';

/** The pie's corner indicators (#186 / #229), pushed over PIE_BADGE: the active
 *  plugin's app icon (bottom-left) and the active workbench's icon (bottom-right),
 *  each a data URI or null when there's none. */
export type PieBadges = { plugin: string | null; workbench: string | null };

/** The pie's appearance — its own app setting, independent of the editor
 *  UI theme. `opacity` is an overall translucency multiplier (1 = the
 *  palette's baked-in look). Blur will join here later without new
 *  channels. */
export type PieAppearance = {
  theme: PieThemeChoice;
  opacity: number;
  /** Label size as a fraction of the per-segment fit (1 = 100% = fill the
   *  segment; less = smaller). Applied in both the live pie and the editor
   *  preview via `--pie-label-scale`. */
  labelScale: number;
  /** Icon size as a fraction of the per-segment fit (1 = 100% = the largest
   *  icon that fits a wedge without crossing its edges; less = smaller).
   *  Applied in both the live pie and the editor preview by multiplying the
   *  per-segment fit into the SVG `<image>` dimension. */
  iconScale: number;
  /** Overall pie size multiplier (1 = default size). A global style setting
   *  (was the per-menu `MenuConfig.scale`, #186 follow-up) so it's editable
   *  whatever the active source, and rides a device profile's appearance. */
  scale: number;
  /** Ring-balance slider (#182): 0..1, 0.5 = the historical proportions.
   *  Shifts the inner-pie / outer-ring boundary within the fixed footprint. */
  ringBalance: number;
  /** Centre-balance slider (#182): 0..1, 0.5 = the historical proportions.
   *  Shifts the centre-hole / inner-pie boundary. */
  centerBalance: number;
  /** Pie-scoped font override (#237 PR 2). A CSS `font-family` value applied
   *  to the pie labels only (live overlay + editor preview) via
   *  `--pie-font-ui`, never the editor UI. `''` = the bundled default
   *  (`var(--font-ui)`, Inter + system stack). */
  fontUi: string;
  /** Pie-scoped monospace override (#237 PR 2), applied via `--pie-font-mono`.
   *  `''` = the bundled default (`var(--font-mono)`, JetBrains Mono). Affects
   *  pie-context monospace text (the dev debug panel today). */
  fontMono: string;
  /** Pie shape model (#107). `null` = the built-in wedge (default,
   *  unchanged); a string is a plugin-contributed shape, namespaced as
   *  `<pluginId>/<shapeId>`. The renderer falls back to wedge when this
   *  references a plugin that isn't installed, so a saved appearance
   *  doesn't soft-lock the pie if the user removes the shape plugin
   *  later. App-level default; a per-menu `MenuConfig.shapeModel`
   *  override takes precedence when set (see `resolveShapeModel`). */
  shapeModel: string | null;
};

/** Config plus the on-disk mtime it was read at. The editor snapshots
 *  the mtime and echoes it back on a write so main can detect a
 *  file-changed-underneath conflict. mtime is null when no file backed
 *  the config (fresh install running on DEFAULT_MENU_CONFIG). */
export type MenuConfigSnapshot = { config: MenuConfig; mtime: number | null };

/** Why the editor's active config changed out-of-band (#113), driving the
 *  conflict banner's wording:
 *   - `external` — a file edit outside the editor (menu.json or the active
 *     profile file).
 *   - `device`   — the connected device changed (hotplug / (un)plug), so a
 *     different profile auto-resolved.
 *   - `profile`  — the active profile was switched without a device change
 *     (the editor's override dropdown, or a save/delete that re-resolved).
 *  Distinguishing `device` from `profile` keeps the banner from claiming
 *  "the connected device changed" when the user merely picked a profile. */
export type ConfigChangeCause = 'external' | 'device' | 'profile';

/** Payload of EDITOR_MENU_CONFIG_CHANGED: the new snapshot plus its cause. */
export type MenuConfigChange = MenuConfigSnapshot & { cause: ConfigChangeCause };

/** Outcome of an editor write-back. Mirrors menu-writer's result so the
 *  same shape crosses the IPC boundary. The success case carries the
 *  *normalized* config (as written to disk) so main can keep its
 *  in-memory copy identical to the file. */
export type MenuWriteResult =
  | { ok: true; mtime: number; config: MenuConfig }
  | { ok: false; reason: string }
  | { ok: 'conflict'; mtime: number | null };

export type DaemonStatusPayload =
  | {
      state: 'connected';
      axes: number;
      buttons: number;
      /** True if the daemon can inject keyboard chords (i.e. /dev/uinput
       *  was reachable at startup). Falsey means key-combo bindings
       *  will silently no-op — the UI should surface that. */
      inject: boolean;
      /** True if the daemon can drive the SpaceMouse status LED (i.e.
       *  it found and opened the matching hidraw node). Falsey means
       *  SET_LED commands silently no-op. */
      led: boolean;
    }
  | { state: 'disconnected'; reason: string };

/** Anchor point for the pie menu, in renderer-window pixel coords.
 *  The renderer centres the pie SVG on this point. */
export type MenuOpenPayload = {
  x: number;
  y: number;
};
