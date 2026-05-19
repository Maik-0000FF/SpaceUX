// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  INITIAL_DRILL_STATE,
  currentSectors,
  drillReducer,
  previewChildren,
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

  it('reset returns the initial state', () => {
    const dirty: DrillState = { navigation: [0, 1], stickyChildIndex: 3 };
    expect(drillReducer(dirty, { type: 'reset' })).toEqual(INITIAL_DRILL_STATE);
  });

  it('reset is a no-op when already at initial state (identity short-circuit)', () => {
    // The reducer returns the same reference so React can skip the
    // re-render. Without this, every MENU_OPEN at idle would still
    // cause a render cascade.
    const result = drillReducer(INITIAL_DRILL_STATE, { type: 'reset' });
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

  it('drill pushes the index onto navigation and sets sticky from action', () => {
    // `nextSticky: null` is the explicit "start the new ring with
    // no selection" path; PR-C's carry-over behaviour uses a number
    // here when the caller wants the parent's hover to follow into
    // the deeper ring.
    const state: DrillState = { navigation: [], stickyChildIndex: 0 };
    const result = drillReducer(state, { type: 'drill', index: 0, nextSticky: null });
    expect(result.navigation).toEqual([0]);
    expect(result.stickyChildIndex).toBeNull();
  });

  it('drill applies the caller-provided nextSticky as-is (no reducer-side clamping)', () => {
    // Clamping is the caller's responsibility — App.tsx's commit
    // handler applies Math.min(parentSticky, children.length - 1)
    // before dispatching. The reducer stays a pure mapper so this
    // policy can change in one place without rewriting the
    // transition.
    const state: DrillState = { navigation: [], stickyChildIndex: 2 };
    const result = drillReducer(state, { type: 'drill', index: 2, nextSticky: 1 });
    expect(result.stickyChildIndex).toBe(1);
  });

  it('drill stacks for multi-level navigation', () => {
    let state = INITIAL_DRILL_STATE;
    state = drillReducer(state, { type: 'drill', index: 0, nextSticky: null });
    state = drillReducer(state, { type: 'drill', index: 1, nextSticky: null });
    state = drillReducer(state, { type: 'drill', index: 2, nextSticky: null });
    expect(state.navigation).toEqual([0, 1, 2]);
    expect(state.stickyChildIndex).toBeNull();
  });

  it('pop lands sticky on the index we popped from (parent breadcrumb cue)', () => {
    // Coming back out of a submenu, the user expects to see the
    // sector they drilled into highlighted in the parent ring —
    // not the red cancel target. Without this carry the TZ-back
    // gesture feels like "exit" rather than "step back".
    const state: DrillState = { navigation: [0, 1], stickyChildIndex: 3 };
    const result = drillReducer(state, { type: 'pop' });
    expect(result.navigation).toEqual([0]);
    expect(result.stickyChildIndex).toBe(1);
  });

  it('pop from depth 1 lands sticky on the top-level entry index', () => {
    // Same contract one level shallower: from [2] back to [] the
    // sticky becomes 2 so the top-level parent sector is the one
    // highlighted on exit.
    const state: DrillState = { navigation: [2], stickyChildIndex: 0 };
    const result = drillReducer(state, { type: 'pop' });
    expect(result.navigation).toEqual([]);
    expect(result.stickyChildIndex).toBe(2);
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

  it('resolves a three-level deep navigation at runtime', () => {
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

describe('previewChildren', () => {
  it('returns undefined when no sector is sticky', () => {
    expect(previewChildren(NESTED_CONFIG, INITIAL_DRILL_STATE)).toBeUndefined();
    expect(
      previewChildren(NESTED_CONFIG, { navigation: [0], stickyChildIndex: null }),
    ).toBeUndefined();
  });

  it('returns undefined when the hovered sector is a leaf', () => {
    // Top-level "Terminal" sector — leaf, has binding, no children.
    expect(previewChildren(NESTED_CONFIG, { navigation: [], stickyChildIndex: 1 })).toBeUndefined();
  });

  it('returns the children when the hovered sector is a branch', () => {
    // Top-level "FreeCAD" — branch with two leaves underneath.
    const result = previewChildren(NESTED_CONFIG, { navigation: [], stickyChildIndex: 0 });
    expect(result).toHaveLength(2);
    expect(result?.[0]?.label).toBe('New');
    expect(result?.[1]?.label).toBe('Open');
  });

  it('returns the grandchildren when drilled in and hovering a branch', () => {
    // Build a 3-level config so we can drill once and still hover a
    // branch. The previewChildren contract must compose with depth.
    const deep: MenuConfig = {
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'L0',
          children: [
            {
              label: 'L1-branch',
              children: [
                {
                  label: 'leaf',
                  binding: { action: builtinAction('exec'), config: { command: '' } },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = previewChildren(deep, { navigation: [0], stickyChildIndex: 0 });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.label).toBe('leaf');
  });
});
