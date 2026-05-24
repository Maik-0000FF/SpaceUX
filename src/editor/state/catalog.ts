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
  /** Discover the catalog plugin and pull its already-loaded catalog. Safe to
   *  call from several components on mount — only the first (idle) call runs;
   *  the rest see a non-idle status and no-op. */
  ensureLoaded: () => Promise<void>;
  /** Cycle every workbench in FreeCAD so unloaded ones are listed too. */
  loadAll: () => Promise<void>;
};

export const useCatalog = create<CatalogState>((set, get) => ({
  plugin: null,
  status: 'idle',
  reason: null,
  groups: [],
  complete: false,
  ensureLoaded: async () => {
    if (get().status !== 'idle') return; // first caller wins (effects run in order)
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
      });
    } else {
      set({ status: 'error', reason: res.reason });
    }
  },
}));
