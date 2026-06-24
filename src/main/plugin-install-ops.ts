// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  PluginImportResult,
  PluginInvalidatedPayload,
  PluginKind,
  PluginUninstallResult,
  ProfileActionResult,
} from '../shared/ipc.js';
import type { PluginHostCapabilities } from '../shared/plugin-types.js';

import type { DaemonClient } from './daemon-client.js';
import { importPluginFromFolder, uninstallPlugin } from './plugin-installer.js';
import type { LoadedPlugin } from './plugin-loader.js';
import { installPluginBridge } from './plugin-runtime.js';
import { buildPluginsState, toPluginInfo } from './plugin-state.js';

/**
 * The import / uninstall orchestration for the plugin manager (#221, #269). The
 * sequence (validate + copy / delete, reload, rebuild the snapshot, invalidate
 * renderer caches, set up the bundled bridge) is shared; the caller injects the
 * live plugin state + the two effects that differ per transport: `reloadPlugins`
 * (re-scan + rebuild the action index, then emit ActionsChanged) and
 * `onInvalidated` (drop the caches keyed on a plugin id).
 */
export interface PluginInstallContext {
  daemon: DaemonClient;
  pluginHost: PluginHostCapabilities;
  /** Read the current loaded plugins + errors (after `reloadPlugins` mutates them). */
  getLoadedPlugins: () => LoadedPlugin[];
  getPluginErrors: () => { dir: string; reason: string }[];
  reloadPlugins: () => Promise<void>;
  onInvalidated: (payload: PluginInvalidatedPayload) => void;
  /** Clear every saved reference to a removed SHAPE plugin (global appearance
   *  + per-menu overrides), so the pickers don't keep a dead value. */
  cleanupShapeRefs?: (pluginId: string) => Promise<void>;
}

/** Import the plugin folder at `srcDir`: validate + copy, reload (function kind
 *  only), rebuild the snapshot, invalidate caches, and auto-install its bridge. */
export async function importPlugin(
  srcDir: string,
  ctx: PluginInstallContext,
): Promise<PluginImportResult> {
  const outcome = await importPluginFromFolder(srcDir);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  // Only a function import changes the action index; a theme import just needs
  // the fresh listing below, no rebuild / dropdown refresh.
  if (outcome.manifest.kind === 'function') await ctx.reloadPlugins();
  const state = await buildPluginsState(ctx.getLoadedPlugins(), ctx.getPluginErrors());
  // Tell renderer caches keyed on plugin id (shape-modules today, #269) to drop
  // their entry: covers re-import of an existing id, where the on-disk source is
  // fresh and the cached V8 module is stale. A first-time import is a no-op on
  // the renderer side since nothing was cached.
  ctx.onInvalidated({ pluginId: outcome.manifest.id, kind: outcome.manifest.kind });
  const installed =
    state.plugins.find((p) => p.id === outcome.manifest.id && p.kind === outcome.manifest.kind) ??
    toPluginInfo(outcome.manifest, outcome.dir);
  // A plugin that ships a bridge (FreeCAD's Mod-dir addon) gets it set up right
  // away, so install is one step. Non-blocking: the import succeeds regardless,
  // and the outcome (a success note, or why it couldn't, e.g. FreeCAD not found
  // / sandbox) rides back for the manager to surface.
  const bridge = installed.hasBridge
    ? await installPluginBridge(outcome.manifest.id, {
        loadedPlugins: ctx.getLoadedPlugins(),
        daemon: ctx.daemon,
        pluginHost: ctx.pluginHost,
      })
    : undefined;
  return { ok: true, installed, state, bridge };
}

/** Uninstall a plugin (delete its managed folder) and reload; resolves to the
 *  refreshed state plus whether the delete actually succeeded (#221). `pending`
 *  is the uninstall-hook perform-closure cache, cleared here as the single
 *  chokepoint on every Remove path (#267). */
export async function uninstallPluginFlow(
  kind: PluginKind,
  id: string,
  ctx: PluginInstallContext,
  pending: Map<string, () => Promise<ProfileActionResult>>,
): Promise<PluginUninstallResult> {
  // Always clear a leftover uninstall-hook perform-closure (#267): if the user
  // cancelled the secondary "Plugin cleanup" confirm, performPluginUninstallHook
  // never ran and the cached entry would outlive the plugin itself.
  pending.delete(id);
  const result = await uninstallPlugin(kind, id);
  await ctx.reloadPlugins();
  const state = await buildPluginsState(ctx.getLoadedPlugins(), ctx.getPluginErrors());
  // Drop the renderer-side cache for this plugin id (#269) even when the disk
  // delete itself failed: if the manifest is gone but residual files remain, the
  // next load attempt fails through the existing error path, which is preferable
  // to keeping a stale module live.
  ctx.onInvalidated({ pluginId: id, kind });
  // Removing a shape plugin also clears what referenced it (appearance +
  // per-menu overrides), so the shape pickers drop the value instead of
  // carrying a dead "(unknown: …)" entry.
  if (result.ok && kind === 'shape') await ctx.cleanupShapeRefs?.(id);
  // Always return the refreshed state; surface a real delete error (#221).
  return result.ok ? { ok: true, state } : { ok: false, reason: result.reason, state };
}
