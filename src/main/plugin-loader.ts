// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { describeError } from '../shared/errors.js';
import { validateNavigation, validateNode } from '../shared/menu.js';
import {
  MIN_SUPPORTED_PLUGIN_API_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_KINDS,
  type ActionContext,
  type ActionDescriptor,
  type ActionHandler,
  type PluginKind,
  type PluginCatalogProvider,
  type PluginContextProvider,
  type PluginManifest,
  type PluginMenuProvider,
  type PluginModule,
  type PluginTriggerReserver,
} from '../shared/plugin-types.js';
import { dedupPreserveOrder } from '../shared/util.js';

import type { DaemonClient } from './daemon-client.js';

/**
 * Discover, validate, and import plugins from the managed `extensions/`
 * tree. Plugins live in a per-category subdirectory keyed by their
 * manifest `kind`, so the layout is self-describing and future-proof:
 *
 *   <root>/extensions/function/<id>/   — action / menu plugins (e.g. FreeCAD)
 *   <root>/extensions/theme/<id>/      — pie theme/design plugins (#47)
 *   <root>/extensions/nav-style/<id>/  — navigation-style preset bundles
 *
 * Search roots, highest precedence first (first hit wins per id, so a
 * user copy shadows a system one):
 *   1. $XDG_DATA_HOME/spaceux/extensions (else ~/.local/share/spaceux/
 *      extensions) — the user-writable root the importer copies into.
 *   2. /usr/local/share/spaceux/extensions
 *   3. /usr/share/spaceux/extensions
 *   4. <repo>/extensions  (development convenience)
 *
 * Users don't point the loader at arbitrary folders; they *import* a
 * downloaded plugin (see plugin-installer), which copies it into the
 * user-writable root under the right category.
 *
 * The loader never throws on a bad plugin — it logs and skips so one
 * misbehaving plugin can't take the whole UI down. Plugin authors get
 * structured error messages via the returned `errors` array.
 */

export type LoadedPlugin = {
  manifest: PluginManifest;
  dir: string;
  handlers: Record<string, ActionHandler>;
  /** Dynamic menu provider exported by index.js (#76 C2), if any — the host
   *  calls it at each pie open to build a live menu. Undefined for plugins
   *  that only ship a static `manifest.menu` (or no menu at all). */
  provideMenu?: PluginMenuProvider;
  /** Command-catalog provider exported by index.js (#76 D2), if any — the
   *  editor calls it to populate the command palette. Undefined for plugins
   *  without a catalog. */
  provideCatalog?: PluginCatalogProvider;
  /** Context provider exported by index.js (#193 PR3), if any — the host calls
   *  it at pie open to learn the live context key (FreeCAD's active workbench)
   *  and prefer a curated per-context pie. Undefined for plugins without one. */
  provideContext?: PluginContextProvider;
  /** Trigger-button reserver exported by index.js (#191), if any — the host
   *  calls it when the plugin becomes / stops being the active source so the
   *  plugin's app (FreeCAD) doesn't also act on the pie-trigger button.
   *  Undefined for plugins that don't share the puck. */
  reserveTrigger?: PluginTriggerReserver;
};

export type LoadResult = {
  plugins: LoadedPlugin[];
  errors: { dir: string; reason: string }[];
};

/** The user-writable extensions root — where the importer copies plugins and
 *  the first place the loader looks. $XDG_DATA_HOME/spaceux/extensions, else
 *  ~/.local/share/spaceux/extensions. */
export function userExtensionsRoot(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'spaceux', 'extensions');
}

/** Every extensions root to search, highest precedence first. */
export function extensionRoots(repoRoot?: string): string[] {
  return dedupPreserveOrder<string>([
    userExtensionsRoot(),
    '/usr/local/share/spaceux/extensions',
    '/usr/share/spaceux/extensions',
    repoRoot ? path.join(repoRoot, 'extensions') : null,
  ]);
}

/** The per-category scan dirs (`<root>/<category>`) across every root. */
export function pluginCategoryPaths(category: PluginKind, repoRoot?: string): string[] {
  return extensionRoots(repoRoot).map((root) => path.join(root, category));
}

/** Absolute install directory for a plugin of the given kind + id in the
 *  user-writable root — the importer's copy target and an uninstall's delete
 *  target. */
export function pluginInstallDir(kind: PluginKind, id: string): string {
  return path.join(userExtensionsRoot(), kind, id);
}

/**
 * Load every plugin of one category. `category` is both the subdirectory
 * scanned under each root and the `kind` each manifest must declare — a
 * mismatch (a plugin dropped in the wrong folder) is reported as an error
 * rather than loaded, so the on-disk layout stays trustworthy.
 */
export async function loadPlugins(category: PluginKind, repoRoot?: string): Promise<LoadResult> {
  const out: LoadResult = { plugins: [], errors: [] };
  const seenIds = new Set<string>();

  for (const root of pluginCategoryPaths(category, repoRoot)) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = path.join(root, entry);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const result = await loadOne(dir);
      if ('reason' in result) {
        out.errors.push({ dir, reason: result.reason });
        continue;
      }
      if (result.manifest.kind !== category) {
        // A plugin physically placed in the wrong category folder. The
        // importer never does this, but a hand-edited tree could — flag it
        // instead of silently treating it as the folder's category.
        out.errors.push({
          dir,
          reason: `manifest kind "${result.manifest.kind}" does not match the "${category}" folder it is installed in`,
        });
        continue;
      }
      if (seenIds.has(result.manifest.id)) {
        // Earlier root won — that's the override semantics users
        // expect ("my local copy shadows the system one").
        continue;
      }
      seenIds.add(result.manifest.id);
      out.plugins.push(result);
    }
  }
  return out;
}

async function loadOne(dir: string): Promise<LoadedPlugin | { reason: string }> {
  const manifestPath = path.join(dir, 'manifest.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    return { reason: `cannot read manifest.json: ${describeError(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { reason: `manifest.json is not valid JSON: ${describeError(err)}` };
  }

  const manifestErr = validateManifest(parsed);
  if (manifestErr) return { reason: manifestErr };
  const manifest = parsed as PluginManifest;

  // Deep-validate + normalize a plugin-provided menu (#76). validateManifest
  // only checked menu.root is an object; here we run the full node-tree
  // validator (as a config root) and store the *normalized* tree, so the
  // resolver downstream gets a clean MenuNode.
  if (manifest.menu !== undefined) {
    const v = validateNode(manifest.menu.root, 'plugin menu root', 0, true);
    if (v.ok) {
      manifest.menu = { ...manifest.menu, root: v.value };
    } else {
      // The menu is an optional add-on — a bad one must not take down the
      // plugin's valid actions. Drop just the menu and warn (surfacing this in
      // the Plugins manager UI is a follow-up).
      // eslint-disable-next-line no-console
      console.warn(`[plugin ${manifest.id}] menu disabled: ${v.reason}`);
      manifest.menu = undefined;
    }
  }

  // Module resolution: relative file:// URL so ESM and CJS both work.
  const indexPath = path.join(dir, 'index.js');
  let mod: PluginModule;
  try {
    const imported = (await import(pathToFileURL(indexPath).href)) as
      | PluginModule
      | { default: PluginModule };
    mod = 'actions' in imported ? imported : (imported as { default: PluginModule }).default;
  } catch (err) {
    return { reason: `cannot import index.js: ${describeError(err)}` };
  }
  if (!mod || typeof mod.actions !== 'object' || mod.actions === null) {
    return { reason: 'index.js does not export an `actions` object' };
  }

  // Every action named in the manifest must have a matching handler.
  // `actions` is optional on the type so non-function manifests can omit it;
  // validateManifest guarantees a non-empty array on the function-kind path
  // this branch runs in, so the `?? []` is just a TS-narrowing nicety.
  const handlers: Record<string, ActionHandler> = {};
  for (const action of manifest.actions ?? []) {
    const fn = mod.actions[action.name];
    if (typeof fn !== 'function') {
      return {
        reason: `manifest declares action "${action.name}" but index.js has no matching handler`,
      };
    }
    handlers[action.name] = fn;
  }

  // Optional dynamic menu provider (#76 C2). A non-function export is ignored
  // (the plugin simply has no live menu) rather than failing the load — the
  // static manifest.menu, if any, still works.
  const provideMenu = typeof mod.provideMenu === 'function' ? mod.provideMenu : undefined;
  const provideCatalog = typeof mod.provideCatalog === 'function' ? mod.provideCatalog : undefined;
  const provideContext = typeof mod.provideContext === 'function' ? mod.provideContext : undefined;
  const reserveTrigger = typeof mod.reserveTrigger === 'function' ? mod.reserveTrigger : undefined;

  return { manifest, dir, handlers, provideMenu, provideCatalog, provideContext, reserveTrigger };
}

/**
 * Strict structural validator for a parsed `manifest.json`. Returns
 * `null` on success or a single human-readable reason on failure.
 *
 * Primarily exported so tests can pin the validation contract with
 * in-memory fixtures; production callers should go through
 * `loadPlugins`, which calls this internally before importing the
 * plugin's `index.js`.
 *
 * Side effect: on a successful nav-style validation, each preset's
 * `navigation` block is rewritten in place with the normalised value
 * returned by :func:`validateNavigation` (defaults filled in, deadzones
 * clamped). Callers that hand a freshly-parsed manifest in and then
 * read it back get the canonical shape. On a per-preset failure the
 * already-rewritten earlier presets stay rewritten in the input, but
 * the only production caller discards the parsed object on error so
 * the side effect is unobservable.
 */
export function validateManifest(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'manifest is not a JSON object';
  const m = value as Record<string, unknown>;

  // apiVersion is checked first so a plugin written for a different
  // host generation fails with a clear message instead of dribbling
  // out per-field complaints from a contract that doesn't apply.
  //
  // The "< 1" branch and the "< MIN_SUPPORTED" branch look like they
  // overlap (MIN is always >= 1), but they're deliberately split:
  // "< 1" means the manifest is malformed (a plugin would never
  // legitimately declare apiVersion 0 or negative), so the message
  // is a type complaint. "< MIN_SUPPORTED" means the manifest is
  // well-formed but too old, so the message points the user at
  // updating the plugin. Folding them would lose that distinction.
  if (typeof m.apiVersion !== 'number' || !Number.isInteger(m.apiVersion) || m.apiVersion < 1) {
    return 'manifest field "apiVersion" must be a positive integer';
  }
  if (m.apiVersion < MIN_SUPPORTED_PLUGIN_API_VERSION) {
    return `manifest apiVersion ${m.apiVersion} is older than the supported range (${MIN_SUPPORTED_PLUGIN_API_VERSION}..${PLUGIN_API_VERSION}); update the plugin to a newer release`;
  }
  if (m.apiVersion > PLUGIN_API_VERSION) {
    return `manifest apiVersion ${m.apiVersion} is newer than this host supports (max ${PLUGIN_API_VERSION}); update SpaceUX`;
  }

  // kind decides the category folder and which other fields apply, so it's
  // checked before the kind-specific shape below.
  if (typeof m.kind !== 'string' || !PLUGIN_KINDS.includes(m.kind as PluginKind)) {
    return `manifest field "kind" must be one of: ${PLUGIN_KINDS.join(', ')}`;
  }

  for (const key of ['id', 'name', 'version', 'license'] as const) {
    if (typeof m[key] !== 'string' || (m[key] as string).trim() === '') {
      return `manifest field "${key}" must be a non-empty string`;
    }
  }

  // `actions` is the function-plugin payload. Required (non-empty) on a
  // function manifest; rejected on every other kind so a stray field can't
  // slip through unvalidated (symmetric to the `menu` and `presets` rules
  // below). Theme manifests (#47) carry a different, not-yet-defined shape.
  if (m.kind === 'function') {
    if (!Array.isArray(m.actions) || m.actions.length === 0) {
      return 'manifest field "actions" must be a non-empty array';
    }
    // Duplicates inside one manifest would silently overwrite each
    // other in the per-plugin handler map at registration time (the
    // second wins, the first disappears with no error). Reject up
    // front so the failure surfaces against the manifest rather than
    // as "this action does nothing" at runtime.
    const seenNames = new Set<string>();
    for (const action of m.actions as unknown[]) {
      if (typeof action !== 'object' || action === null) return 'every action must be an object';
      const a = action as Record<string, unknown>;
      if (typeof a.name !== 'string' || a.name.trim() === '')
        return 'action.name must be a non-empty string';
      if (typeof a.label !== 'string' || a.label.trim() === '')
        return 'action.label must be a non-empty string';
      if (seenNames.has(a.name)) return `action.name "${a.name}" appears more than once`;
      seenNames.add(a.name);
    }
  } else if (m.actions !== undefined) {
    return 'manifest field "actions" is only valid on a function plugin';
  }

  // `presets` is the nav-style payload: one or more
  // {@link NavStylePresetDescriptor}s. Each preset's navigation block is
  // validated against the same contract as an on-disk menu config
  // (validateNavigation), so a malformed style is rejected at load instead
  // of slipping into the picker. Same dedup as `actions`: a duplicate
  // preset id within one manifest would silently shadow itself in the
  // merged picker list. Rejected outright on any other kind, mirroring
  // `actions` / `menu`.
  if (m.kind === 'nav-style') {
    if (!Array.isArray(m.presets) || m.presets.length === 0) {
      return 'manifest field "presets" must be a non-empty array';
    }
    const seenIds = new Set<string>();
    for (const preset of m.presets as unknown[]) {
      if (typeof preset !== 'object' || preset === null) return 'every preset must be an object';
      const p = preset as Record<string, unknown>;
      if (typeof p.id !== 'string' || p.id.trim() === '')
        return 'preset.id must be a non-empty string';
      if (typeof p.label !== 'string' || p.label.trim() === '')
        return 'preset.label must be a non-empty string';
      if (typeof p.description !== 'string' || p.description.trim() === '')
        return 'preset.description must be a non-empty string';
      if (seenIds.has(p.id)) return `preset.id "${p.id}" appears more than once`;
      seenIds.add(p.id);
      const nav = validateNavigation(p.navigation, `preset "${p.id}" navigation`);
      if (!nav.ok) return nav.reason;
      // Rewrite the raw JSON block with the normalised one (validateNavigation
      // fills in defaults and clamps the deadzones), so downstream consumers
      // (the picker's exact-match against built-in presets, especially) see
      // the canonical shape, not whatever the manifest happened to write.
      p.navigation = nav.value;
    }
  } else if (m.presets !== undefined) {
    return 'manifest field "presets" is only valid on a nav-style plugin';
  }

  // Optional plugin-provided menu (#76). Only a structural check here — the
  // deep node-tree validation (and normalization) runs in loadOne via
  // validateNode, where the menu module is available. Menus are a
  // function-plugin feature.
  if (m.menu !== undefined) {
    if (m.kind !== 'function') return 'manifest field "menu" is only valid on a function plugin';
    if (typeof m.menu !== 'object' || m.menu === null)
      return 'manifest field "menu" must be an object';
    if (typeof (m.menu as Record<string, unknown>).root !== 'object') {
      return 'manifest field "menu.root" must be an object';
    }
  }
  return null;
}

/**
 * Read + validate a plugin's manifest without importing its code. The plugin
 * manager uses this to list installed plugins — including categories the host
 * doesn't execute yet (themes, #47) — where importing `index.js` is either
 * pointless or absent.
 */
export type ReadManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; reason: string };

export async function readPluginManifest(dir: string): Promise<ReadManifestResult> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
  } catch (err) {
    return { ok: false, reason: `cannot read manifest.json: ${describeError(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `manifest.json is not valid JSON: ${describeError(err)}` };
  }
  const manifestErr = validateManifest(parsed);
  if (manifestErr) return { ok: false, reason: manifestErr };
  // Explicit `ok` discriminant rather than `'reason' in result`: validateManifest
  // doesn't reject unknown fields, so a manifest with a top-level "reason" key
  // would otherwise be misread as a load failure.
  return { ok: true, manifest: parsed as PluginManifest };
}

export type InstalledPlugin = { manifest: PluginManifest; dir: string };

/**
 * Scan one category for installed plugins, reading manifests only (no code
 * import). Mirrors loadPlugins' precedence + kind-match + dedup rules so the
 * manager's list matches what the loader would actually run, but works for
 * non-executable categories too.
 */
export async function loadPluginManifests(
  category: PluginKind,
  repoRoot?: string,
): Promise<{ plugins: InstalledPlugin[]; errors: { dir: string; reason: string }[] }> {
  const plugins: InstalledPlugin[] = [];
  const errors: { dir: string; reason: string }[] = [];
  const seenIds = new Set<string>();

  for (const root of pluginCategoryPaths(category, repoRoot)) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = path.join(root, entry);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const result = await readPluginManifest(dir);
      if (!result.ok) {
        errors.push({ dir, reason: result.reason });
        continue;
      }
      const { manifest } = result;
      if (manifest.kind !== category) {
        errors.push({
          dir,
          reason: `manifest kind "${manifest.kind}" does not match the "${category}" folder it is installed in`,
        });
        continue;
      }
      if (seenIds.has(manifest.id)) continue;
      seenIds.add(manifest.id);
      plugins.push({ manifest, dir });
    }
  }
  return { plugins, errors };
}

/** Build a per-plugin ActionContext. The logger prefixes every
 *  message with the plugin id; `injectChord` is a thin pass-through
 *  to the daemon so plugins never hold a `DaemonClient` reference
 *  themselves and the dispatch path is the same for built-ins and
 *  third-party plugins. */
export function makeActionContext(pluginId: string, daemon: DaemonClient): ActionContext {
  return {
    pluginId,
    log: (message: string) => {
      // eslint-disable-next-line no-console
      console.log(`[plugin ${pluginId}] ${message}`);
    },
    injectChord: (modifiers, key) => daemon.injectChord(modifiers, key),
    injectAvailable: () => daemon.isInjectAvailable(),
  };
}

/** Convenience reducer: flatten every loaded plugin's actions into one
 *  map keyed by "<pluginId>/<actionName>". The renderer addresses
 *  actions by this composite key so two plugins can both expose
 *  e.g. "launch" without clashing. */
export function indexActions(
  plugins: LoadedPlugin[],
): Record<string, { plugin: LoadedPlugin; descriptor: ActionDescriptor }> {
  const idx: Record<string, { plugin: LoadedPlugin; descriptor: ActionDescriptor }> = {};
  for (const plugin of plugins) {
    for (const descriptor of plugin.manifest.actions ?? []) {
      idx[`${plugin.manifest.id}/${descriptor.name}`] = { plugin, descriptor };
    }
  }
  return idx;
}
