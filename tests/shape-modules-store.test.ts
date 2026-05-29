// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PluginInvalidatedPayload } from '../src/shared/ipc';
import { _setShapeImporterForTests, useShapeModules } from '../src/editor/state/shape-modules';
import { createShapeModulesStore } from '../src/renderer/state/shape-modules-factory';

/**
 * Renderer-side shape-module store (#107 PR2): pulls a shape plugin's
 * source via window.editor.getShapeSource, dynamic-imports it via a
 * Blob URL, validates the result against the ShapePluginModule contract,
 * caches per pluginId. Tests stub both the IPC and the importer so the
 * load + cache + dedup logic runs without Chromium's Blob-URL import
 * path (which doesn't exist in the node test environment).
 */
describe('useShapeModules', () => {
  let getShapeSource: ReturnType<typeof vi.fn>;
  let imports: number;
  let importer: (source: string) => Promise<unknown>;

  beforeEach(() => {
    getShapeSource = vi.fn(() => Promise.resolve('export const layout = ...'));
    vi.stubGlobal('window', { editor: { getShapeSource } });

    imports = 0;
    // Default importer for tests: returns a valid ShapePluginModule shape
    // so the store reaches the ready state without a real ESM import.
    importer = vi.fn(async (_source: string) => {
      imports += 1;
      return {
        layout: () => ({ nodes: [], labels: [] }),
        hitTest: () => null,
      };
    });
    _setShapeImporterForTests(importer);

    // Reset the store between tests so stale modules from an earlier
    // case don't bleed in.
    useShapeModules.setState({ modules: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _setShapeImporterForTests(null);
  });

  it('loads a plugin source, imports it, and validates the module', async () => {
    const { ensureLoaded } = useShapeModules.getState();
    await ensureLoaded('org.example.planets');
    expect(getShapeSource).toHaveBeenCalledTimes(1);
    expect(getShapeSource).toHaveBeenCalledWith('org.example.planets');
    expect(imports).toBe(1);
    const mod = useShapeModules.getState().get('org.example.planets');
    expect(mod).not.toBeNull();
    expect(typeof mod?.layout).toBe('function');
    expect(typeof mod?.hitTest).toBe('function');
  });

  it('coalesces concurrent ensureLoaded calls for one pluginId into a single IPC + import', async () => {
    // Three components mounting in the same tick must not each fire their
    // own IPC pull + dynamic import; the first wins the slot and the rest
    // await the same promise.
    const { ensureLoaded } = useShapeModules.getState();
    await Promise.all([
      ensureLoaded('org.example.planets'),
      ensureLoaded('org.example.planets'),
      ensureLoaded('org.example.planets'),
    ]);
    expect(getShapeSource).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
  });

  it('does not re-import on a subsequent ensureLoaded after a successful load', async () => {
    const { ensureLoaded } = useShapeModules.getState();
    await ensureLoaded('org.example.planets');
    await ensureLoaded('org.example.planets');
    expect(getShapeSource).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
  });

  it('records null source as an error state without retrying on its own', async () => {
    // Main returns null when the plugin can't be read (not found, wrong
    // kind, IO error). The store records an error entry; a future
    // ensureLoaded won't auto-retry, which avoids hammering an
    // unreachable file. `clear` is the path back to "never asked".
    getShapeSource.mockResolvedValueOnce(null);
    const { ensureLoaded } = useShapeModules.getState();
    await ensureLoaded('org.example.missing');
    expect(useShapeModules.getState().modules['org.example.missing']?.status).toBe('error');
    await ensureLoaded('org.example.missing');
    expect(getShapeSource).toHaveBeenCalledTimes(1);
  });

  it('records a rejected importer as an error (e.g. syntax error in plugin source)', async () => {
    importer = vi.fn(async (_source: string) => {
      throw new SyntaxError('unexpected token');
    });
    _setShapeImporterForTests(importer);
    const { ensureLoaded } = useShapeModules.getState();
    await ensureLoaded('org.example.broken');
    const entry = useShapeModules.getState().modules['org.example.broken'];
    expect(entry?.status).toBe('error');
    if (entry?.status === 'error') {
      expect(entry.reason).toMatch(/import failed/);
      expect(entry.reason).toMatch(/unexpected token/);
    }
  });

  it('records a module without the contract functions as an error (validator catches it)', async () => {
    importer = vi.fn(async (_source: string) => ({ notLayout: 1 }));
    _setShapeImporterForTests(importer);
    const { ensureLoaded } = useShapeModules.getState();
    await ensureLoaded('org.example.badcontract');
    const entry = useShapeModules.getState().modules['org.example.badcontract'];
    expect(entry?.status).toBe('error');
    if (entry?.status === 'error') {
      expect(entry.reason).toMatch(/`layout`/);
    }
  });

  it('clear drops a cached entry so a later ensureLoaded retries', async () => {
    // The plugin manager calls clear on uninstall (PR3) so a re-import
    // picks up the new source. Verify the retry actually pulls again.
    const { ensureLoaded, clear } = useShapeModules.getState();
    await ensureLoaded('org.example.planets');
    expect(getShapeSource).toHaveBeenCalledTimes(1);
    clear('org.example.planets');
    expect(useShapeModules.getState().modules['org.example.planets']).toBeUndefined();
    await ensureLoaded('org.example.planets');
    expect(getShapeSource).toHaveBeenCalledTimes(2);
  });

  it('get returns null while still loading and until the module is ready', async () => {
    let pendingResolve: ((m: unknown) => void) | null = null;
    importer = vi.fn(
      () =>
        new Promise((res) => {
          pendingResolve = res;
        }),
    );
    _setShapeImporterForTests(importer);
    const { ensureLoaded, get } = useShapeModules.getState();
    const pending = ensureLoaded('org.example.slow');
    // Wait for the IIFE to advance past `await getShapeSource(...)` and
    // invoke the importer, so `pendingResolve` is the real resolver
    // (not the outer closure's null). Without this drain, calling the
    // resolver below would land on `null` and the test would deadlock.
    await vi.waitFor(() => {
      if (pendingResolve === null) throw new Error('importer not yet invoked');
    });
    // Still loading until the importer's promise resolves.
    expect(get('org.example.slow')).toBeNull();
    expect(useShapeModules.getState().modules['org.example.slow']?.status).toBe('loading');
    pendingResolve!({ layout: () => ({}), hitTest: () => null });
    await pending;
    expect(get('org.example.slow')).not.toBeNull();
  });
});

describe('createShapeModulesStore: plugin invalidation (#269)', () => {
  // The wrapper modules (editor + renderer) subscribe at construction by
  // passing a real bridge call through; here we exercise the factory
  // directly with a stub subscribe so we can capture and fire the
  // invalidation handler without an Electron bridge or a renderer window.

  function buildStore() {
    let captured: ((payload: PluginInvalidatedPayload) => void) | null = null;
    const store = createShapeModulesStore(
      () => Promise.resolve('export const layout = ...'),
      (handler) => {
        captured = handler;
        return () => {};
      },
    );
    store._setShapeImporterForTests(async () => ({
      layout: () => ({ nodes: [], labels: [] }),
      hitTest: () => null,
    }));
    return { store, fire: (p: PluginInvalidatedPayload) => captured?.(p) };
  }

  it('drops the cached entry when a shape plugin is invalidated', async () => {
    // Mirrors the real flow: a shape plugin loads (planets), then main
    // broadcasts that planets was uninstalled or re-imported, and the
    // store invalidates its cache so the next ensureLoaded refetches.
    const { store, fire } = buildStore();
    const { ensureLoaded } = store.useShapeModules.getState();
    await ensureLoaded('org.example.planets');
    expect(store.useShapeModules.getState().modules['org.example.planets']?.status).toBe('ready');

    fire({ pluginId: 'org.example.planets', kind: 'shape' });

    expect(store.useShapeModules.getState().modules['org.example.planets']).toBeUndefined();
  });

  it('ignores invalidations for non-shape kinds', async () => {
    // Each renderer-side cache owns one kind; a function-plugin uninstall
    // shouldn't reach into the shape store and clear unrelated state.
    const { store, fire } = buildStore();
    const { ensureLoaded } = store.useShapeModules.getState();
    await ensureLoaded('org.example.planets');

    fire({ pluginId: 'org.example.planets', kind: 'function' });
    fire({ pluginId: 'org.example.planets', kind: 'theme' });
    fire({ pluginId: 'org.example.planets', kind: 'nav-style' });

    expect(store.useShapeModules.getState().modules['org.example.planets']?.status).toBe('ready');
  });

  it('is a no-op for plugin ids that were never loaded', async () => {
    // Renderer subscribes broadly (main broadcasts on every plugin
    // import + uninstall); ids the store never cached must not flip a
    // status or otherwise materialise an entry.
    const { store, fire } = buildStore();

    fire({ pluginId: 'org.example.unknown', kind: 'shape' });

    expect(store.useShapeModules.getState().modules['org.example.unknown']).toBeUndefined();
  });

  it('drops the load result when clear runs before the in-flight import completes', async () => {
    // Race scenario: ensureLoaded fired, the IPC + import are mid-flight,
    // an invalidation arrives and clears the entry, and then the
    // importer resolves with the old source. The post-resolve set must
    // detect that the loading entry it created is no longer current and
    // drop its result instead of re-cacheing the stale module.
    let resolveImporter: ((m: unknown) => void) | null = null;
    const store = createShapeModulesStore(
      () => Promise.resolve('export const layout = ...'),
      () => () => {},
    );
    store._setShapeImporterForTests(
      () =>
        new Promise((res) => {
          resolveImporter = res;
        }),
    );

    const { ensureLoaded, clear } = store.useShapeModules.getState();
    const pending = ensureLoaded('org.example.planets');
    // Drain to the importer await so `resolveImporter` is the real one,
    // mirroring the existing "get returns null while still loading" test.
    await vi.waitFor(() => {
      if (resolveImporter === null) throw new Error('importer not yet invoked');
    });
    expect(store.useShapeModules.getState().modules['org.example.planets']?.status).toBe('loading');

    clear('org.example.planets');
    expect(store.useShapeModules.getState().modules['org.example.planets']).toBeUndefined();

    resolveImporter!({ layout: () => ({ nodes: [], labels: [] }), hitTest: () => null });
    await pending;

    // No stale module wrote back over the cleared entry.
    expect(store.useShapeModules.getState().modules['org.example.planets']).toBeUndefined();
  });
});
