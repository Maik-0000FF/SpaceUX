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

describe('menu-settings undo/redo (zundo temporal)', () => {
  const labelAt0 = () => useMenuSettings.getState().config?.sectors[0]?.label;

  it('steps through config edits with undo and redo', () => {
    const original = DEFAULT_MENU_CONFIG.sectors[0]?.label;
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 1 });
    // Only edits made after this baseline should be undoable.
    useMenuSettings.temporal.getState().clear();

    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = 'A';
    });
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = 'B';
    });
    expect(labelAt0()).toBe('B');

    useMenuSettings.temporal.getState().undo();
    expect(labelAt0()).toBe('A');
    useMenuSettings.temporal.getState().undo();
    expect(labelAt0()).toBe(original);

    useMenuSettings.temporal.getState().redo();
    expect(labelAt0()).toBe('A');
  });

  it('does not record a no-op edit (deep equality)', () => {
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 1 });
    useMenuSettings.temporal.getState().clear();
    const before = useMenuSettings.temporal.getState().pastStates.length;
    // Set the label to the value it already has → no state change.
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.label = DEFAULT_MENU_CONFIG.sectors[0]!.label;
    });
    expect(useMenuSettings.temporal.getState().pastStates.length).toBe(before);
  });
});

describe('menu-settings CRUD', () => {
  const load = (sectors: { label: string; binding?: { action: string } }[]) =>
    useMenuSettings.getState().setConfig({
      config: { version: DEFAULT_MENU_CONFIG.version, sectors },
      mtime: 1,
    });

  it('addSector appends a default leaf and flags local/dirty', () => {
    load([{ label: 'A' }]);
    useMenuSettings.getState().addSector();
    const state = useMenuSettings.getState();
    expect(state.config?.sectors.map((s) => s.label)).toEqual(['A', 'New item']);
    expect(state.origin).toBe('local');
    expect(state.dirty).toBe(true);
  });

  it('deleteSector removes a sector but refuses to empty the menu', () => {
    load([{ label: 'A' }, { label: 'B' }]);
    useMenuSettings.getState().deleteSector(0);
    expect(useMenuSettings.getState().config?.sectors.map((s) => s.label)).toEqual(['B']);
    // The last remaining sector can't be deleted (validator needs ≥1).
    useMenuSettings.getState().deleteSector(0);
    expect(useMenuSettings.getState().config?.sectors.map((s) => s.label)).toEqual(['B']);
  });

  it('moveSector reorders so the item ends at the target index', () => {
    load([{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }]);
    useMenuSettings.getState().moveSector(0, 2);
    expect(useMenuSettings.getState().config?.sectors.map((s) => s.label)).toEqual([
      'B',
      'C',
      'A',
      'D',
    ]);
  });

  it('leaf↔branch conversion drops the mutually-exclusive field', () => {
    load([{ label: 'X', binding: { action: 'p/a' } }]);
    // action → submenu: seed a child, drop the binding.
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      s.children = [{ label: 'New item' }];
      delete s.binding;
    });
    let sector = useMenuSettings.getState().config?.sectors[0];
    expect(sector?.binding).toBeUndefined();
    expect(sector?.children?.length).toBe(1);
    // submenu → action: drop the children.
    useMenuSettings.getState().updateSectorAt([0], (s) => {
      delete s.children;
    });
    sector = useMenuSettings.getState().config?.sectors[0];
    expect(sector?.children).toBeUndefined();
  });
});
