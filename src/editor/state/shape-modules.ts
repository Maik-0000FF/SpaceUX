// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

import { validateShapePluginModule, type ShapePluginModule } from '@/shared/shape-plugin-api';

/**
 * Shape-plugin runtime (#107 PR2): pulls a shape plugin's `index.js`
 * source from main, creates a Blob URL, dynamic-imports it into the
 * renderer process, validates the exported `layout` + `hitTest` against
 * the {@link ShapePluginModule} contract, and caches the result so each
 * plugin is loaded at most once per app session.
 *
 * Lazy: nothing happens until a consumer (the picker in PR3, or a unit
 * test) calls `ensureLoaded(pluginId)`. The wedge default path never
 * touches this store, so a user with no shape plugin installed pays
 * zero runtime cost.
 *
 * Trust model: shape-plugin code runs in the renderer process with the
 * renderer's privileges. Same trust contract as function plugins (which
 * run in main): the user explicitly imports the plugin folder, vouching
 * for the code inside. The validator ensures the module exports the
 * expected functions; it does NOT sandbox arbitrary side effects from
 * the imported module's top-level code.
 */

/** What the store holds for one plugin id once loaded. */
type ShapeModuleEntry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; module: ShapePluginModule }
  | { status: 'error'; reason: string };

type ShapeModulesStoreState = {
  /** Per-plugin load state. `undefined` = never asked; otherwise the
   *  loading promise, the loaded module, or the failure reason. */
  modules: Record<string, ShapeModuleEntry>;
  /** Ensure a shape plugin is loaded into the renderer. Idempotent:
   *  concurrent calls for the same `pluginId` share one IPC + import
   *  round-trip; a subsequent call after a successful load is a no-op.
   *  A failed load leaves the entry in `error` state; `clear(pluginId)`
   *  lets a retry path drop it back to never-asked. */
  ensureLoaded: (pluginId: string) => Promise<void>;
  /** Drop a plugin's cached entry, so the next `ensureLoaded` retries
   *  from scratch. Used when the plugin is uninstalled or replaced via
   *  an import. */
  clear: (pluginId: string) => void;
  /** Read the loaded module for a plugin id, or null when it isn't
   *  ready (never loaded, still loading, errored). Pure read; consumers
   *  call `ensureLoaded` first and then this in their render path. */
  get: (pluginId: string) => ShapePluginModule | null;
};

/** Type of the function that turns a JS source string into an imported
 *  module. Defaults to the Blob-URL dynamic-import path (the renderer's
 *  native loader); tests inject a fake that returns a synthetic module
 *  so the store's IPC + caching can be exercised without a real
 *  Chromium import. */
export type ShapeSourceImporter = (source: string) => Promise<unknown>;

let importer: ShapeSourceImporter = defaultBlobUrlImporter;

/** Default importer: wrap the source in a Blob, mint an object URL, and
 *  dynamic-import that URL. The Blob URL is revoked after import resolves
 *  (the module reference is retained by the runtime). */
async function defaultBlobUrlImporter(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    // `@vite-ignore` keeps Vite from trying to statically resolve the
    // URL at build time; this is a runtime dynamic import.
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Swap the importer for tests. Pure side-effect helper; callers must
 *  restore the default afterwards. Not used in production. */
export function _setShapeImporterForTests(next: ShapeSourceImporter | null): void {
  importer = next ?? defaultBlobUrlImporter;
}

export const useShapeModules = create<ShapeModulesStoreState>((set, get) => ({
  modules: {},
  ensureLoaded: (pluginId) => {
    const existing = get().modules[pluginId];
    if (existing?.status === 'ready' || existing?.status === 'error') {
      return Promise.resolve();
    }
    if (existing?.status === 'loading') return existing.promise;
    // Synchronously stash the loading promise so a second ensureLoaded
    // call in the same tick observes `loading` and returns the same
    // promise instead of starting a parallel IPC + import (same race
    // discipline as src/editor/state/plugins.ts's pending guard).
    const promise = (async () => {
      const source = await window.editor.getShapeSource(pluginId);
      if (source === null) {
        set((s) => ({
          modules: {
            ...s.modules,
            [pluginId]: { status: 'error', reason: 'shape plugin source not available' },
          },
        }));
        return;
      }
      let mod: unknown;
      try {
        mod = await importer(source);
      } catch (err) {
        set((s) => ({
          modules: {
            ...s.modules,
            [pluginId]: {
              status: 'error',
              reason: `shape plugin import failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          },
        }));
        return;
      }
      const reason = validateShapePluginModule(mod);
      if (reason !== null) {
        set((s) => ({
          modules: { ...s.modules, [pluginId]: { status: 'error', reason } },
        }));
        return;
      }
      set((s) => ({
        modules: {
          ...s.modules,
          [pluginId]: { status: 'ready', module: mod as ShapePluginModule },
        },
      }));
    })();
    set((s) => ({
      modules: { ...s.modules, [pluginId]: { status: 'loading', promise } },
    }));
    return promise;
  },
  clear: (pluginId) =>
    set((s) => {
      if (!(pluginId in s.modules)) return s;
      const next = { ...s.modules };
      delete next[pluginId];
      return { modules: next };
    }),
  get: (pluginId) => {
    const entry = get().modules[pluginId];
    return entry?.status === 'ready' ? entry.module : null;
  },
}));
