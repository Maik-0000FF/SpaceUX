// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import path from 'node:path';

import { MAX_ICON_BYTES, sanitizeSvg } from '../core/icon.js';
import type { PluginInfo, PluginsState } from '../shared/ipc.js';
import { PLUGIN_MENU_ID_PREFIX, type PluginManifest } from '../shared/plugin-types.js';

import { pluginTrust } from './plugin-hash.js';
import { loadPluginManifests, userExtensionsRoot, type LoadedPlugin } from './plugin-loader.js';
import { refreshShapeManifestCache, shapeManifestErrors, shapeManifests } from './shape-source.js';

/**
 * Editor-facing plugin snapshots, derived from the installed plugins + their
 * manifests. The core builds the plugin-manager state here; the live plugin /
 * action state stays with the caller and is passed in.
 */

/** The noun the editor shows for a plugin's live "context" when its manifest
 *  declares none (#288). FreeCAD's reference value; one literal so the default
 *  is consistent across `PluginInfo.contextLabel` and the seed-error wording. */
export const DEFAULT_CONTEXT_LABEL = 'Workbench';

/** Bake a plugin's badge icon (#186) into a data URI for the renderers, or
 *  undefined when there's none / it can't be read. SVG only for now (the badge
 *  is a vector app icon); sanitised + size-guarded like a picked node icon. */
function bakeBadge(dir: string, badge: string | undefined): string | undefined {
  if (badge === undefined || !badge.toLowerCase().endsWith('.svg')) return undefined;
  // Confine the badge to the plugin dir: a manifest `badge: "../../x.svg"` must
  // not read an arbitrary file (consistency with context-loader; the plugin is
  // trusted, but keep the path contained anyway).
  const base = path.resolve(dir);
  const file = path.resolve(base, badge);
  if (file !== base && !file.startsWith(base + path.sep)) return undefined;
  try {
    const raw = fsSync.readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw) > MAX_ICON_BYTES) return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(sanitizeSvg(raw)).toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Map a loaded/installed plugin to the editor-facing {@link PluginInfo}. */
export function toPluginInfo(
  manifest: PluginManifest,
  dir: string,
  hasCatalog = false,
  hasBridge = false,
): PluginInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    dir,
    // Removable only when it lives in the user-writable managed dir (imported);
    // a repo-dev / system plugin isn't deletable from here (#221).
    removable: dir === userExtensionsRoot() || dir.startsWith(userExtensionsRoot() + path.sep),
    // Content-verified (not by id or origin): community / verified / mismatch.
    trust: pluginTrust(manifest.id, dir),
    // Declared, validated permissions the plugin requests; empty if none.
    permissions: manifest.permissions ?? [],
    actionCount: manifest.actions?.length ?? 0,
    hasCatalog,
    hasBridge,
    // Static, so derived straight from the manifest (no loaded module needed).
    // Gated to `function` (the only kind whose menu the host consumes) so a
    // stray `menu` on another kind can't claim a capability that isn't honored.
    hasMenu: manifest.kind === 'function' && manifest.menu !== undefined,
    // #288: the plugin's own word for its live context (FreeCAD = the default
    // "Workbench"); the editor shows it instead of hardcoding one.
    contextLabel: manifest.context?.label ?? DEFAULT_CONTEXT_LABEL,
    badge: bakeBadge(dir, manifest.badge),
    // Nav-style plugins ship presets via the manifest (no index.js is loaded);
    // forwarded as-is so the editor's picker can merge them with built-ins.
    navStylePresets: manifest.kind === 'nav-style' ? manifest.presets : undefined,
    // Shape plugins (#107) ship one shape descriptor (the entry source is
    // pulled lazily in PR2's renderer runtime, not embedded here).
    shape: manifest.kind === 'shape' ? manifest.shape : undefined,
  };
}

/**
 * Snapshot the installed plugins for the editor's manager: the live `function`
 * plugins (already loaded for the action index, passed in), plus three
 * manifest-only categories listed but not executed at this stage: `theme`
 * (#47), `nav-style` (#195), and `shape` (#107 as a plugin). The shape series
 * resolves the entry source on demand, so the shape-manifest cache is refreshed
 * here for an O(1) later lookup.
 */
export async function buildPluginsState(
  loadedPlugins: LoadedPlugin[],
  pluginErrors: { dir: string; reason: string }[],
): Promise<PluginsState> {
  const fnPlugins = loadedPlugins.map((p) =>
    toPluginInfo(p.manifest, p.dir, p.provideCatalog !== undefined, p.provideBridge !== undefined),
  );
  const theme = await loadPluginManifests('theme');
  const themePlugins = theme.plugins.map(({ manifest, dir }) => toPluginInfo(manifest, dir));
  const navStyle = await loadPluginManifests('nav-style');
  const navStylePlugins = navStyle.plugins.map(({ manifest, dir }) => toPluginInfo(manifest, dir));
  await refreshShapeManifestCache();
  const shapePlugins = Array.from(shapeManifests().values()).map(({ manifest, dir }) =>
    toPluginInfo(manifest, dir),
  );
  return {
    plugins: [...fnPlugins, ...themePlugins, ...navStylePlugins, ...shapePlugins],
    errors: [...pluginErrors, ...theme.errors, ...navStyle.errors, ...shapeManifestErrors()],
  };
}

/** The plugin-provided menus (#105) for the editor's profile dropdown: every
 *  loaded `function` plugin that declares a `menu`, as a `pm:`-prefixed id. */
export function listPluginMenus(loadedPlugins: LoadedPlugin[]): { id: string; name: string }[] {
  return loadedPlugins
    .filter((p) => p.manifest.menu !== undefined)
    .map((p) => ({ id: `${PLUGIN_MENU_ID_PREFIX}${p.manifest.id}`, name: p.manifest.name }));
}
