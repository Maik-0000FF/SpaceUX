// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, type MenuConfig } from '@/shared/menu';

import { useAppState } from '../src/editor/state/app-state';
import { useMenuSettings } from '../src/editor/state/menu-settings';
import { isSelected, sectorAtPath } from '../src/editor/state/selectors';

// The editor's selection store and path resolver are pure logic, so
// they're exercised here without a DOM — the components that consume
// them stay verified by the manual Electron smoke test.

describe('app-state selection', () => {
  beforeEach(() => {
    useAppState.getState().clearSelection();
  });

  it('starts with no selection', () => {
    expect(useAppState.getState().selectedPath).toEqual([]);
  });

  it('selectSector replaces the path and stores a copy', () => {
    const input = [2];
    useAppState.getState().selectSector(input);
    expect(useAppState.getState().selectedPath).toEqual([2]);
    // Mutating the caller's array must not leak into the store.
    input.push(9);
    expect(useAppState.getState().selectedPath).toEqual([2]);
  });

  it('clearSelection resets to empty', () => {
    useAppState.getState().selectSector([1]);
    useAppState.getState().clearSelection();
    expect(useAppState.getState().selectedPath).toEqual([]);
  });
});

describe('sectorAtPath', () => {
  const nested: MenuConfig = {
    version: DEFAULT_MENU_CONFIG.version,
    sectors: [
      { label: 'Leaf', binding: { action: 'x/y' } },
      {
        label: 'Branch',
        children: [
          { label: 'Child0', binding: { action: 'a/b' } },
          { label: 'Child1', binding: { action: 'c/d' } },
        ],
      },
    ],
  };

  it('returns null for an empty path', () => {
    expect(sectorAtPath(nested, [])).toBeNull();
  });

  it('resolves a top-level sector', () => {
    expect(sectorAtPath(nested, [0])?.label).toBe('Leaf');
    expect(sectorAtPath(nested, [1])?.label).toBe('Branch');
  });

  it('resolves a nested child', () => {
    expect(sectorAtPath(nested, [1, 1])?.label).toBe('Child1');
  });

  it('returns null for an out-of-range index', () => {
    expect(sectorAtPath(nested, [9])).toBeNull();
  });
});

describe('isSelected', () => {
  it('matches a single-element path at the given index', () => {
    expect(isSelected([2], 2)).toBe(true);
    expect(isSelected([2], 1)).toBe(false);
  });

  it('is false for empty and multi-element paths', () => {
    expect(isSelected([], 0)).toBe(false);
    expect(isSelected([1, 0], 1)).toBe(false);
  });
});

describe('menu-settings', () => {
  it('setConfig adopts the snapshot as a clean remote change', () => {
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 123 });
    const state = useMenuSettings.getState();
    expect(state.config).toEqual(DEFAULT_MENU_CONFIG);
    expect(state.mtime).toBe(123);
    // Remote origin so the write-back subscription won't echo it to disk;
    // clean (not dirty) and no conflict after adopting.
    expect(state.origin).toBe('remote');
    expect(state.dirty).toBe(false);
    expect(state.conflict).toBeNull();
  });

  it('updateSectorAt edits in place and flags the change local + dirty', () => {
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 1 });
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = 'Renamed';
    });
    const state = useMenuSettings.getState();
    expect(state.config?.sectors[0]?.label).toBe('Renamed');
    expect(state.origin).toBe('local');
    expect(state.dirty).toBe(true);
    // Immutable update — the shipped default constant is untouched.
    expect(DEFAULT_MENU_CONFIG.sectors[0]?.label).not.toBe('Renamed');
  });

  it('setConfig bumps remoteRev (so derived editors remount), markSaved does not', () => {
    const before = useMenuSettings.getState().remoteRev;
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 1 });
    const afterAdopt = useMenuSettings.getState().remoteRev;
    expect(afterAdopt).toBe(before + 1);
    // A local edit + save must NOT bump it (avoids remount mid-typing).
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = 'Y';
    });
    useMenuSettings.getState().markSaved(2);
    expect(useMenuSettings.getState().remoteRev).toBe(afterAdopt);
  });

  it('markSaved clears dirty and updates the mtime baseline', () => {
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 1 });
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = 'X';
    });
    expect(useMenuSettings.getState().dirty).toBe(true);
    useMenuSettings.getState().markSaved(999);
    const state = useMenuSettings.getState();
    expect(state.dirty).toBe(false);
    expect(state.mtime).toBe(999);
  });

  it('setConflict stashes the external snapshot; clearConflict / setConfig clear it', () => {
    const external = { config: DEFAULT_MENU_CONFIG, mtime: 555 };
    useMenuSettings.getState().setConflict(external);
    expect(useMenuSettings.getState().conflict).toEqual(external);
    useMenuSettings.getState().clearConflict();
    expect(useMenuSettings.getState().conflict).toBeNull();
    // Adopting a snapshot also clears any conflict + dirty.
    useMenuSettings.getState().setConflict(external);
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 7 });
    expect(useMenuSettings.getState().conflict).toBeNull();
    expect(useMenuSettings.getState().dirty).toBe(false);
  });
});
