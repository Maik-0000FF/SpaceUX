// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { describeError } from '../shared/errors.js';
import {
  MIN_SUPPORTED_PLUGIN_API_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_KINDS,
  type ActionContext,
  type ActionDescriptor,
  type ActionHandler,
  type PluginKind,
  type PluginManifest,
  type PluginModule,
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
  const handlers: Record<string, ActionHandler> = {};
  for (const action of manifest.actions) {
    const fn = mod.actions[action.name];
    if (typeof fn !== 'function') {
      return {
        reason: `manifest declares action "${action.name}" but index.js has no matching handler`,
      };
    }
    handlers[action.name] = fn;
  }

  return { manifest, dir, handlers };
}

/**
 * Strict structural validator for a parsed `manifest.json`. Returns
 * `null` on success or a single human-readable reason on failure.
 *
 * Primarily exported so tests can pin the validation contract with
 * in-memory fixtures; production callers should go through
 * `loadPlugins`, which calls this internally before importing the
 * plugin's `index.js`.
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

  // `actions` is the function-plugin payload. Theme plugins (#47) carry a
  // different, not-yet-defined shape, so the `actions` contract only applies
  // to `kind: "function"`; a theme manifest without actions is valid here.
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
  }
  return null;
}

/**
 * Read + validate a plugin's manifest without importing its code. The plugin
 * manager uses this to list installed plugins — including categories the host
 * doesn't execute yet (themes, #47) — where importing `index.js` is either
 * pointless or absent.
 */
export async function readPluginManifest(
  dir: string,
): Promise<PluginManifest | { reason: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
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
  return parsed as PluginManifest;
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
      if ('reason' in result) {
        errors.push({ dir, reason: result.reason });
        continue;
      }
      if (result.kind !== category) {
        errors.push({
          dir,
          reason: `manifest kind "${result.kind}" does not match the "${category}" folder it is installed in`,
        });
        continue;
      }
      if (seenIds.has(result.id)) continue;
      seenIds.add(result.id);
      plugins.push({ manifest: result, dir });
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
    for (const descriptor of plugin.manifest.actions) {
      idx[`${plugin.manifest.id}/${descriptor.name}`] = { plugin, descriptor };
    }
  }
  return idx;
}
