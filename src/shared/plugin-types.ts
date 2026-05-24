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

import type { MenuNode } from './menu.js';

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
 *    - `function` — contributes actions / a pie menu (e.g. FreeCAD).
 *    - `theme`    — styles the pie (theme/design plugin, #47).
 *  The folder name and this value are kept identical so a plugin is
 *  self-describing and the importer can route it without guessing. New
 *  categories are added here and to the loader's category list together. */
export type PluginKind = 'function' | 'theme';

/** Every recognised plugin kind, in one place so the loader, the importer,
 *  and the manifest validator agree on the set. */
export const PLUGIN_KINDS: readonly PluginKind[] = ['function', 'theme'];

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
  /** List of every action this plugin exposes. */
  actions: ActionDescriptor[];
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
 *  needs it to *execute*. */
export type PluginCatalogCommand = { command: string; label: string; icon?: string };

/** A named group of catalog commands (e.g. a FreeCAD workbench). `key` is the
 *  group's stable identifier (the workbench's class name, e.g.
 *  `PartDesignWorkbench`) — used to key curated per-workbench pies (#193) and
 *  to match the bridge's live active workbench; `name` is the display label
 *  only (two workbenches can share a display name). */
export type PluginCatalogGroup = { key: string; name: string; commands: PluginCatalogCommand[] };

/** A plugin's full command catalog. `complete` is false when only a subset is
 *  loaded (e.g. FreeCAD lists only visited workbenches until `loadAll`). */
export type PluginCatalog = { groups: PluginCatalogGroup[]; complete: boolean };

/** Optional catalog provider (#76 D2). Returns the commands a plugin exposes
 *  for the editor palette; `opts.loadAll` asks for the complete set even if
 *  that's expensive (FreeCAD cycles every workbench). Like provideMenu, the
 *  host invokes it with a timeout and surfaces errors to the editor. */
export type PluginCatalogProvider = (
  ctx: ActionContext,
  opts: { loadAll: boolean },
) => PluginCatalog | Promise<PluginCatalog>;

/** Shape of `module.exports` (or `export default`) from a plugin's index.js. */
export type PluginModule = {
  actions: Record<string, ActionHandler>;
  /** Optional dynamic menu provider — see {@link PluginMenuProvider}. */
  provideMenu?: PluginMenuProvider;
  /** Optional command-catalog provider — see {@link PluginCatalogProvider}. */
  provideCatalog?: PluginCatalogProvider;
};
