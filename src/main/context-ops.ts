// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ContextSeedResult } from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';
import { makeContextMenuId } from '../shared/plugin-types.js';

import { loadContextMenu, seedContextConfig, writeContextMenu } from './context-loader.js';
import { DEFAULT_CONTEXT_LABEL } from './plugin-state.js';
import { getPluginCatalog, type PluginRuntimeContext } from './plugin-runtime.js';

/**
 * Seed a curated per-context pie from a plugin's live catalog (#193): pull the
 * catalog, find the requested context group, and write the pie seeded off the
 * global `base` (trigger / navigation / scale). Resolves with the new `ctx:` id,
 * or a failure reason (bridge down / context empty / write conflict). Shared by
 * the editor's main process and the headless core (#457).
 */
export async function seedContextFromCatalog(
  pluginId: string,
  contextKey: string,
  overwrite: boolean,
  ctx: PluginRuntimeContext,
  base: MenuConfig,
): Promise<ContextSeedResult> {
  const catalog = await getPluginCatalog(pluginId, false, ctx);
  if (!catalog.ok) return { ok: false, reason: catalog.reason };

  const group = catalog.catalog.groups.find((g) => g.key === contextKey);
  if (!group || group.toolbars.every((tb) => tb.commands.length === 0)) {
    // Word the reason in the plugin's own terms (#288): its context noun and app
    // name, so a non-FreeCAD catalog plugin reads correctly. The plugin is
    // guaranteed loaded here (getPluginCatalog resolved its catalog).
    const plugin = ctx.loadedPlugins.find((p) => p.manifest.id === pluginId);
    const noun = (plugin?.manifest.context?.label ?? DEFAULT_CONTEXT_LABEL).toLowerCase();
    const appName = plugin?.manifest.name ?? pluginId;
    return {
      ok: false,
      reason: `${noun} "${contextKey}" has no commands loaded. Open it in ${appName} (or use Load all) first`,
    };
  }

  // A fresh seed (expectedMtime null) conflicts if a pie already exists; a
  // re-seed (overwrite) writes against the existing mtime so it replaces the
  // file, but only here, after a successful pull, so a bridge error above leaves
  // the current curated pie intact (#207).
  const id = makeContextMenuId(pluginId, contextKey);
  let expectedMtime: number | null = null;
  if (overwrite) {
    const existing = await loadContextMenu(id);
    if (existing.status === 'loaded') expectedMtime = existing.mtime;
  }
  const result = await writeContextMenu(
    id,
    seedContextConfig(group, base, pluginId),
    expectedMtime,
  );
  if (result.ok !== true) {
    return {
      ok: false,
      reason:
        result.ok === 'conflict'
          ? overwrite
            ? 'the curated pie changed on disk, try again'
            : 'a curated pie already exists for this workbench'
          : result.reason,
    };
  }
  return { ok: true, id };
}
