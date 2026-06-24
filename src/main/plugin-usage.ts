// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PieAppearance, PluginKind, PluginUsageReport } from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';
import { parsePluginKey } from '../shared/plugin-key.js';

import { listContextMenus, loadContextMenu, writeContextMenu } from './context-loader.js';
import { loadMenuConfig, menuConfigSearchPaths } from './menu-loader.js';
import { markSelfWrite } from './menu-watcher.js';
import { writeMenuConfig } from './menu-writer.js';
import { listDeviceProfiles, loadDeviceProfile, writeDeviceProfile } from './profile-loader.js';
import { scanPluginUsage, type MenuRef } from './plugin-usage-scan.js';

/**
 * Where is a plugin used (#265)? Gather every saved menu source, the global
 * fallback, every device profile (each with its own MenuConfig + optional
 * bundled PieAppearance, #113), and every curated per-context pie (#193), then
 * run the pure scanner over them. Each ref carries the appearance that
 * effectively applies to it so the scanner can resolve `shapeModel: undefined`
 * (inherit) against the right baseline. This wrapper does the IO + labelling so
 * the editor's Remove confirm can show where the plugin is in use; the scanner
 * itself stays pure.
 */
export async function scanPluginUsageInSavedMenus(
  pluginId: string,
  kind: PluginKind,
  appearance: PieAppearance,
  defaultMenu: MenuConfig,
): Promise<PluginUsageReport> {
  const menus: MenuRef[] = [];

  // loadMenuConfig always resolves to a config (real or the built-in default),
  // so include it unconditionally. The fallback inherits the global appearance.
  const fallback = await loadMenuConfig(menuConfigSearchPaths(), defaultMenu);
  menus.push({ name: 'Global menu (fallback)', config: fallback.config, appearance });

  for (const profileId of await listDeviceProfiles()) {
    const prof = await loadDeviceProfile(profileId);
    if (prof.status === 'loaded') {
      menus.push({
        name: `Device profile ${profileId}`,
        config: prof.config,
        // A profile's bundled appearance wins for that profile; only fall back
        // to the global one when the profile didn't ship its own (the historical
        // bare-MenuConfig profile shape).
        appearance: prof.appearance ?? appearance,
      });
    }
  }

  for (const ctxId of await listContextMenus()) {
    const ctx = await loadContextMenu(ctxId);
    if (ctx.status === 'loaded') {
      // Use the ctx: id verbatim (the file name already carries the plugin +
      // context key; a richer label would need the plugin's catalog, overkill
      // for the confirm message). Context menus don't bundle their own
      // appearance, so they inherit the global one.
      menus.push({ name: ctxId, config: ctx.config, appearance });
    }
  }

  return scanPluginUsage(pluginId, kind, menus, appearance);
}

/** Does `key` (a `<pluginId>/<shapeId>` shape-model value) belong to `pluginId`? */
function referencesPlugin(key: string | null | undefined, pluginId: string): boolean {
  return typeof key === 'string' && parsePluginKey(key)?.pluginId === pluginId;
}

/**
 * Strip a per-menu shape-model override referencing `pluginId` (back to
 * inherit). Pure; returns null when the config doesn't reference the plugin,
 * so callers skip the write.
 */
export function stripShapeModel(config: MenuConfig, pluginId: string): MenuConfig | null {
  if (!referencesPlugin(config.shapeModel, pluginId)) return null;
  const copy = structuredClone(config);
  delete copy.shapeModel;
  return copy;
}

/**
 * Remove every saved reference to an uninstalled shape plugin (the user's
 * decision over the orphan-entry alternative: removing the plugin also clears
 * what pointed at it, so the pickers don't carry a dead "(unknown: …)" value;
 * re-installing means re-picking the shape). Walks the same sources as the
 * usage scan: the global menu, every device profile (config + bundled
 * appearance), and every curated context pie. The host clears its in-memory
 * global appearance itself (its persistence + push differ per host).
 */
export async function cleanupShapeReferencesInSavedMenus(
  pluginId: string,
  defaultMenu: MenuConfig,
): Promise<void> {
  const fallback = await loadMenuConfig(menuConfigSearchPaths(), defaultMenu);
  if (fallback.source !== null) {
    const next = stripShapeModel(fallback.config, pluginId);
    if (next !== null) {
      markSelfWrite(fallback.source);
      await writeMenuConfig(fallback.source, next, fallback.mtime);
    }
  }

  for (const profileId of await listDeviceProfiles()) {
    const prof = await loadDeviceProfile(profileId);
    if (prof.status !== 'loaded') continue;
    // Historical bare profiles (no bundled appearance) are skipped: the
    // writer always bundles one, and wrapping such a profile here would
    // change its inherit semantics just to strip a field; the picker's
    // orphan handling still covers that residue if one is ever activated.
    if (prof.appearance == null) continue;
    const nextConfig = stripShapeModel(prof.config, pluginId);
    const stripAppearance = referencesPlugin(prof.appearance.shapeModel, pluginId);
    if (nextConfig === null && !stripAppearance) continue;
    const appearance = stripAppearance ? { ...prof.appearance, shapeModel: null } : prof.appearance;
    await writeDeviceProfile(profileId, nextConfig ?? prof.config, appearance);
  }

  for (const ctxId of await listContextMenus()) {
    const ctx = await loadContextMenu(ctxId);
    if (ctx.status !== 'loaded') continue;
    const next = stripShapeModel(ctx.config, pluginId);
    if (next !== null) await writeContextMenu(ctxId, next, ctx.mtime);
  }
}
