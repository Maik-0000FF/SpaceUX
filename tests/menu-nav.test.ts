// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  INITIAL_DRILL_STATE,
  currentSectors,
  drillReducer,
  type DrillState,
} from '../src/core/menu-nav';
import { MENU_CONFIG_VERSION, builtinAction, type MenuConfig } from '../src/shared/menu';

/** Two-level test config: a branch ("FreeCAD") with two leaves and a
 *  separate top-level leaf. Mirrors the kind of menu users will
 *  actually write so the tests exercise realistic shapes. */
const NESTED_CONFIG: MenuConfig = {
  version: MENU_CONFIG_VERSION,
  sectors: [
    {
      label: 'FreeCAD',
      children: [
        { label: 'New', binding: { action: builtinAction('exec'), config: { command: 'new' } } },
        { label: 'Open', binding: { action: builtinAction('exec'), config: { command: 'open' } } },
      ],
    },
    {
      label: 'Terminal',
      binding: { action: builtinAction('exec'), config: { command: 'konsole' } },
    },
  ],
};

describe('drillReducer', () => {
  it('initial state has empty navigation and no selection', () => {
    expect(INITIAL_DRILL_STATE).toEqual({ navigation: [], stickyChildIndex: null });
  });

  it('open resets to the initial state', () => {
    const dirty: DrillState = { navigation: [0, 1], stickyChildIndex: 3 };
    expect(drillReducer(dirty, { type: 'open' })).toEqual(INITIAL_DRILL_STATE);
  });

  it('open is a no-op when already at initial state (identity short-circuit)', () => {
    // The reducer returns the same reference so React can skip the
    // re-render. Without this, every MENU_OPEN at idle would still
    // cause a render cascade.
    const result = drillReducer(INITIAL_DRILL_STATE, { type: 'open' });
    expect(result).toBe(INITIAL_DRILL_STATE);
  });

  it('hover updates stickyChildIndex', () => {
    const state = drillReducer(INITIAL_DRILL_STATE, { type: 'hover', index: 2 });
    expect(state.stickyChildIndex).toBe(2);
    expect(state.navigation).toEqual([]);
  });

  it('hover with null clears the selection', () => {
    const state: DrillState = { navigation: [], stickyChildIndex: 4 };
    const result = drillReducer(state, { type: 'hover', index: null });
    expect(result.stickyChildIndex).toBeNull();
  });

  it('hover with the same index is an identity short-circuit', () => {
    // Same regression-net role as the open short-circuit: every
    // puck frame would otherwise mint a new state and re-render.
    const state: DrillState = { navigation: [0], stickyChildIndex: 2 };
    const result = drillReducer(state, { type: 'hover', index: 2 });
    expect(result).toBe(state);
  });

  it('drill pushes the index onto navigation and resets selection', () => {
    const state: DrillState = { navigation: [], stickyChildIndex: 0 };
    const result = drillReducer(state, { type: 'drill', index: 0 });
    expect(result.navigation).toEqual([0]);
    expect(result.stickyChildIndex).toBeNull();
  });

  it('drill stacks for multi-level navigation', () => {
    let state = INITIAL_DRILL_STATE;
    state = drillReducer(state, { type: 'drill', index: 0 });
    state = drillReducer(state, { type: 'drill', index: 1 });
    state = drillReducer(state, { type: 'drill', index: 2 });
    expect(state.navigation).toEqual([0, 1, 2]);
    expect(state.stickyChildIndex).toBeNull();
  });

  it('pop removes the deepest level and resets selection', () => {
    const state: DrillState = { navigation: [0, 1], stickyChildIndex: 3 };
    const result = drillReducer(state, { type: 'pop' });
    expect(result.navigation).toEqual([0]);
    expect(result.stickyChildIndex).toBeNull();
  });

  it('pop at depth 0 is a no-op (identity short-circuit)', () => {
    // Caller doesn't have to gate the TZ-edge dispatch — the reducer
    // refuses to pop past the top level and returns the same ref so
    // React doesn't churn.
    const result = drillReducer(INITIAL_DRILL_STATE, { type: 'pop' });
    expect(result).toBe(INITIAL_DRILL_STATE);
  });
});

describe('currentSectors', () => {
  it('returns the top-level sectors when navigation is empty', () => {
    expect(currentSectors(NESTED_CONFIG, [])).toBe(NESTED_CONFIG.sectors);
  });

  it("walks one level into a branch's children", () => {
    const result = currentSectors(NESTED_CONFIG, [0]);
    expect(result).toHaveLength(2);
    expect(result[0]?.label).toBe('New');
    expect(result[1]?.label).toBe('Open');
  });

  it('falls back to top-level when the path points into a leaf', () => {
    // Defensive: hot-reload could replace a branch with a leaf
    // while the user is drilled in. Rather than crash with an
    // undefined, return the top so the user lands somewhere valid
    // — the renderer can re-pick after the config change settles.
    const result = currentSectors(NESTED_CONFIG, [1]);
    expect(result).toBe(NESTED_CONFIG.sectors);
  });

  it('falls back to top-level when an index is out of range', () => {
    expect(currentSectors(NESTED_CONFIG, [99])).toBe(NESTED_CONFIG.sectors);
  });

  it('resolves a three-level deep navigation', () => {
    const deep: MenuConfig = {
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'L0',
          children: [
            {
              label: 'L1',
              children: [
                {
                  label: 'L2',
                  binding: { action: builtinAction('exec'), config: { command: 'leaf' } },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = currentSectors(deep, [0, 0]);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('L2');
  });
});
