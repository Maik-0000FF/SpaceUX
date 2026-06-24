// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { type PluginInvalidatedPayload } from '../shared/ipc.js';
import { validateShapePluginModule, type ShapePluginModule } from '../shared/shape-plugin-api.js';

/**
 * The core's shape-plugin loader (#325 PR1): resolves a shape plugin's entry
 * source into the `ShapePluginModule` the pie runtime and BuildScene consume,
 * via a Node `data:`-URL dynamic import. Coalesces concurrent loads, caches
 * per id (ready / error), and invalidates on plugin changes.
 *
 * Trust model: the imported module runs with the host process's privileges;
 * the validator only checks the contract exports, it does not sandbox the
 * module's top-level side effects.
 */

/** What the cache holds for one plugin id once a load has started. */
type ShapeModuleEntry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; module: ShapePluginModule }
  | { status: 'error'; reason: string };

/** Turns a JS source string into an imported module. Defaults to a Node
 *  `data:`-URL ESM import; tests inject a fake that returns a synthetic
 *  module so the cache + coalescing can be exercised without a real import.
 *  Mirrors the renderer factory's `ShapeSourceImporter`. */
export type ShapeSourceImporter = (source: string) => Promise<unknown>;

async function defaultDataUrlImporter(source: string): Promise<unknown> {
  // base64-encode so arbitrary source (newlines, non-ASCII, `,` / `#`)
  // survives the data: URL intact; the renderer reaches the same outcome
  // through a Blob. The plugin entry is an ES module exporting the contract
  // functions, so a bare dynamic import resolves it.
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  return import(url);
}

export type MainShapeModuleLoader = {
  /** Start (or join) a load for `pluginId`; resolves once the entry settles
   *  to ready or error. Idempotent: a settled or in-flight id is a no-op. */
  ensureLoaded: (pluginId: string) => Promise<void>;
  /** The loaded module, or null while loading / on error / never asked. */
  get: (pluginId: string) => ShapePluginModule | null;
  /** Drop a cached entry so the next ensureLoaded refetches (invalidation). */
  clear: (pluginId: string) => void;
  /** Test-only importer swap; pass null to restore the default. */
  _setImporterForTests: (next: ShapeSourceImporter | null) => void;
};

/** Create a shape-module loader bound to the given `getSource`. When
 *  `subscribePluginInvalidated` is provided, the loader subscribes and drops
 *  the cached entry for any shape plugin whose source changed on disk
 *  (uninstall or re-import, #269); tests omit it so no real broadcast is
 *  needed. */
export function createMainShapeModuleLoader(
  getSource: (pluginId: string) => Promise<string | null>,
  subscribePluginInvalidated?: (handler: (payload: PluginInvalidatedPayload) => void) => () => void,
): MainShapeModuleLoader {
  let importer: ShapeSourceImporter = defaultDataUrlImporter;
  const modules = new Map<string, ShapeModuleEntry>();

  const clear = (pluginId: string): void => {
    modules.delete(pluginId);
  };

  const ensureLoaded = (pluginId: string): Promise<void> => {
    const existing = modules.get(pluginId);
    if (existing?.status === 'ready' || existing?.status === 'error') {
      return Promise.resolve();
    }
    if (existing?.status === 'loading') return existing.promise;

    // Stash the loading entry synchronously (before the first await suspends)
    // so a second ensureLoaded in the same tick observes `loading` and awaits
    // the same promise instead of starting a parallel read + import.
    //
    // `loadingEntry` is captured by the IIFE below so each post-await step can
    // identity-check the cached entry against it. If a concurrent clear() (an
    // invalidation) removed or replaced the entry mid-flight, the check fails
    // and the in-flight result is dropped instead of re-cacheing the stale
    // module (#269 race). The assignment lands before the first await, so the
    // closure observes the populated reference on every resume.
    let loadingEntry: ShapeModuleEntry;
    const stillUs = () => modules.get(pluginId) === loadingEntry;
    const promise = (async () => {
      const source = await getSource(pluginId);
      if (!stillUs()) return;
      if (source === null) {
        modules.set(pluginId, { status: 'error', reason: 'shape plugin source not available' });
        return;
      }
      let mod: unknown;
      try {
        mod = await importer(source);
      } catch (err) {
        if (!stillUs()) return;
        modules.set(pluginId, {
          status: 'error',
          reason: `shape plugin import failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      if (!stillUs()) return;
      const reason = validateShapePluginModule(mod);
      if (reason !== null) {
        modules.set(pluginId, { status: 'error', reason });
        return;
      }
      modules.set(pluginId, { status: 'ready', module: mod as ShapePluginModule });
    })();
    loadingEntry = { status: 'loading', promise };
    modules.set(pluginId, loadingEntry);
    return promise;
  };

  // Wire cache invalidation (#269). The broadcast fires on every plugin import
  // and uninstall regardless of kind; this loader only owns the shape kind, so
  // the handler filters before clearing. No unsubscribe is kept: the loader
  // lives for the process lifetime, so the leak isn't observable.
  if (subscribePluginInvalidated) {
    subscribePluginInvalidated((payload) => {
      if (payload.kind === 'shape') clear(payload.pluginId);
    });
  }

  return {
    ensureLoaded,
    get: (pluginId) => {
      const entry = modules.get(pluginId);
      return entry?.status === 'ready' ? entry.module : null;
    },
    clear,
    _setImporterForTests: (next) => {
      importer = next ?? defaultDataUrlImporter;
    },
  };
}
