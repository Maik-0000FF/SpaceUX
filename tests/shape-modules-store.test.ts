// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setShapeImporterForTests, useShapeModules } from '../src/editor/state/shape-modules';

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
