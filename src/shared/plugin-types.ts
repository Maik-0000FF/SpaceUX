// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Plugin contract — types describing what a plugin manifest looks like
 * and what an action implementation must export.
 *
 * A plugin is a directory under one of the well-known XDG locations
 * (see plugin-loader for the search path) containing at minimum:
 *
 *   manifest.json   — describes the plugin and its actions
 *   index.js        — exports the action handlers named in the manifest
 *
 * The plugin loader validates every manifest against PluginManifest
 * at load time so a malformed plugin fails fast rather than at first
 * trigger.
 */

import type { MenuNavigation, MenuNode } from './menu.js';

/**
 * Current plugin API version emitted by the host. A plugin's
 * `manifest.json` must declare an `apiVersion` field; the loader
 * compares it against the supported range below and refuses to load
 * anything outside it.
 *
 * Bumping this is a deliberate breaking change to the plugin
 * contract (e.g. a new required field on PluginModule, a renamed
 * type the loader needs, a security-relevant default change). When
 * we bump:
 *   - if the change is additive and old plugins continue to run,
 *     keep MIN_SUPPORTED_PLUGIN_API_VERSION at the previous value
 *     so existing plugins load unchanged.
 *   - if the change really breaks old plugins, raise both constants
 *     and document the break.
 */
export const PLUGIN_API_VERSION = 1;

/**
 * Lowest plugin apiVersion the host will still load. Equal to
 * PLUGIN_API_VERSION until we ship a backwards-compatible bump.
 */
export const MIN_SUPPORTED_PLUGIN_API_VERSION = 1;

/** Schema describing one user-configurable input on an action. */
export type ActionConfigField =
  | { kind: 'string'; label: string; placeholder?: string; default?: string }
  | { kind: 'integer'; label: string; min?: number; max?: number; default?: number }
  | { kind: 'boolean'; label: string; default?: boolean }
  | { kind: 'enum'; label: string; choices: string[]; default?: string };

export type ActionConfigSchema = Record<string, ActionConfigField>;

/** Single action exposed by a plugin. The manifest declares the
 *  metadata; the implementation lives in index.js under the same
 *  `name`. */
export type ActionDescriptor = {
  /** Stable identifier used in user config — never change once shipped. */
  name: string;
  /** Human-readable label for the menu editor. */
  label: string;
  /** Optional one-liner for tooltip / preview. */
  description?: string;
  /** Optional icon name (theme-defined; resolved by the renderer). */
  icon?: string;
  /** Per-instance configurable fields shown in the editor. */
  config?: ActionConfigSchema;
};

/** A plugin's category. Decides which subdirectory of the managed
 *  `extensions/` tree it installs into and how the host treats it:
 *    - `function`   — contributes actions / a pie menu (e.g. FreeCAD).
 *    - `theme`      — styles the pie (theme/design plugin, #47).
 *    - `nav-style`: declares one or more navigation-style presets
 *                   ({@link NavStylePresetDescriptor}). Pure data, no
 *                   `index.js` is loaded.
 *    - `shape`:     contributes a pie shape model ({@link ShapePluginDescriptor}):
 *                   layout + hit-test for non-wedge layouts (e.g. planets,
 *                   polygon). Carries an `index.js` whose source the
 *                   renderer executes via a Blob-URL dynamic import; the
 *                   wedge default code path (`describeWedgePath`,
 *                   `axesToSector`) stays untouched and is the active path
 *                   whenever no shape plugin is selected (#107).
 *  The folder name and this value are kept identical so a plugin is
 *  self-describing and the importer can route it without guessing. New
 *  categories are added here and to the loader's category list together. */
export type PluginKind = 'function' | 'theme' | 'nav-style' | 'shape';

/** Every recognised plugin kind, in one place so the loader, the importer,
 *  and the manifest validator agree on the set. */
export const PLUGIN_KINDS: readonly PluginKind[] = ['function', 'theme', 'nav-style', 'shape'];

/** One navigation-style preset shipped by a nav-style plugin. Mirrors the
 *  built-in `NavigationPreset` in `shared/navigation-presets.ts`: a stable
 *  `id`, a label/description for the dropdown, and the full
 *  {@link MenuNavigation} block the preset applies one-shot. The host
 *  validates `navigation` against the same contract as on-disk configs
 *  (see :func:`validateNavigation`).
 *
 *  Two plugins may ship the same `id` (e.g. both call a preset "twist"); the
 *  picker is expected to namespace plugin-provided ids as
 *  `<pluginId>/<id>` when merging them with the built-in list, so the
 *  merged map stays unique. That merge lands in a follow-up PR; nothing in
 *  this manifest contract requires the namespacing to be done at load. */
export type NavStylePresetDescriptor = {
  /** Stable id within the plugin. The picker will namespace it as
   *  `<pluginId>/<id>` when merging with the built-in preset list (see the
   *  type doc above). Never change once shipped. */
  id: string;
  /** Dropdown label shown in the picker. */
  label: string;
  /** One-line description of the gesture model, shown under the dropdown. */
  description: string;
  /** The full navigation block this preset applies. */
  navigation: MenuNavigation;
};

/** Declaration of a pie shape model contributed by a `kind: 'shape'` plugin
 *  (#107 as a plugin). The descriptor itself is pure data; the actual
 *  layout / hit-test functions live in the plugin's `index.js` and are
 *  loaded into the renderer process at runtime (Blob-URL dynamic import).
 *
 *  Wedge (the built-in default) is not a shape plugin: it stays as the
 *  unmodified core code path in `pie-geometry.ts` / `pie-path.ts`, and any
 *  installed shape plugin sits alongside it as an opt-in alternative.
 *
 *  Two plugins may ship the same `id` (e.g. both call a shape "orbit"); the
 *  picker is expected to surface the plugin id alongside the descriptor
 *  when disambiguation is needed — same pattern as nav-style presets. */
export type ShapePluginDescriptor = {
  /** Stable id within the plugin (e.g. `"planets"`). Combined with the
   *  plugin id to form the value the picker writes into
   *  `PieAppearance.shapeModel` (`<pluginId>/<id>`). Never change once
   *  shipped. */
  id: string;
  /** Dropdown label shown in the shape picker. */
  label: string;
  /** One-line description shown under the dropdown. */
  description: string;
  /** Plugin-dir-relative path to the JavaScript module that exports the
   *  shape's runtime functions (today only `index.js`, always at the root
   *  of the plugin folder). Path is sanitised by the importer so a
   *  manifest can't escape the plugin folder. */
  entry: string;
};

/** manifest.json shape. */
export type PluginManifest = {
  /** Plugin API contract version this plugin was written against.
   *  The loader compares against PLUGIN_API_VERSION /
   *  MIN_SUPPORTED_PLUGIN_API_VERSION and refuses to load plugins
   *  outside the supported range — that way a plugin written for a
   *  later host fails fast with an actionable message instead of
   *  crashing at first trigger when it touches a missing API. */
  apiVersion: number;
  /** Which category this plugin belongs to — picks the managed
   *  `extensions/<kind>/` folder it installs into and how the host loads it.
   *  Must equal the folder it's found under (the loader flags a mismatch). */
  kind: PluginKind;
  /** Reverse-DNS-style id, e.g. "org.spaceux.example-launch". */
  id: string;
  /** Human-readable plugin name. */
  name: string;
  /** Semver-style string. */
  version: string;
  /** Plugin author / vendor. */
  author?: string;
  /** SPDX licence identifier; the loader rejects plugins without one
   *  so unattributed code can't sneak into the host process. */
  license: string;
  /** Optional homepage URL surfaced in the editor. */
  homepage?: string;
  /** List of every action this plugin exposes. Required (non-empty) for
   *  `kind: 'function'`; rejected on every other kind (mirrors the `menu`
   *  and `presets` rules), so a manifest can't carry a stray field that
   *  the loader would silently ignore. */
  actions?: ActionDescriptor[];
  /** Navigation-style presets this plugin contributes. Required and
   *  non-empty for `kind: 'nav-style'`; rejected on every other kind
   *  (mirrors the `actions` and `menu` rules). Each preset's `navigation`
   *  block is validated against the same shape as an on-disk menu config,
   *  so a malformed style is rejected at load instead of slipping into the
   *  picker. */
  presets?: NavStylePresetDescriptor[];
  /** Shape model this plugin contributes (#107 as a plugin). Required for
   *  `kind: 'shape'`; rejected on every other kind (mirrors the `actions`
   *  / `presets` / `menu` rules). Only one shape per plugin: a plugin is a
   *  single layout, not a bundle, to keep the picker entry per-plugin
   *  unambiguous. The runtime code lives in the JS file named by
   *  `shape.entry` and is loaded into the renderer process at runtime;
   *  PR2 of the series wires that runtime. */
  shape?: ShapePluginDescriptor;
  /** Optional badge icon (a plugin-dir-relative SVG path, e.g. `badge.svg`) —
   *  the plugin's own app icon, shown in the pie's bottom-left corner while
   *  this plugin's pie is the active source (#186), so the user sees which
   *  plugin (FreeCAD / Blender / …) is active. The host bakes it to a data URI;
   *  generic, so a new plugin just ships its own. */
  badge?: string;
  /** Optional pie menu this plugin contributes (#76). When present, the menu
   *  is selectable as the active pie via the editor's profile dropdown
   *  (`plugin:<id>`). Selecting it is non-destructive: it overlays the
   *  plugin's *content* (`root`) onto the user's own trigger / navigation /
   *  appearance, and never writes the user's menu.json. */
  menu?: PluginMenu;
};

/** The id prefix marking a profile-dropdown entry as a plugin-provided menu
 *  (`plugin:<pluginId>`), distinguishing it from a device profile
 *  (`<vid>-<pid>`) in the same override slot. Shared so main and the editor
 *  renderer agree on the one literal across the process boundary. */
export const PLUGIN_MENU_ID_PREFIX = 'plugin:';

/** Whether an override id names a plugin-provided menu. Tolerates null/undefined
 *  so callers can pass an optional override directly. */
export function isPluginMenuId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(PLUGIN_MENU_ID_PREFIX);
}

/** The id prefix marking an active-source override as a *curated*, per-workbench
 *  FreeCAD pie (#193): `wb:<pluginId>:<workbench-key>`. Distinct from a dynamic
 *  plugin menu (`plugin:<id>`, read-only): a curated workbench pie is a normal
 *  *writable* config the user edits and that's stored on disk. The workbench
 *  part is the bridge's stable workbench key (e.g. `PartDesignWorkbench`), never
 *  its display name, so it matches the live active workbench at runtime (#193
 *  PR3). Shared so main and the renderer agree on the one literal. */
export const WB_MENU_ID_PREFIX = 'wb:';

/** Build the active-source id for the curated pie of `workbenchKey` under
 *  `pluginId`. The id's `:` separator is unambiguous: a reverse-DNS plugin id
 *  and a workbench class key both contain no `:`. */
export function makeWorkbenchMenuId(pluginId: string, workbenchKey: string): string {
  return `${WB_MENU_ID_PREFIX}${pluginId}:${workbenchKey}`;
}

/** Whether `id` names a curated workbench pie. Tolerates null/undefined so
 *  callers can pass an optional override directly (mirrors isPluginMenuId). */
export function isWorkbenchMenuId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(WB_MENU_ID_PREFIX);
}

/** Parse a curated-workbench id into its plugin id + workbench key, or null if
 *  it isn't one / is malformed. The first `:` after the prefix is the separator
 *  (neither part contains a colon). */
export function parseWorkbenchMenuId(
  id: string | null | undefined,
): { pluginId: string; workbenchKey: string } | null {
  if (!isWorkbenchMenuId(id)) return null;
  const rest = (id as string).slice(WB_MENU_ID_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep >= rest.length - 1) return null;
  return { pluginId: rest.slice(0, sep), workbenchKey: rest.slice(sep + 1) };
}

/** A readable display label for a workbench class key — the fallback the editor
 *  shows when the bridge is offline and the catalog's display name (the real
 *  source of truth) isn't available (#193). Drops a trailing `Workbench` and
 *  splits CamelCase / acronym boundaries: `PartDesignWorkbench` → "Part Design",
 *  `MeshWorkbench` → "Mesh", `OpenSCADWorkbench` → "Open SCAD". Falls back to
 *  the raw key if the result would be empty. */
export function workbenchKeyToLabel(key: string): string {
  const label = key
    .replace(/Workbench$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary: "PartDesign" → "Part Design"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym→word: "SCADModel" → "SCAD Model"
    .trim();
  return label || key;
}

/** A plugin-contributed menu. C1 carries only the content (`root`); a plugin
 *  may later also *suggest* its own trigger/navigation/appearance, applied
 *  opt-in (the user is asked) and never overwriting their config. */
export type PluginMenu = {
  /** The menu content: a root node whose `branches` are the pie's items.
   *  Validated as a config root (centre may be empty; non-empty branches). */
  root: MenuNode;
};

/** Runtime context passed to every action invocation. */
export type ActionContext = {
  /** Logger scoped to this plugin — output prefixed with the plugin id. */
  log: (message: string) => void;
  /** Plugin id, useful when an action shells out and wants to identify itself. */
  pluginId: string;
  /** Inject a modifier+key chord through the daemon's uinput device.
   *  `modifiers` and `key` are Linux keycodes from
   *  `<linux/input-event-codes.h>`; see `src/main/builtins/keycodes.ts`
   *  for the symbolic-name map. Fire-and-forget — the daemon silently
   *  no-ops if `/dev/uinput` was unavailable at startup. */
  injectChord: (modifiers: number[], key: number) => void;
  /** True when the connected daemon advertised key injection in its
   *  hello event (i.e. /dev/uinput was reachable at startup). Plugins
   *  that depend on `injectChord` should check this and log a
   *  user-actionable message when false — otherwise the chord is
   *  dropped silently. Falsey before the daemon hello arrives, so a
   *  plugin firing during the startup race is treated the same as a
   *  daemon without injection capability. */
  injectAvailable: () => boolean;
};

/** Signature every action implementation must match. Plugins
 *  export a default object keyed by action name. */
export type ActionHandler = (
  config: Record<string, unknown>,
  ctx: ActionContext,
) => Promise<void> | void;

/**
 * Dynamic menu provider (#76 C2). A function plugin's index.js may export this
 * alongside `actions`; the host calls it *at each pie open* (with a timeout)
 * and renders the returned root, so the menu can reflect live external context
 * — e.g. FreeCAD's active workbench and its commands. Returns the pie's root
 * MenuNode (its `branches` are the sectors); the host validates + normalises it
 * exactly like a static `manifest.menu.root`.
 *
 * The plugin must still declare a (placeholder) `manifest.menu` so it's
 * selectable in the profile dropdown — that static menu is also the graceful
 * fallback shown when the provider errors or times out.
 */
export type PluginMenuProvider = (ctx: ActionContext) => MenuNode | Promise<MenuNode>;

/** One command a plugin can offer in the editor's command palette (#76 D2):
 *  a label + optional baked icon (data-URI), and the `command` string that the
 *  plugin's run-action takes as config. The editor turns this into a normal
 *  menu item — `{ label, icon, action: { id: "<pluginId>/run", config: {
 *  command } } }` — so the curated pie renders without the bridge and only
 *  needs it to *execute*.
 *
 *  `members` (#208): a command *group* (a FreeCAD toolbar dropdown bundling
 *  sub-commands, e.g. Part primitives). When present and non-empty this entry is
 *  a group — it renders as a third pie level (submenu) over its members and is
 *  not itself run (`command` may be empty). Members are leaves. */
export type PluginCatalogCommand = {
  command: string;
  label: string;
  icon?: string;
  members?: PluginCatalogCommand[];
  /** Whether the command is currently usable in the live app (its QAction is
   *  enabled). Lets the editor offer a "currently usable" filter (#217); a
   *  snapshot from catalog-fetch time, meaningful for the active workbench.
   *  Undefined from an older bridge → treated as enabled. */
  enabled?: boolean;
};

/** A named sub-grouping of commands within a catalog group — a FreeCAD toolbar
 *  (#193). Curated pies seed one submenu per toolbar so the editing tree mirrors
 *  the dynamic pie's structure. */
export type PluginCatalogToolbar = { name: string; commands: PluginCatalogCommand[] };

/** A catalog group (e.g. a FreeCAD workbench), its commands sub-grouped by
 *  toolbar. `key` is the group's stable identifier (the workbench's class name,
 *  e.g. `PartDesignWorkbench`) — used to key curated per-workbench pies (#193)
 *  and to match the bridge's live active workbench; `name` is the display label
 *  only (two workbenches can share a display name). Consumers that want a flat
 *  command list (the palette) flatten `toolbars`. */
export type PluginCatalogGroup = {
  key: string;
  name: string;
  /** The group's own icon as a data URI (#229) — a FreeCAD workbench's icon —
   *  or undefined when it ships none. Shown next to the workbench in the editor
   *  (and as the active-workbench indicator). */
  icon?: string;
  toolbars: PluginCatalogToolbar[];
};

/** A plugin's full command catalog. `complete` is false when only a subset is
 *  loaded (e.g. FreeCAD lists only visited workbenches until `loadAll`).
 *  `appBadge` is the app's own icon (a data URI), read live so the active-plugin
 *  badge (#186) needn't be bundled. */
export type PluginCatalog = {
  groups: PluginCatalogGroup[];
  complete: boolean;
  appBadge?: string;
};

/** Optional catalog provider (#76 D2). Returns the commands a plugin exposes
 *  for the editor palette; `opts.loadAll` asks for the complete set even if
 *  that's expensive (FreeCAD cycles every workbench). Like provideMenu, the
 *  host invokes it with a timeout and surfaces errors to the editor. */
export type PluginCatalogProvider = (
  ctx: ActionContext,
  opts: { loadAll: boolean },
) => PluginCatalog | Promise<PluginCatalog>;

/** What a plugin reports about its live context (#193 PR3 / #186 / #229): a
 *  stable `key` (for FreeCAD, the active workbench's class name — the same key
 *  the catalog groups and curated `wb:` pies use), an optional `badge` (the
 *  app's own icon as a data URI, for the active-plugin indicator), and an
 *  optional `icon` (the active *context's* own icon — FreeCAD's active workbench
 *  icon — for the active-workbench indicator). */
export type PluginContext = { key: string; badge?: string; icon?: string };

/** Optional context provider (#193 PR3 / #186). Returns the plugin's current
 *  {@link PluginContext}, or null when there's none. The host calls it at
 *  pie-open time to prefer a curated per-context pie over the dynamic menu and
 *  to show the active-plugin badge. Best-effort, invoked with a timeout. */
export type PluginContextProvider = (
  ctx: ActionContext,
) => PluginContext | null | Promise<PluginContext | null>;

/** Optional trigger-button reservation (#191). The pie-trigger button is global
 *  (it opens the SpaceUX pie regardless of focused app or active pie), so when a
 *  plugin's app shares the SpaceMouse (FreeCAD reads the same puck via spacenavd)
 *  that button double-fires: it opens the pie *and* whatever the app bound to it.
 *  A plugin that can suppress its app's binding implements this: the host calls
 *  `reserve: true` to clear the binding and `reserve: false` to restore it.
 *  `button` is the zero-based trigger button (the active config's `triggerButton`).
 *  The host calls it on a heartbeat whenever such a plugin is loaded — not tied
 *  to the active source — so it must be idempotent and persist the original
 *  binding (the app may not be running at any given call; reject in that case so
 *  the host retries, and survive an app restart). */
export type PluginTriggerReserver = (
  ctx: ActionContext,
  req: { button: number; reserve: boolean },
) => void | Promise<void>;

/** Shape of `module.exports` (or `export default`) from a plugin's index.js. */
export type PluginModule = {
  actions: Record<string, ActionHandler>;
  /** Optional dynamic menu provider — see {@link PluginMenuProvider}. */
  provideMenu?: PluginMenuProvider;
  /** Optional command-catalog provider — see {@link PluginCatalogProvider}. */
  provideCatalog?: PluginCatalogProvider;
  /** Optional context provider — see {@link PluginContextProvider}. */
  provideContext?: PluginContextProvider;
  /** Optional trigger-button reserver — see {@link PluginTriggerReserver}. */
  reserveTrigger?: PluginTriggerReserver;
};
