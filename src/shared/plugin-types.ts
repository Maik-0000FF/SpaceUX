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

/** Shape of `module.exports` (or `export default`) from a plugin's index.js. */
export type PluginModule = {
  actions: Record<string, ActionHandler>;
};
