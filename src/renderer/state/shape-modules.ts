// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

import { validateShapePluginModule, type ShapePluginModule } from '@/shared/shape-plugin-api';

/**
 * Shape-plugin runtime for the **live overlay** renderer process
 * (#107 PR3c). Mirrors `src/editor/state/shape-modules.ts` for the
 * editor: pulls a shape plugin's `index.js` source from main via
 * the live overlay's bridge (`window.spaceux.getShapeSource`),
 * creates a Blob URL, dynamic-imports the module into this
 * renderer process, validates the exported `layout` + `hitTest`
 * against the {@link ShapePluginModule} contract, and caches the
 * result per pluginId.
 *
 * Two stores rather than one because each renderer window has its
 * own JS context and its own bridge name (`window.spaceux` here
 * vs `window.editor` there). The store shape, the trust model, and
 * the race discipline (synchronous `loading` stash before the
 * first `await`) are identical to the editor's.
 */

/** What the store holds for one plugin id once loaded. */
type ShapeModuleEntry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; module: ShapePluginModule }
  | { status: 'error'; reason: string };

type ShapeModulesStoreState = {
  modules: Record<string, ShapeModuleEntry>;
  ensureLoaded: (pluginId: string) => Promise<void>;
  clear: (pluginId: string) => void;
  get: (pluginId: string) => ShapePluginModule | null;
};

/** Type of the function that turns a JS source string into an imported
 *  module. Defaults to the Blob-URL dynamic-import path; tests inject
 *  a fake that returns a synthetic module so the store's IPC + caching
 *  can be exercised without a real Chromium import. */
export type ShapeSourceImporter = (source: string) => Promise<unknown>;

let importer: ShapeSourceImporter = defaultBlobUrlImporter;

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
    const promise = (async () => {
      const source = await window.spaceux.getShapeSource(pluginId);
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
