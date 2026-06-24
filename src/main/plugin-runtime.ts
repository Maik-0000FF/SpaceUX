// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  PluginBridgeActionResult,
  PluginBridgeStatus,
  PluginCatalogResult,
  PluginUninstallDescriptorRequest,
  ProfileActionResult,
} from '../shared/ipc.js';
import type { PluginBridge, PluginHostCapabilities } from '../shared/plugin-types.js';
import { describeError } from '../shared/errors.js';
import { withTimeout } from '../shared/with-timeout.js';

import type { DaemonClient } from './daemon-client.js';
import { makeActionContext, type LoadedPlugin } from './plugin-loader.js';

/** A plugin provider that hangs (e.g. an unresponsive FreeCAD socket) must not
 *  freeze the pie open: cap how long we wait for the dynamic menu. */
export const DYNAMIC_MENU_TIMEOUT_MS = 2000;
/** Timeout for a plugin's uninstall-hook `perform` (#267). Generous compared
 *  to the descriptor query because the perform may do real filesystem work
 *  (removing an addon directory, e.g. FreeCAD's bridge); still bounded so a
 *  hung third-party closure can't block the editor's busy state forever. */
export const UNINSTALL_PERFORM_TIMEOUT_MS = 15000;

/**
 * The live subsystems a plugin hook needs to run: the loaded `function` plugins
 * (to find the target), and the daemon + host that `makeActionContext` wires
 * into the plugin's execution context. The editor's main process and the
 * headless core (#457) each supply their own; the ops below are transport-free.
 */
export interface PluginRuntimeContext {
  loadedPlugins: LoadedPlugin[];
  daemon: DaemonClient;
  pluginHost: PluginHostCapabilities;
}

/** Ask a plugin for its uninstall-hook descriptor (#267): call its
 *  `provideUninstall`, cache the returned perform-closure under the plugin id in
 *  `pending`, and return the user-facing message for the secondary confirm. */
export async function getPluginUninstallHook(
  pluginId: string,
  ctx: PluginRuntimeContext,
  pending: Map<string, () => Promise<ProfileActionResult>>,
): Promise<PluginUninstallDescriptorRequest> {
  // The plugin must be loaded (function kind, in our cache) for its
  // `provideUninstall` to be callable. A theme / nav-style / shape plugin has
  // nothing executable, so no hook either.
  const plugin = ctx.loadedPlugins.find((p) => p.manifest.id === pluginId);
  if (!plugin || !plugin.provideUninstall) {
    pending.delete(pluginId);
    return { available: false };
  }
  try {
    const actionCtx = makeActionContext(plugin.manifest.id, ctx.daemon, ctx.pluginHost);
    const descriptor = await withTimeout(
      Promise.resolve(plugin.provideUninstall(actionCtx)),
      DYNAMIC_MENU_TIMEOUT_MS,
      `provideUninstall timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
    );
    if (descriptor === null) {
      pending.delete(pluginId);
      return { available: false };
    }
    // Cache the closure under the plugin id; the renderer asks the core to invoke
    // it after the user clicks Yes on the secondary confirm.
    pending.set(pluginId, descriptor.perform);
    return { available: true, message: descriptor.message };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin ${pluginId}] provideUninstall failed: ${describeError(err)}`);
    pending.delete(pluginId);
    return { available: false };
  }
}

/** Run the cached uninstall-hook perform-closure for `pluginId` (#267). */
export async function performPluginUninstallHook(
  pluginId: string,
  pending: Map<string, () => Promise<ProfileActionResult>>,
): Promise<ProfileActionResult> {
  const perform = pending.get(pluginId);
  pending.delete(pluginId);
  if (!perform) {
    return { ok: false, reason: 'no uninstall hook is pending for this plugin' };
  }
  try {
    return await withTimeout(
      perform(),
      UNINSTALL_PERFORM_TIMEOUT_MS,
      `plugin uninstall hook timed out after ${UNINSTALL_PERFORM_TIMEOUT_MS}ms`,
    );
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/** Pull a plugin's command catalog for the editor palette (#76 D2): invoke the
 *  plugin's `provideCatalog` with a timeout. */
export async function getPluginCatalog(
  pluginId: string,
  loadAll: boolean,
  ctx: PluginRuntimeContext,
): Promise<PluginCatalogResult> {
  const plugin = ctx.loadedPlugins.find((p) => p.manifest.id === pluginId);
  if (!plugin?.provideCatalog) {
    return { ok: false, reason: 'this plugin provides no command catalog' };
  }
  try {
    const actionCtx = makeActionContext(plugin.manifest.id, ctx.daemon, ctx.pluginHost);
    // loadAll can cycle every workbench (slow): generous cap; the editor shows a
    // spinner while it runs.
    const catalog = await withTimeout(
      Promise.resolve(plugin.provideCatalog(actionCtx, { loadAll })),
      loadAll ? 60000 : 5000,
      `provideCatalog timed out`,
    );
    return { ok: true, catalog };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/** Timeout for a plugin's bridge install / uninstall (#288). Like the uninstall
 *  perform, these copy / remove an addon directory, so bound them generously but
 *  finitely: a hung plugin op must surface a reason in the installer rather than
 *  spin its button forever. `getStatus` is a quick poll, so it reuses the shorter
 *  {@link DYNAMIC_MENU_TIMEOUT_MS}. */
export const BRIDGE_OP_TIMEOUT_MS = 15000;

/** Resolve a plugin's bridge via its `provideBridge` hook (#288), or a reason it
 *  can't be reached (not loaded, no bridge, or the hook hung / threw). */
async function resolvePluginBridge(
  pluginId: string,
  ctx: PluginRuntimeContext,
): Promise<{ ok: true; bridge: PluginBridge } | { ok: false; reason: string }> {
  const plugin = ctx.loadedPlugins.find((p) => p.manifest.id === pluginId);
  if (!plugin?.provideBridge) {
    return { ok: false, reason: 'plugin not loaded or provides no bridge' };
  }
  try {
    const actionCtx = makeActionContext(plugin.manifest.id, ctx.daemon, ctx.pluginHost);
    const bridge = await withTimeout(
      Promise.resolve(plugin.provideBridge(actionCtx)),
      DYNAMIC_MENU_TIMEOUT_MS,
      `provideBridge timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
    );
    return { ok: true, bridge };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/** A plugin's bridge install status, via its `provideBridge` hook (#288). */
export async function getPluginBridge(
  pluginId: string,
  ctx: PluginRuntimeContext,
): Promise<PluginBridgeStatus> {
  const r = await resolvePluginBridge(pluginId, ctx);
  if (!r.ok) return { resolved: false, reason: r.reason };
  try {
    // Quick poll: a hung getStatus would otherwise leave the installer stuck at
    // status===null (renders nothing) on mount.
    return await withTimeout(
      Promise.resolve(r.bridge.getStatus()),
      DYNAMIC_MENU_TIMEOUT_MS,
      `bridge getStatus timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
    );
  } catch (err) {
    return { resolved: false, reason: describeError(err) };
  }
}

/** Install / update a plugin's bridge into its resolved target (#288). */
export async function installPluginBridge(
  pluginId: string,
  ctx: PluginRuntimeContext,
): Promise<PluginBridgeActionResult> {
  const r = await resolvePluginBridge(pluginId, ctx);
  if (!r.ok) return { ok: false, reason: r.reason };
  try {
    return await withTimeout(
      Promise.resolve(r.bridge.install()),
      BRIDGE_OP_TIMEOUT_MS,
      `bridge install timed out after ${BRIDGE_OP_TIMEOUT_MS}ms`,
    );
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/** Remove a plugin's installed bridge (#288). */
export async function uninstallPluginBridge(
  pluginId: string,
  ctx: PluginRuntimeContext,
): Promise<PluginBridgeActionResult> {
  const r = await resolvePluginBridge(pluginId, ctx);
  if (!r.ok) return { ok: false, reason: r.reason };
  try {
    return await withTimeout(
      Promise.resolve(r.bridge.uninstall()),
      BRIDGE_OP_TIMEOUT_MS,
      `bridge uninstall timed out after ${BRIDGE_OP_TIMEOUT_MS}ms`,
    );
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}
