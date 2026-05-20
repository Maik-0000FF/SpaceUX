// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, type MenuConfig, type MenuSector } from '@/shared/menu';

import { useAppState } from '../src/editor/state/app-state';
import { useMenuSettings } from '../src/editor/state/menu-settings';
import { pathOfSectorId } from '../src/editor/state/move-targets';
import { ringSectors, sectorAtPath, selectedPath } from '../src/editor/state/selectors';

// The editor's selection store and path resolver are pure logic, so
// they're exercised here without a DOM — the components that consume
// them stay verified by the manual Electron smoke test.

// The store stamps editor-only `id`s onto adopted sectors; strip them to
// compare against the (id-less) source config.
function stripIds(config: MenuConfig): MenuConfig {
  const strip = (s: MenuSector): MenuSector => {
    const { id: _id, children, ...rest } = s;
    return children ? { ...rest, children: children.map(strip) } : rest;
  };
  return { ...config, sectors: config.sectors.map(strip) };
}

describe('app-state navigation', () => {
  beforeEach(() => {
    useAppState.getState().drillTo(0); // reset viewPath + selection
  });

  it('starts at the top level with no selection', () => {
    expect(useAppState.getState().viewPath).toEqual([]);
    expect(useAppState.getState().selectedIndex).toBeNull();
  });

  it('selectSector sets the in-ring index; clearSelection resets it', () => {
    useAppState.getState().selectSector(2);
    expect(useAppState.getState().selectedIndex).toBe(2);
    useAppState.getState().clearSelection();
    expect(useAppState.getState().selectedIndex).toBeNull();
  });

  it('drillInto descends and clears selection; drillTo pops back', () => {
    useAppState.getState().selectSector(1);
    useAppState.getState().drillInto(1);
    expect(useAppState.getState().viewPath).toEqual([1]);
    expect(useAppState.getState().selectedIndex).toBeNull();

    useAppState.getState().drillInto(0);
    expect(useAppState.getState().viewPath).toEqual([1, 0]);

    useAppState.getState().drillTo(1);
    expect(useAppState.getState().viewPath).toEqual([1]);
    useAppState.getState().drillTo(0);
    expect(useAppState.getState().viewPath).toEqual([]);
  });

  it('selectPath jumps to any depth: parent ring becomes the view, last segment the selection', () => {
    useAppState.getState().selectPath([2, 1, 0]);
    expect(useAppState.getState().viewPath).toEqual([2, 1]);
    expect(useAppState.getState().selectedIndex).toBe(0);

    useAppState.getState().selectPath([3]);
    expect(useAppState.getState().viewPath).toEqual([]);
    expect(useAppState.getState().selectedIndex).toBe(3);

    useAppState.getState().selectPath([]);
    expect(useAppState.getState().selectedIndex).toBeNull();
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

  it('returns null for a stale parent segment (no fallback to root)', () => {
    expect(sectorAtPath(nested, [0, 0])).toBeNull(); // [0] is a leaf
    expect(sectorAtPath(nested, [9, 0])).toBeNull(); // [9] does not exist
  });
});

describe('selectedPath', () => {
  it('combines the view path with the selected index, or null', () => {
    expect(selectedPath([], null)).toBeNull();
    expect(selectedPath([], 2)).toEqual([2]);
    expect(selectedPath([1], 0)).toEqual([1, 0]);
  });
});

describe('ringSectors', () => {
  const cfg: MenuConfig = {
    version: DEFAULT_MENU_CONFIG.version,
    sectors: [{ label: 'Leaf' }, { label: 'Branch', children: [{ label: 'C0' }, { label: 'C1' }] }],
  };

  it('returns the top-level ring for an empty view path', () => {
    expect(ringSectors(cfg, []).map((s) => s.label)).toEqual(['Leaf', 'Branch']);
  });

  it('returns a submenu ring for a drilled-in path', () => {
    expect(ringSectors(cfg, [1]).map((s) => s.label)).toEqual(['C0', 'C1']);
  });
});

describe('menu-settings', () => {
  it('setConfig adopts the snapshot as a clean remote change', () => {
    useMenuSettings.getState().setConfig({ config: DEFAULT_MENU_CONFIG, mtime: 123 });
    const state = useMenuSettings.getState();
    expect(stripIds(state.config!)).toEqual(DEFAULT_MENU_CONFIG);
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

  it('addSector appends a default leaf to the top-level ring', () => {
    load([{ label: 'A' }]);
    useMenuSettings.getState().addSector([]);
    const state = useMenuSettings.getState();
    expect(state.config?.sectors.map((s) => s.label)).toEqual(['A', 'New item']);
    expect(state.origin).toBe('local');
    expect(state.dirty).toBe(true);
  });

  it('setScale clamps to [0.5, 2] and flags the change local + dirty', () => {
    load([{ label: 'A' }]);
    useMenuSettings.getState().setScale(1.5);
    expect(useMenuSettings.getState().config?.scale).toBe(1.5);
    expect(useMenuSettings.getState().dirty).toBe(true);
    expect(useMenuSettings.getState().origin).toBe('local');
    useMenuSettings.getState().setScale(99);
    expect(useMenuSettings.getState().config?.scale).toBe(2);
    useMenuSettings.getState().setScale(0.1);
    expect(useMenuSettings.getState().config?.scale).toBe(0.5);
  });

  it('addSector targets a submenu ring by path', () => {
    useMenuSettings.getState().setConfig({
      config: {
        version: DEFAULT_MENU_CONFIG.version,
        sectors: [{ label: 'Branch', children: [{ label: 'C0' }] }],
      },
      mtime: 1,
    });
    useMenuSettings.getState().addSector([0]); // into Branch's children
    expect(useMenuSettings.getState().config?.sectors[0]?.children?.map((s) => s.label)).toEqual([
      'C0',
      'New item',
    ]);
  });

  it('deleteSector removes within the ring but refuses to empty it', () => {
    load([{ label: 'A' }, { label: 'B' }]);
    useMenuSettings.getState().deleteSector([], 0);
    expect(useMenuSettings.getState().config?.sectors.map((s) => s.label)).toEqual(['B']);
    // The last remaining sector can't be deleted (validator needs ≥1).
    useMenuSettings.getState().deleteSector([], 0);
    expect(useMenuSettings.getState().config?.sectors.map((s) => s.label)).toEqual(['B']);
  });

  it('setTriggerButton sets the trigger and flags local/dirty', () => {
    load([{ label: 'A' }]);
    useMenuSettings.getState().setTriggerButton(2);
    const state = useMenuSettings.getState();
    expect(state.config?.triggerButton).toBe(2);
    expect(state.origin).toBe('local');
    expect(state.dirty).toBe(true);
  });

  it('moveSector reorders so the item ends at the target index', () => {
    load([{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }]);
    useMenuSettings.getState().moveSector([], 0, 2);
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

  it('CRUD are no-ops for invalid indices or a stale ring path', () => {
    load([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    const labels = () => useMenuSettings.getState().config?.sectors.map((s) => s.label);

    useMenuSettings.getState().moveSector([], 1, 1); // same index
    expect(labels()).toEqual(['A', 'B', 'C']);
    useMenuSettings.getState().moveSector([], 0, 9); // target out of range
    expect(labels()).toEqual(['A', 'B', 'C']);
    useMenuSettings.getState().moveSector([], -1, 0); // source out of range
    expect(labels()).toEqual(['A', 'B', 'C']);
    useMenuSettings.getState().deleteSector([], 9); // out of range
    expect(labels()).toEqual(['A', 'B', 'C']);
    // Stale ring path: index 0 is a leaf, not a branch → no-op.
    useMenuSettings.getState().addSector([0]);
    expect(labels()).toEqual(['A', 'B', 'C']);
  });
});

describe('moveSectorBetween', () => {
  // A (leaf), B (branch) → [B0 (leaf), B1 (branch) → [B1a (leaf)]].
  const nested = (): MenuConfig => ({
    version: DEFAULT_MENU_CONFIG.version,
    sectors: [
      { label: 'A', binding: { action: 'p/a' } },
      {
        label: 'B',
        children: [
          { label: 'B0', binding: { action: 'p/a' } },
          { label: 'B1', children: [{ label: 'B1a', binding: { action: 'p/a' } }] },
        ],
      },
    ],
  });
  const ringLabels = (path: readonly number[]): string[] =>
    ringSectors(useMenuSettings.getState().config!, path).map((s) => s.label);

  beforeEach(() => useMenuSettings.getState().setConfig({ config: nested(), mtime: 1 }));

  it('moves a leaf into another ring (appended at the end)', () => {
    useMenuSettings.getState().moveSectorBetween([0], [1]); // A → B's children
    expect(ringLabels([])).toEqual(['B']);
    // A removed from root → B shifts to index 0; its children now hold A.
    expect(ringLabels([0])).toEqual(['B0', 'B1', 'A']);
  });

  it('re-locating the moved sector by id survives the index shift', () => {
    // The bug the "Move to…" picker hit: toRingPath ([1]) is stale after the
    // move (B shifts to root[0]). Looking the moved item up by its stable id
    // lands on the correct new path instead.
    const aId = sectorAtPath(useMenuSettings.getState().config!, [0])!.id!;
    useMenuSettings.getState().moveSectorBetween([0], [1]); // A → B's children
    const after = useMenuSettings.getState().config!;
    expect(pathOfSectorId(after, aId)).toEqual([0, 2]); // B is root[0]; A is its 3rd child
  });

  it('is a no-op for a cycle (target inside the moved subtree)', () => {
    useMenuSettings.getState().moveSectorBetween([1], [1, 1]); // B into its own descendant
    expect(ringLabels([])).toEqual(['A', 'B']);
    expect(ringLabels([1])).toEqual(['B0', 'B1']);
  });

  it('is a no-op for the same ring (that path is moveSector)', () => {
    useMenuSettings.getState().moveSectorBetween([1, 0], [1]);
    expect(ringLabels([1])).toEqual(['B0', 'B1']);
  });

  it("drops a submenu's level when its last child moves out", () => {
    useMenuSettings.getState().moveSectorBetween([1, 1, 0], []); // B1a → top level
    expect(ringLabels([])).toEqual(['A', 'B', 'B1a']);
    // B1 had only B1a → it becomes a leaf.
    expect(sectorAtPath(useMenuSettings.getState().config!, [1, 1])?.children).toBeUndefined();
  });
});
