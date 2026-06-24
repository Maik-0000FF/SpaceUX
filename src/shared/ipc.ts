// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types shared between the core and the editor: the payload/result
 * shapes the org.spaceux.Core1 contract (core-contract.ts) re-exports.
 * Centralising them here keeps both sides on one definition.
 */

import type { ActionRef, MenuAxisName, MenuConfig } from './menu';
import type {
  ActionConfigSchema,
  NavStylePresetDescriptor,
  PluginPermission,
  PluginCatalog,
  PluginKind,
  ShapePluginDescriptor,
} from './plugin-types';

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
  /** The daemon socket is up. Optional: consumers treat undefined as
   *  unknown. */
  daemonConnected?: boolean;
};

/** One selectable action for the editor's Action dropdown: the composite
 *  `pluginId/actionName` key (the value persisted in a binding) plus the
 *  human label/description from the action descriptor. Built from main's
 *  action index (builtins + loaded plugins). */
export type EditorAction = {
  id: string;
  label: string;
  /** Display name of the plugin that contributes this action (the
   *  `name` from its manifest; "Built-in Actions" for the builtins). The
   *  dropdown appends it so two actions that share a label (e.g. the
   *  built-in "Launch program" and an example plugin's) stay
   *  distinguishable, since the option text otherwise shows only `label`. */
  source: string;
  description?: string;
  /** Per-instance config schema from the action's manifest (the same
   *  `config[key].{label,placeholder}` the host already declares). Threaded
   *  to the editor so the Config field's tooltip can show the action's
   *  shape + a concrete JSON example instead of inventing copy (#279). */
  config?: ActionConfigSchema;
};

/** A plugin category — the subdirectory of the managed `extensions/` tree a
 *  plugin lives in, and the value of its manifest `kind`. `function` plugins
 *  contribute actions/menus (e.g. FreeCAD); `theme` plugins style the pie
 *  (#47); `nav-style` plugins ship navigation-style presets the editor
 *  picker merges with the built-ins; `shape` plugins contribute a pie
 *  shape model (planets, polygon, ...; #107 as a plugin) whose runtime is
 *  loaded into the renderer alongside the unchanged wedge default. The
 *  folder name, the manifest `kind`, and this union are kept in lockstep
 *  so a plugin is self-describing and the importer can route it.
 *  The union itself (PluginKind, derived from PLUGIN_KINDS) lives in
 *  plugin-types.ts; re-exported here for the IPC types that reference it. */
export type { PluginKind } from './plugin-types';

/** A plugin's content-verified trust state (see PluginInfo.trust). */
export type PluginTrust = 'verified' | 'mismatch' | 'community' | 'unknown';

/** One installed third-party plugin, as the editor's plugin manager lists it.
 *  Built-ins are excluded — they aren't user-managed. */
export type PluginInfo = {
  /** Reverse-DNS manifest id (the prefix of every action key it owns). */
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  /** Absolute directory the plugin was loaded from. */
  dir: string;
  /** Whether the editor can uninstall it: true only when it lives in the
   *  user-writable managed extensions dir (an imported plugin). A plugin loaded
   *  from the repo dev-fallback or a system dir is bundled and not removable
   *  here, so the UI disables Remove instead of silently no-op'ing (#221). */
  removable: boolean;
  /** Trust state, content-based so it can't be forged by reusing an id:
   *  - `verified`: id is on the curated official list and the content matches
   *    the hash shipped in the app (green "Verified" badge);
   *  - `mismatch`: id claims to be official but the content provably does NOT
   *    match, i.e. an impersonator or a tampered copy (red "Unverified" badge);
   *  - `community`: not an official id at all, an ordinary third-party plugin
   *    (amber "Community" badge);
   *  - `unknown`: an official id whose content could not be read to verify
   *    (a transient I/O error), so no trust badge is shown rather than a false
   *    tamper alarm.
   *  See main/plugin-hash. */
  trust: PluginTrust;
  /** Sensitive permissions the manifest declares it needs, any of
   *  PluginPermission. Empty when it declares none. Shown so the user sees a
   *  plugin's requested permissions before enabling it. */
  permissions: PluginPermission[];
  /** How many actions the manifest declares. */
  actionCount: number;
  /** Whether the plugin exports a command catalog (#76 D2) — drives whether
   *  the editor offers its command palette. Only `function` plugins that are
   *  loaded can have one. */
  hasCatalog: boolean;
  /** Whether the plugin exports a `provideBridge` hook (#288) — drives whether
   *  the editor shows the generic bridge installer for it. Only loaded
   *  `function` plugins can have one. */
  hasBridge: boolean;
  /** Whether the manifest ships a static pie menu (`manifest.menu`, #220 badges).
   *  Surfaced so the plugin manager can show a "Menu" capability chip. */
  hasMenu: boolean;
  /** The singular noun this plugin uses for its live "context" (#288): the word
   *  the editor's curated-pie controls show (FreeCAD = "Workbench"). Resolved in
   *  main from the manifest's `context.label`, defaulting to "Workbench" when the
   *  manifest omits it, so the editor never has to apply the fallback itself. */
  contextLabel: string;
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
 *  went wrong. Success carries the refreshed state and which plugin landed.
 *  `bridge` is present only when the imported plugin ships one (`hasBridge`):
 *  the host auto-installs it on import so it's a one-step setup, and reports
 *  the outcome here (success with an optional note, or why it couldn't, e.g.
 *  FreeCAD not found / sandbox). The import itself succeeds regardless. */
export type PluginImportResult =
  | { ok: true; installed: PluginInfo; state: PluginsState; bridge?: PluginBridgeActionResult }
  | { ok: false; reason: string };

/** Outcome of the inspect step (#426): a folder was picked and its manifest
 *  read, but nothing installed yet. `permissions` is what the plugin declares it
 *  needs, so the renderer can show a themed consent dialog before calling
 *  importPlugin(srcDir). `cancelled` = picker dismissed; `false` = not a valid
 *  plugin folder. */
export type PluginPickResult =
  | {
      ok: true;
      srcDir: string;
      name: string;
      permissions: PluginPermission[];
      /** Content-verified provenance of the picked folder (same check as the
       *  manager badge), so the consent dialog can warn about an impersonator
       *  before install. */
      trust: PluginTrust;
    }
  | { ok: 'cancelled' }
  | { ok: false; reason: string };

/** Outcome of an uninstall. Always carries the refreshed state (so the list
 *  updates either way); `ok:false` surfaces a real delete error to the UI
 *  instead of swallowing it (#221). */
export type PluginUninstallResult =
  | { ok: true; state: PluginsState }
  | { ok: false; reason: string; state: PluginsState };

/** Payload of the PluginInvalidated push signal. The editor's per-plugin
 *  caches (shape-modules today, #269) use `kind` to filter (they only care
 *  about their own kind) and `pluginId` to drop the matching entry. */
export type PluginInvalidatedPayload = {
  pluginId: string;
  kind: PluginKind;
};

/** Renderer-visible half of a plugin's teardown hook (#267). The perform
 *  step lives in main as a cached closure; the editor only sees the message
 *  to display in the second Remove confirm. `null` when the plugin has no
 *  teardown hook or the host couldn't run it. */
export type PluginUninstallDescriptorRequest =
  | { available: true; message: string }
  | { available: false };

/** Where a plugin is referenced in saved state (#265): the named menus that
 *  point at it (in their `shapeModel` for shape plugins, or their action
 *  tree for function plugins) plus a flag for the global appearance.
 *  Consumed by the Plugin Manager's Remove confirm so the user sees the
 *  consequences before clicking through. nav-style and theme always
 *  resolve to empty today (see plugin-usage-scan.ts for why). */
export type PluginUsageReport = {
  menus: string[];
  globalAppearance: boolean;
};

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

/** The curated per-context pies that exist on disk (#193, PR2c): their
 *  `ctx:<pluginId>:<contextKey>` ids. Lets the catalog plugin's context dropdown
 *  mark which contexts already have a curated pie (vs. needing a seed). */
export type ContextMenusState = { ids: string[] };

/** Outcome of seeding a curated context pie (#193). Success carries the new
 *  `ctx:` id (the editor then sets it as the override); failure carries a reason
 *  (e.g. the bridge is unreachable, or the context isn't loaded). */
export type ContextSeedResult = { ok: true; id: string } | { ok: false; reason: string };

/** FreeCAD bridge-addon install status (#189). `resolved` false when no usable
 *  FreeCAD Mod dir was found — `sandbox` distinguishes a Flatpak/Snap install
 *  installed outside SpaceUX's tree (#288). The plugin owns all the specifics
 *  (target resolution, unsupported-setup detection); the host only renders this.
 *  `unresolved` carries a user-facing reason (e.g. FreeCAD not found, or a
 *  Flatpak/Snap sandbox the socket can't cross). `resolved` carries a short,
 *  plugin-authored `label` for the target (e.g. FreeCAD's `v1-2`) and whether
 *  the bridge is already installed. */
export type PluginBridgeStatus =
  | { resolved: false; reason: string }
  | { resolved: true; label: string; installed: boolean };

/** Outcome of a plugin bridge install/uninstall (#288). On success an optional
 *  plugin-authored `note` (e.g. "restart FreeCAD to load the bridge"); on
 *  failure a reason. */
export type PluginBridgeActionResult = { ok: true; note?: string } | { ok: false; reason: string };

/** Result of a profile save/delete action. */
export type ProfileActionResult = { ok: true } | { ok: false; reason: string };

/** What a Launch program / Open file target resolved to on disk, the facts the
 *  editor turns into a warning. `resolved` is the path actually inspected (the
 *  exec program after PATH lookup, or the open-file path), null when an exec
 *  command has no parseable program token. `fromPath` marks an exec bare name
 *  looked up on PATH (vs a literal path). `executable` is the exec X-bit check;
 *  `program` is the open-file "this is a binary" check (by MIME, so a +x flag
 *  on a FAT/NTFS mount doesn't misfire). */
export type ActionPathCheck = {
  resolved: string | null;
  fromPath: boolean;
  exists: boolean;
  directory: boolean;
  executable: boolean;
  program: boolean;
};

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

/** The editor window's persisted size (the `window` field of
 *  editor-settings.json). Size only: a Wayland client cannot position its own
 *  window, so the legacy x/y fields are not carried over the contract. The
 *  initial and minimum sizes are shell concerns (the Qt window derives its
 *  minimum from the content), so only the remembered size crosses the wire. */
export type EditorWindowSize = { width: number; height: number };

/** Pie-menu colour theme. No `system` (the overlay's look is chosen
 *  explicitly); selected by the `data-pie-theme` attribute via the shared
 *  src/core/pie-theme.css. Persisted in app-settings.json. */
export type PieThemeChoice = 'dark' | 'light' | 'spaceux';

/** How the built-in wedge ring is rendered (#47 modern-wedge). `classic` is the
 *  historical look (annular sectors with a 1px rim, touching edge to edge);
 *  `modern` draws each wedge with a constant-width parallel gap to its
 *  neighbours and no rim, the base for the frosted per-wedge look. Only affects
 *  the built-in wedge: when a shape plugin is active (`shapeModel` set) it draws
 *  its own nodes and this is moot. */
export type PieWedgeStyle = 'classic' | 'modern';

/** Shape of the gap between modern wedges (#47). `parallel` keeps a
 *  constant-width channel (straight side edges); `wedge` is a radial gap that
 *  widens toward the rim (the side edges stay on the sector radials). Only
 *  applies to the `modern` wedge style. */
export type PieWedgeGapStyle = 'parallel' | 'wedge';

/** The pie's appearance — its own app setting, independent of the editor
 *  UI theme. `opacity` is an overall translucency multiplier (1 = the
 *  palette's baked-in look). */
export type PieAppearance = {
  theme: PieThemeChoice;
  opacity: number;
  /** Frosted background: request a compositor backdrop blur behind the pie
   *  (#296 / supersedes the abandoned #126 docs workaround). Only the native
   *  overlay can do this — it asks KWin for a blur region via
   *  `org_kde_kwin_blur`. A boolean, not a strength: the protocol sets the
   *  region only, KWin owns the blur strength globally. Default false (no
   *  regression; the blur stays off until the user opts in). */
  blur: boolean;
  /** Label size as a fraction of the per-segment fit (1 = 100% = fill the
   *  segment; less = smaller). Applied in both the live pie and the editor
   *  preview via `--pie-label-scale`. */
  labelScale: number;
  /** Icon size as a fraction of the per-segment fit (1 = 100% = the largest
   *  icon that fits a wedge without crossing its edges; less = smaller).
   *  Applied in both the live pie and the editor preview by multiplying the
   *  per-segment fit into the SVG `<image>` dimension. */
  iconScale: number;
  /** Hide every label / icon in the pie (#518): the menu-wide counterpart of
   *  the per-item `labelHidden` / `iconHidden` (#515). A part shows only when it
   *  is neither globally nor per-item hidden. Optional and additive (absent =
   *  shown), and orthogonal to the size scales, so toggling visibility keeps the
   *  configured size. */
  hideLabels?: boolean;
  hideIcons?: boolean;
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
  /** Pie-scoped font override (#237 PR 2). A font-family value applied to
   *  the pie labels only (live overlay + editor preview), never the editor
   *  UI. `''` = the bundled default, resolved to the shipped "Inter SemiBold"
   *  face by `buildOverlayTheme` (overlay-theme.ts). */
  fontUi: string;
  /** Monospace override (#237 PR 2) for the editor's monospace surfaces,
   *  first of all the raw-JSON action-config fields. `''` = the system
   *  monospace family (resolved editor-side, Theme.fontMonoDefault). */
  fontMono: string;
  /** Pie shape model (#107). `null` = the built-in wedge (default,
   *  unchanged); a string is a plugin-contributed shape, namespaced as
   *  `<pluginId>/<shapeId>`. The renderer falls back to wedge when this
   *  references a plugin that isn't installed, so a saved appearance
   *  doesn't soft-lock the pie if the user removes the shape plugin
   *  later. App-level default; a per-menu `MenuConfig.shapeModel`
   *  override takes precedence when set (see `resolveShapeModel`). */
  shapeModel: string | null;
  /** Built-in wedge render style (#47 modern-wedge). `classic` (default) keeps
   *  the historical edge-to-edge sectors; `modern` draws gapped, rim-less
   *  wedges. Ignored while a shape plugin is active. */
  wedgeStyle: PieWedgeStyle;
  /** Modern-wedge gap shape (#47): `parallel` (constant-width channel) or
   *  `wedge` (radial gap that widens toward the rim). Only used when
   *  `wedgeStyle` is `modern`. */
  wedgeGapStyle: PieWedgeGapStyle;
  /** Modern-wedge gap width, as a fraction of the footprint so it scales with
   *  the pie (#47). Only used when `wedgeStyle` is `modern`. */
  wedgeGap: number;
  /** Modern-wedge hover pop (#47): the hovered wedge grows by this constant
   *  outset on every side (inner radius in, outer radius out, sides out), as a
   *  fraction of the footprint so it scales with the pie. 0 = no pop. Only used
   *  when `wedgeStyle` is `modern`. */
  wedgeHoverOffset: number;
  /** Show the submenu depth markers (#216): the per-branch arcs of dots
   *  marking how deep each submenu nests. Default true; the editor's toggle
   *  (#290) lets the user hide them for a cleaner pie. */
  showSubmenuMarkers: boolean;
  /** Show the depth-dots indicator: the row of dots marking the current
   *  navigation depth. Default true; toggled off via the editor (#290). */
  showDepthDots: boolean;
};

/** Global SpaceMouse input behaviour (#327), distinct from per-menu config
 *  and per-device profiles: it's one app-wide preference, persisted in
 *  app-settings.json and consumed only by main. */
export type InputSettings = {
  /** Grab the SpaceMouse exclusively (EVIOCGRAB) while the pie is open, so
   *  its movement drives only the pie and not the app underneath (FreeCAD,
   *  Blender, …). Off → the device keeps reaching other apps while the pie
   *  is up. Only matters when a 3D app is consuming the puck, so it's a
   *  toggle. Default true. */
  grabWhilePieOpen: boolean;
};

/** How desktop mode turns on (#199). `always`: active whenever `enabled` and
 *  not suspended. `toggle`: a dedicated button flips it on/off. */
export type DesktopActivationMode = 'always' | 'toggle';

/** Which way a `scroll` axis scrolls the focused window. */
export type DesktopScrollOrientation = 'vertical' | 'horizontal';

/**
 * The function bound to one SpaceMouse axis in desktop mode (#199), modelled as
 * a discriminated union so each function carries only the parameters it needs
 * and the editor surfaces only those. Axis-centric: every axis maps to at most
 * one function (`none` = unbound). The continuous functions (scroll/zoom/volume)
 * integrate deflection into an output rate; the discrete ones (workspace/
 * overview/show-desktop) fire once per threshold crossing and re-arm after a
 * cooldown. Parameters are per-axis, so two axes bound to the same function tune
 * independently.
 */
export type DesktopAxisFunction =
  | { kind: 'none' }
  | {
      kind: 'scroll';
      orientation: DesktopScrollOrientation;
      /** Raw axis magnitude below which the axis stays idle. */
      deadzone: number;
      /** Output rate gain (scroll units per axis unit). */
      speed: number;
      /** Response-curve exponent: 1 = linear, >1 accelerates large deflections. */
      curve: number;
      /** Flip the scroll direction. */
      invert: boolean;
    }
  | { kind: 'zoom'; deadzone: number; speed: number; invert: boolean }
  | { kind: 'volume'; deadzone: number; speed: number; invert: boolean }
  | { kind: 'brightness'; deadzone: number; speed: number; invert: boolean }
  | {
      kind: 'workspace';
      /** Axis magnitude that switches one workspace. */
      threshold: number;
      /** Re-arm time (ms) after a switch, so a held deflection steps once. */
      cooldownMs: number;
      /** Swap which deflection direction goes next vs previous. */
      invert: boolean;
    }
  | { kind: 'overview'; threshold: number; cooldownMs: number }
  | { kind: 'showDesktop'; threshold: number; cooldownMs: number };

/** The discriminator of a {@link DesktopAxisFunction}. */
export type DesktopAxisFunctionKind = DesktopAxisFunction['kind'];

/** The function bound to a device button in desktop mode (#199): a discrete
 *  one-shot. `none` = unbound. `overview` / `showDesktop` are first-class KDE
 *  actions; the `action` variant fires any built-in or plugin action (key combo,
 *  exec, open file, ...) through the same {@link ActionRef} the pie leaves use. */
export type DesktopButtonFunction =
  | 'none'
  | 'overview'
  | 'showDesktop'
  | { kind: 'action'; ref: ActionRef };

/** Function bound to each of the six axes (tx/ty/tz/rx/ry/rz). */
export type DesktopAxisMap = Record<MenuAxisName, DesktopAxisFunction>;

/** Global SpaceMouse desktop-control config (#199), distinct from per-menu
 *  config and per-device profiles: one app-wide setting, persisted as a nested
 *  `desktop` object in app-settings.json and consumed only by main (the desktop
 *  interpreter). Axis-centric: each axis is assigned a function that carries its
 *  own parameters; buttons map to discrete one-shots. Drives the desktop with
 *  the puck while the pie isn't in control. KDE-only. */
export type DesktopSettings = {
  /** Master switch. Default false: desktop mode stays off until the user opts
   *  in, so the existing pie-only behaviour is unchanged out of the box. */
  enabled: boolean;
  activationMode: DesktopActivationMode;
  /** Device button index that toggles desktop mode when
   *  `activationMode === 'toggle'`; `null` when unset. */
  toggleButton: number | null;
  /** Stop emitting while the pie is open (the pie owns the puck then). The grab
   *  is kept, only emission pauses. Default true. */
  suspendWhilePieOpen: boolean;
  /** Function bound to each axis. Every axis is present; `none` = unbound. */
  axes: DesktopAxisMap;
  /** Function bound to each device button, keyed by button index. A missing
   *  index is unbound. */
  buttons: Record<number, DesktopButtonFunction>;
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
