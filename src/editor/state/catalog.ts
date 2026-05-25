// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

import type { PluginInfo } from '@/shared/ipc';
import type { PluginCatalogGroup } from '@/shared/plugin-types';

/**
 * The active catalog plugin's command catalog (#76 D2 / #193), shared across
 * the editor so the command palette and the FreeCAD source controls read one
 * catalog and share a single "Load all" instead of each fetching their own
 * (which would let the two drift, e.g. Load all in one not reaching the other).
 *
 * `ensureLoaded` discovers the catalog plugin (FreeCAD today) and pulls its
 * already-loaded commands; `loadAll` cycles every workbench in FreeCAD so the
 * unloaded ones are listed too. The raw catalog is sanitised at the point of
 * use (icons / command / label), as it isn't validated at the IPC boundary.
 */
type CatalogState = {
  /** The loaded plugin that offers a catalog, or null when none is installed. */
  plugin: PluginInfo | null;
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** Failure reason when `status === 'error'` (e.g. the bridge is unreachable). */
  reason: string | null;
  groups: PluginCatalogGroup[];
  /** Whether every workbench is included (a `loadAll` pull ran). */
  complete: boolean;
  /** The active plugin's own app icon (data URI), read live — the bottom-left
   *  badge (#186). Undefined when the plugin/bridge reports none. */
  appBadge: string | undefined;
  /** Discover the catalog plugin and pull its already-loaded catalog. Safe to
   *  call from several components on mount, and to re-call on remount: it
   *  dedupes only while `loading`/`ready` (first caller wins), but retries from
   *  `idle` *and* `error` — so the palette recovers when FreeCAD is started
   *  after the editor (a remount, e.g. a tab switch, re-runs it). */
  ensureLoaded: () => Promise<void>;
  /** Cycle every workbench in FreeCAD so unloaded ones are listed too. */
  loadAll: () => Promise<void>;
  /** Force a re-fetch (unlike ensureLoaded, runs even when `ready`), preserving
   *  the current load scope (`complete`). Used by the "currently usable" filter
   *  to refresh each command's live `enabled` state (#217). */
  refresh: () => Promise<void>;
};

export const useCatalog = create<CatalogState>((set, get) => ({
  plugin: null,
  status: 'idle',
  reason: null,
  groups: [],
  complete: false,
  appBadge: undefined,
  ensureLoaded: async () => {
    // Dedupe an in-flight / settled-good load (first caller wins), but allow a
    // retry from idle or error so a remount recovers a prior failure.
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    const state = await window.editor.getPlugins().catch(() => null);
    const plugin = state?.plugins.find((p) => p.hasCatalog) ?? null;
    if (!plugin) {
      set({ plugin: null, status: 'ready', groups: [], complete: false });
      return;
    }
    const res = await window.editor.getPluginCatalog(plugin.id, false);
    if (res.ok) {
      set({
        plugin,
        status: 'ready',
        reason: null,
        groups: res.catalog.groups,
        complete: res.catalog.complete,
        appBadge: res.catalog.appBadge,
      });
    } else {
      set({ plugin, status: 'error', reason: res.reason, groups: [], complete: false });
    }
  },
  loadAll: async () => {
    const { plugin } = get();
    if (!plugin) return;
    set({ status: 'loading' });
    const res = await window.editor.getPluginCatalog(plugin.id, true);
    if (res.ok) {
      set({
        status: 'ready',
        reason: null,
        groups: res.catalog.groups,
        complete: res.catalog.complete,
        appBadge: res.catalog.appBadge,
      });
    } else {
      set({ status: 'error', reason: res.reason });
    }
  },
  refresh: async () => {
    // No plugin discovered yet → fall back to first-time discovery.
    if (!get().plugin) return get().ensureLoaded();
    const { plugin, complete } = get();
    set({ status: 'loading' });
    // Re-fetch at the same scope so the catalog's contents stay stable and only
    // the live `enabled` flags refresh (loadAll re-cycles workbenches).
    const res = await window.editor.getPluginCatalog(plugin!.id, complete);
    if (res.ok) {
      set({
        status: 'ready',
        reason: null,
        groups: res.catalog.groups,
        complete: res.catalog.complete,
        appBadge: res.catalog.appBadge,
      });
    } else {
      set({ status: 'error', reason: res.reason });
    }
  },
}));
