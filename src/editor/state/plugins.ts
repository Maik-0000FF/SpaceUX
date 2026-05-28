// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

import type { PluginsState } from '@/shared/ipc';

/**
 * Shared editor-side snapshot of {@link PluginsState} (installed plugins +
 * load errors). One source of truth for every component that needs to know
 * what's loaded: the Plugin Manager (which mutates it on import / uninstall)
 * and the navigation-style picker (which reads plugin-contributed presets,
 * #195).
 *
 * The Plugin Manager is the only mutation point in the editor today, so
 * after a successful import or uninstall it calls `setState` with the
 * fresh snapshot main returned. Other readers subscribe and re-render
 * without polling.
 */
type PluginsStoreState = {
  plugins: PluginsState['plugins'];
  errors: PluginsState['errors'];
  /** True once `ensureLoaded` has completed at least one pull. Lets a
   *  consumer distinguish "no plugins installed" from "we haven't pulled
   *  yet" so it doesn't flash an empty state before the first fetch. */
  loaded: boolean;
  /** Mount-time idempotent pull: if no pull has happened yet, fetch and
   *  populate the store. Safe to call from multiple components on mount;
   *  duplicate calls coalesce. */
  ensureLoaded: () => Promise<void>;
  /** Replace the store contents with a fresh snapshot. The Plugin Manager
   *  calls this after a successful import / uninstall so every subscriber
   *  picks up the change immediately. */
  setState: (state: PluginsState) => void;
};

let pending: Promise<void> | null = null;

export const usePluginsState = create<PluginsStoreState>((set, get) => ({
  plugins: [],
  errors: [],
  loaded: false,
  ensureLoaded: async () => {
    if (get().loaded) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        const next = await window.editor.getPlugins();
        set({ plugins: next.plugins, errors: next.errors, loaded: true });
      } finally {
        pending = null;
      }
    })();
    return pending;
  },
  setState: (next) => set({ plugins: next.plugins, errors: next.errors, loaded: true }),
}));
