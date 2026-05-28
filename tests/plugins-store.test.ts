// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePluginsState } from '../src/editor/state/plugins';

/**
 * Unit-tests the editor-side plugins zustand store (#195): the coalescing
 * promise, the rejection-tolerant retry, and the `applySnapshot` replace.
 * The store calls `window.editor.getPlugins`, which doesn't exist under the
 * node test environment, so each test stubs `globalThis.window` to a spy
 * and asserts how often it's called.
 */
describe('usePluginsState', () => {
  let getPlugins: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getPlugins = vi.fn(() => Promise.resolve({ plugins: [], errors: [] }));
    vi.stubGlobal('window', { editor: { getPlugins } });
    // Reset the store between tests so neither `loaded` nor an in-flight
    // `pending` from an earlier case bleeds into this one.
    usePluginsState.setState({ plugins: [], errors: [], loaded: false, pending: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces concurrent ensureLoaded calls into one IPC pull', async () => {
    // Three components calling ensureLoaded on the same mount tick must not
    // fan out into three IPC round-trips: the first wins the inflight slot
    // and the others wait on it.
    const { ensureLoaded } = usePluginsState.getState();
    await Promise.all([ensureLoaded(), ensureLoaded(), ensureLoaded()]);
    expect(getPlugins).toHaveBeenCalledTimes(1);
    expect(usePluginsState.getState().loaded).toBe(true);
  });

  it('is idempotent after a successful load (no re-pull)', async () => {
    // Once loaded, a remount / second caller is a no-op: the store still
    // has the snapshot, so the IPC stays untouched.
    const { ensureLoaded } = usePluginsState.getState();
    await ensureLoaded();
    await ensureLoaded();
    expect(getPlugins).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded false on rejection so the next call retries', async () => {
    // The first attempt fails; the store stays unloaded so a subsequent
    // mount / retry can recover, matching the comment "a failed pull
    // shouldn't blank the list" and the sibling useCatalog's behaviour.
    getPlugins.mockRejectedValueOnce(new Error('boom'));
    const { ensureLoaded } = usePluginsState.getState();
    await ensureLoaded();
    expect(usePluginsState.getState().loaded).toBe(false);
    await ensureLoaded();
    expect(getPlugins).toHaveBeenCalledTimes(2);
    expect(usePluginsState.getState().loaded).toBe(true);
  });

  it('applySnapshot during an in-flight ensureLoaded wins (stale-write guard)', async () => {
    // Race: ensureLoaded fires an IPC pull; before it resolves, a Plugin
    // Manager import calls applySnapshot with the fresh post-import state.
    // The in-flight pull then resolves with the pre-import data; without
    // the guard it would overwrite the fresher snapshot.
    let resolveGet: (v: { plugins: never[]; errors: never[] }) => void = () => {};
    getPlugins.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveGet = res;
        }),
    );
    const ensure = usePluginsState.getState().ensureLoaded();
    // While the pull is in flight, an import lands a snapshot of its own.
    usePluginsState.getState().applySnapshot({
      plugins: [
        {
          id: 'org.example.imported',
          name: 'Imported',
          version: '1.0.0',
          kind: 'function',
          dir: '/fake/imported',
          removable: true,
          actionCount: 2,
          hasCatalog: false,
        },
      ],
      errors: [],
    });
    // Now the pre-import IPC pull settles. The guard must drop the result.
    resolveGet({ plugins: [], errors: [] });
    await ensure;
    expect(usePluginsState.getState().plugins).toHaveLength(1);
    expect(usePluginsState.getState().plugins[0]?.id).toBe('org.example.imported');
  });

  it('applySnapshot replaces the contents and marks loaded', async () => {
    // The Plugin Manager calls this after a successful import / uninstall
    // so other readers re-render with the fresh main-returned state, no
    // extra IPC pull needed.
    usePluginsState.getState().applySnapshot({
      plugins: [
        {
          id: 'org.example.x',
          name: 'Example',
          version: '0.0.1',
          kind: 'function',
          dir: '/fake/dir',
          removable: true,
          actionCount: 1,
          hasCatalog: false,
        },
      ],
      errors: [{ dir: '/fake/bad', reason: 'malformed' }],
    });
    const s = usePluginsState.getState();
    expect(s.plugins).toHaveLength(1);
    expect(s.plugins[0]?.id).toBe('org.example.x');
    expect(s.errors).toHaveLength(1);
    expect(s.loaded).toBe(true);
  });
});
