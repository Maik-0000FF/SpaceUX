// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PluginInvalidatedPayload } from '../src/shared/ipc';
import { createMainShapeModuleLoader } from '../src/main/shape-modules';

/**
 * Main-process shape-module loader (#325 PR1): the native overlay runs in
 * main, so main pulls a shape plugin's source (off disk via the cached
 * manifest map, wired in a later PR), dynamic-imports it via a Node data:
 * URL, validates the result against the ShapePluginModule contract, and
 * caches per pluginId. Mirrors the renderer store's behaviour; these tests
 * mirror tests/shape-modules-store.test.ts, stubbing the source pull and the
 * importer so the load + cache + coalesce + invalidation logic runs without a
 * real ESM import.
 */
describe('createMainShapeModuleLoader', () => {
  let getSource: ReturnType<typeof vi.fn>;
  let imports: number;
  let importer: (source: string) => Promise<unknown>;
  let loader: ReturnType<typeof createMainShapeModuleLoader>;

  beforeEach(() => {
    getSource = vi.fn(() => Promise.resolve('export const layout = ...'));
    imports = 0;
    importer = vi.fn(async (_source: string) => {
      imports += 1;
      return {
        layout: () => ({ nodes: [], labels: [] }),
        hitTest: () => null,
      };
    });
    loader = createMainShapeModuleLoader((pluginId) => getSource(pluginId));
    loader._setImporterForTests(importer);
  });

  afterEach(() => {
    loader._setImporterForTests(null);
  });

  it('loads a plugin source, imports it, and validates the module', async () => {
    await loader.ensureLoaded('org.example.planets');
    expect(getSource).toHaveBeenCalledTimes(1);
    expect(getSource).toHaveBeenCalledWith('org.example.planets');
    expect(imports).toBe(1);
    const mod = loader.get('org.example.planets');
    expect(mod).not.toBeNull();
    expect(typeof mod?.layout).toBe('function');
    expect(typeof mod?.hitTest).toBe('function');
  });

  it('coalesces concurrent ensureLoaded calls for one pluginId into a single read + import', async () => {
    await Promise.all([
      loader.ensureLoaded('org.example.planets'),
      loader.ensureLoaded('org.example.planets'),
      loader.ensureLoaded('org.example.planets'),
    ]);
    expect(getSource).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
  });

  it('does not re-import on a subsequent ensureLoaded after a successful load', async () => {
    await loader.ensureLoaded('org.example.planets');
    await loader.ensureLoaded('org.example.planets');
    expect(getSource).toHaveBeenCalledTimes(1);
    expect(imports).toBe(1);
  });

  it('records null source as an error state without retrying on its own', async () => {
    getSource.mockResolvedValueOnce(null);
    await loader.ensureLoaded('org.example.missing');
    expect(loader.get('org.example.missing')).toBeNull();
    await loader.ensureLoaded('org.example.missing');
    expect(getSource).toHaveBeenCalledTimes(1);
  });

  it('records a rejected importer as an error (e.g. syntax error in plugin source)', async () => {
    loader._setImporterForTests(async () => {
      throw new SyntaxError('unexpected token');
    });
    await loader.ensureLoaded('org.example.broken');
    expect(loader.get('org.example.broken')).toBeNull();
    // A subsequent load must not retry: the error is cached.
    await loader.ensureLoaded('org.example.broken');
    expect(getSource).toHaveBeenCalledTimes(1);
  });

  it('records a module without the contract functions as an error (validator catches it)', async () => {
    loader._setImporterForTests(async () => ({ notLayout: 1 }));
    await loader.ensureLoaded('org.example.badcontract');
    expect(loader.get('org.example.badcontract')).toBeNull();
    // Cached as error: no auto-retry.
    await loader.ensureLoaded('org.example.badcontract');
    expect(getSource).toHaveBeenCalledTimes(1);
  });

  it('clear drops a cached entry so a later ensureLoaded retries', async () => {
    await loader.ensureLoaded('org.example.planets');
    expect(getSource).toHaveBeenCalledTimes(1);
    loader.clear('org.example.planets');
    expect(loader.get('org.example.planets')).toBeNull();
    await loader.ensureLoaded('org.example.planets');
    expect(getSource).toHaveBeenCalledTimes(2);
  });

  it('get returns null while still loading and until the module is ready', async () => {
    let pendingResolve: ((m: unknown) => void) | null = null;
    loader._setImporterForTests(
      () =>
        new Promise((res) => {
          pendingResolve = res;
        }),
    );
    const pending = loader.ensureLoaded('org.example.slow');
    // Drain past `await getSource(...)` so `pendingResolve` is the real
    // resolver (not the outer closure's null); without this the resolve
    // below would land on null and deadlock the test.
    await vi.waitFor(() => {
      if (pendingResolve === null) throw new Error('importer not yet invoked');
    });
    expect(loader.get('org.example.slow')).toBeNull();
    pendingResolve!({ layout: () => ({}), hitTest: () => null });
    await pending;
    expect(loader.get('org.example.slow')).not.toBeNull();
  });
});

describe('createMainShapeModuleLoader: default data:-URL importer round-trip', () => {
  // The default importer is the one piece of net-new logic vs the renderer
  // factory (data:-URL import in place of the Blob URL); the cases above all
  // inject a fake, so this drives a real source string through the unstubbed
  // path to prove the base64 round-trip imports + validates end to end.
  it('imports + validates a real ES-module source with no stub', async () => {
    const source = [
      'export function layout(sectorCount){',
      '  return { nodes: Array.from({ length: sectorCount }, (_, i) => ({ cx: i, cy: 0, r: 1 })),',
      '           labels: Array.from({ length: sectorCount }, (_, i) => ({ x: i, y: 0, anchor: "middle" })) };',
      '}',
      'export function hitTest(){ return 0; }',
    ].join('\n');
    const loader = createMainShapeModuleLoader(() => Promise.resolve(source));

    await loader.ensureLoaded('org.example.real');

    const mod = loader.get('org.example.real');
    expect(mod).not.toBeNull();
    expect(typeof mod?.layout).toBe('function');
    expect(typeof mod?.hitTest).toBe('function');
    // Call through to confirm the imported functions actually run.
    expect(mod?.layout(2, {} as never, 'inner')).toEqual({
      nodes: [
        { cx: 0, cy: 0, r: 1 },
        { cx: 1, cy: 0, r: 1 },
      ],
      labels: [
        { x: 0, y: 0, anchor: 'middle' },
        { x: 1, y: 0, anchor: 'middle' },
      ],
    });
    expect(mod?.hitTest({} as never, {} as never, { nodes: [], labels: [] })).toBe(0);
  });

  it('caches a real import as an error when the source omits the contract functions', async () => {
    const loader = createMainShapeModuleLoader(() => Promise.resolve('export const nope = 1;'));
    await loader.ensureLoaded('org.example.realbad');
    expect(loader.get('org.example.realbad')).toBeNull();
  });
});

describe('createMainShapeModuleLoader: plugin invalidation (#269)', () => {
  function buildLoader() {
    let captured: ((payload: PluginInvalidatedPayload) => void) | null = null;
    const loader = createMainShapeModuleLoader(
      () => Promise.resolve('export const layout = ...'),
      (handler) => {
        captured = handler;
        return () => {};
      },
    );
    loader._setImporterForTests(async () => ({
      layout: () => ({ nodes: [], labels: [] }),
      hitTest: () => null,
    }));
    return { loader, fire: (p: PluginInvalidatedPayload) => captured?.(p) };
  }

  it('drops the cached entry when a shape plugin is invalidated', async () => {
    const { loader, fire } = buildLoader();
    await loader.ensureLoaded('org.example.planets');
    expect(loader.get('org.example.planets')).not.toBeNull();

    fire({ pluginId: 'org.example.planets', kind: 'shape' });

    expect(loader.get('org.example.planets')).toBeNull();
  });

  it('ignores invalidations for non-shape kinds', async () => {
    const { loader, fire } = buildLoader();
    await loader.ensureLoaded('org.example.planets');

    fire({ pluginId: 'org.example.planets', kind: 'function' });
    fire({ pluginId: 'org.example.planets', kind: 'theme' });
    fire({ pluginId: 'org.example.planets', kind: 'nav-style' });

    expect(loader.get('org.example.planets')).not.toBeNull();
  });

  it('is a no-op for plugin ids that were never loaded', async () => {
    const { loader, fire } = buildLoader();

    fire({ pluginId: 'org.example.unknown', kind: 'shape' });

    expect(loader.get('org.example.unknown')).toBeNull();
  });

  it('drops the load result when clear runs before the in-flight import completes', async () => {
    let resolveImporter: ((m: unknown) => void) | null = null;
    const loader = createMainShapeModuleLoader(() => Promise.resolve('export const layout = ...'));
    loader._setImporterForTests(
      () =>
        new Promise((res) => {
          resolveImporter = res;
        }),
    );

    const pending = loader.ensureLoaded('org.example.planets');
    await vi.waitFor(() => {
      if (resolveImporter === null) throw new Error('importer not yet invoked');
    });

    loader.clear('org.example.planets');
    expect(loader.get('org.example.planets')).toBeNull();

    resolveImporter!({ layout: () => ({ nodes: [], labels: [] }), hitTest: () => null });
    await pending;

    // No stale module wrote back over the cleared entry.
    expect(loader.get('org.example.planets')).toBeNull();
  });
});
