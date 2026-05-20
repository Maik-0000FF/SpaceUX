// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, type MenuConfig } from '@/shared/menu';

import { useAppState } from '../src/editor/state/app-state';
import { sectorAtPath } from '../src/editor/state/selectors';

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
