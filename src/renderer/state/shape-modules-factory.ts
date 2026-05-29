// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { type PluginInvalidatedPayload } from '@/shared/ipc';
import { validateShapePluginModule, type ShapePluginModule } from '@/shared/shape-plugin-api';

/**
 * Factory for the shape-plugin runtime store (#107). Both renderer
 * windows (the editor and the live overlay) need the same store
 * behaviour — coalescing concurrent loads, blob-URL dynamic import,
 * module-export validation, error caching — but they pull plugin
 * source through different bridges (`window.editor.getShapeSource`
 * vs `window.spaceux.getShapeSource`). The wrappers in
 * `src/editor/state/shape-modules.ts` and
 * `src/renderer/state/shape-modules.ts` instantiate this factory
 * with their respective `getSource` so the store logic lives in
 * exactly one place.
 *
 * Trust model: shape-plugin code runs in the renderer process with
 * the renderer's privileges. The validator ensures the module
 * exports the expected functions; it does NOT sandbox arbitrary
 * side effects from the imported module's top-level code (a plugin
 * doing `globalThis.x = 'pwn'` at top level has already done so by
 * the time the validator runs).
 */

/** What the store holds for one plugin id once loaded. */
type ShapeModuleEntry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; module: ShapePluginModule }
  | { status: 'error'; reason: string };

export type ShapeModulesStoreState = {
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

/** Create a shape-modules zustand store bound to the given `getSource` IPC
 *  method. `subscribePluginInvalidated` is optional: when provided, the
 *  factory subscribes to plugin-invalidation events (#269) and drops the
 *  cached entry for any shape plugin whose source changed on disk
 *  (uninstall or re-import). Tests typically omit it so no real bridge is
 *  needed in the test environment. Returns the store hook + a test-only
 *  setter for the importer; both are scoped to this factory call so
 *  swapping the importer for one store doesn't affect any other. */
export function createShapeModulesStore(
  getSource: (pluginId: string) => Promise<string | null>,
  subscribePluginInvalidated?: (handler: (payload: PluginInvalidatedPayload) => void) => () => void,
): {
  useShapeModules: UseBoundStore<StoreApi<ShapeModulesStoreState>>;
  _setShapeImporterForTests: (next: ShapeSourceImporter | null) => void;
} {
  let importer: ShapeSourceImporter = defaultBlobUrlImporter;

  const useShapeModules = create<ShapeModulesStoreState>((set, get) => ({
    modules: {},
    ensureLoaded: (pluginId) => {
      const existing = get().modules[pluginId];
      if (existing?.status === 'ready' || existing?.status === 'error') {
        return Promise.resolve();
      }
      if (existing?.status === 'loading') return existing.promise;
      // Synchronously stash the loading promise so a second
      // ensureLoaded call in the same tick observes `loading` and
      // returns the same promise instead of starting a parallel
      // IPC + import.
      const promise = (async () => {
        const source = await getSource(pluginId);
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

  // Wire renderer-side cache invalidation (#269). The bridge broadcasts on
  // every plugin import + uninstall regardless of kind; this store only
  // cares about the shape kind, so the handler filters before clearing.
  // No unsubscribe is kept because the store lives for the lifetime of the
  // renderer window — leak isn't observable.
  if (subscribePluginInvalidated) {
    subscribePluginInvalidated((payload) => {
      if (payload.kind === 'shape') useShapeModules.getState().clear(payload.pluginId);
    });
  }

  return {
    useShapeModules,
    _setShapeImporterForTests: (next) => {
      importer = next ?? defaultBlobUrlImporter;
    },
  };
}
