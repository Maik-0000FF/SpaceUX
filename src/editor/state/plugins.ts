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
 * after a successful import or uninstall it calls `applySnapshot` with the
 * fresh snapshot main returned. Other readers subscribe and re-render
 * without polling.
 */
type PluginsStoreState = {
  plugins: PluginsState['plugins'];
  errors: PluginsState['errors'];
  /** True once `ensureLoaded` has completed a successful pull at least
   *  once. Lets a consumer distinguish "no plugins installed" from "we
   *  haven't pulled yet" so it doesn't flash an empty state before the
   *  first fetch. Stays `false` on a rejected pull so the next call retries
   *  instead of locking in an empty list. */
  loaded: boolean;
  /** In-flight load promise; coalesces concurrent `ensureLoaded` calls
   *  into one IPC pull. Module-internal state, exposed through the store
   *  so tests can reset it via `setState` rather than via a module-scoped
   *  global. Consumers don't read this. */
  pending: Promise<void> | null;
  /** Mount-time idempotent pull: if no successful pull has happened yet,
   *  fetch and populate the store. Safe to call from multiple components on
   *  mount; concurrent calls dedupe to one IPC round-trip. A rejected pull
   *  is swallowed (the previous good state, or the empty default, stays
   *  visible — a failed pull shouldn't blank the list); `loaded` stays
   *  false so a subsequent call retries. */
  ensureLoaded: () => Promise<void>;
  /** Replace the store contents with a fresh snapshot. The Plugin Manager
   *  calls this after a successful import / uninstall so every subscriber
   *  picks up the change immediately. Named `applySnapshot` to avoid
   *  shadowing zustand's own `setState`. */
  applySnapshot: (state: PluginsState) => void;
};

export const usePluginsState = create<PluginsStoreState>((set, get) => ({
  plugins: [],
  errors: [],
  loaded: false,
  pending: null,
  ensureLoaded: () => {
    if (get().loaded) return Promise.resolve();
    const inflight = get().pending;
    if (inflight) return inflight;
    // Synchronously stash the promise *before* yielding, so a second
    // ensureLoaded call in the same tick observes `pending` and returns
    // the same promise instead of starting a parallel IPC pull.
    const promise = window.editor
      .getPlugins()
      .then((next) => {
        set({ plugins: next.plugins, errors: next.errors, loaded: true, pending: null });
      })
      .catch(() => {
        // Keep the last good state; a failed pull shouldn't blank the list.
        // Leave `loaded` as-is so a later call can retry from idle / error.
        set({ pending: null });
      });
    set({ pending: promise });
    return promise;
  },
  applySnapshot: (next) =>
    set({ plugins: next.plugins, errors: next.errors, loaded: true, pending: null }),
}));
