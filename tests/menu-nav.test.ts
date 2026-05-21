// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  INITIAL_DRILL_STATE,
  currentSectors,
  cycleSectorIndex,
  drillReducer,
  navigationRingRotation,
  previewChildren,
  resolveTwistFrame,
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

  it('drill with nextSticky=0 lands sticky on 0 (no falsy collapse)', () => {
    // Belt-and-braces against a future "if (action.nextSticky)" or
    // "action.nextSticky || null" refactor — 0 is falsy in JS, and a
    // mistaken truthy check would turn the post-rotation "land on
    // child[0]" behaviour into the cancel target. Pin it explicitly.
    const state: DrillState = { navigation: [], stickyChildIndex: 3 };
    const result = drillReducer(state, { type: 'drill', index: 3, nextSticky: 0 });
    expect(result.stickyChildIndex).toBe(0);
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

describe('navigationRingRotation', () => {
  it('returns 0 at top level (no parent to align against)', () => {
    expect(navigationRingRotation(NESTED_CONFIG, [])).toBe(0);
  });

  it('rotates by the parent sector centre angle once drilled', () => {
    // FreeCAD is sector 0 in NESTED_CONFIG's two-sector top level.
    // sectorCenterAngle(0, 2) = 0 — i.e. 12 o'clock — so the
    // drilled-in ring's sector 0 stays at the top. Verified by
    // construction, but pinning it locks the convention.
    expect(navigationRingRotation(NESTED_CONFIG, [0])).toBe(0);
  });

  it('rotates by π for a 2-sector parent ring drilled at index 1', () => {
    // Terminal (sector 1) is at angle π in a 2-sector top — were
    // it a branch (it isn't in this config), drilling would spin
    // the new ring 180° so child[0] lands at 6 o'clock. Test with
    // a synthetic config so the math is unambiguous.
    const cfg: MenuConfig = {
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'first',
          binding: { action: builtinAction('exec'), config: { command: 'a' } },
        },
        {
          label: 'second',
          children: [
            { label: 'sub', binding: { action: builtinAction('exec'), config: { command: 'b' } } },
          ],
        },
      ],
    };
    expect(navigationRingRotation(cfg, [1])).toBeCloseTo(Math.PI);
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

describe('cycleSectorIndex', () => {
  it('steps forward and backward with wrap-around', () => {
    expect(cycleSectorIndex(0, 1, 4)).toBe(1);
    expect(cycleSectorIndex(3, 1, 4)).toBe(0); // wrap forward
    expect(cycleSectorIndex(0, -1, 4)).toBe(3); // wrap backward
    expect(cycleSectorIndex(2, -1, 4)).toBe(1);
  });

  it('enters the ring at the natural end from no selection', () => {
    expect(cycleSectorIndex(null, 1, 4)).toBe(0); // forward → first
    expect(cycleSectorIndex(null, -1, 4)).toBe(3); // backward → last
  });

  it('keeps the current selection on a zero step', () => {
    expect(cycleSectorIndex(2, 0, 4)).toBe(2);
    expect(cycleSectorIndex(null, 0, 4)).toBe(0);
  });

  it('is defensive against a degenerate ring', () => {
    expect(cycleSectorIndex(0, 1, 0)).toBe(0);
  });
});

describe('resolveTwistFrame', () => {
  const frame = (o: Partial<Parameters<typeof resolveTwistFrame>[0]>) =>
    resolveTwistFrame({
      sec: null,
      sticky: null,
      cycleStep: 0,
      priority: 'lateral',
      count: 4,
      cycleEnabled: true,
      ...o,
    });

  it('priority "lateral": a cycle step applies only when not aiming', () => {
    // Centred (sec null): the step cycles from sticky.
    expect(frame({ sec: null, sticky: 1, cycleStep: 1 }).hoverIndex).toBe(2);
    // Aiming (sec set): lateral wins, the step is dropped.
    expect(frame({ sec: 0, sticky: 1, cycleStep: 1 }).hoverIndex).toBe(0);
  });

  it('priority "twist": a cycle step overrides lateral aiming', () => {
    expect(frame({ sec: 0, sticky: 1, cycleStep: 1, priority: 'twist' }).hoverIndex).toBe(2);
  });

  it('no step + centred leaves the selection unchanged (hoverIndex null)', () => {
    expect(frame({ sec: null, sticky: 2, cycleStep: 0 }).hoverIndex).toBeNull();
  });

  it('lateral aiming sets hover when no step applies', () => {
    expect(frame({ sec: 3, sticky: 1, cycleStep: 0 }).hoverIndex).toBe(3);
  });

  it('drillTarget falls back to sticky only when twist-cycle is enabled', () => {
    // Enabled: a centred puck with a leftover sticky can be drilled.
    expect(frame({ sec: null, sticky: 2, cycleStep: 0, cycleEnabled: true }).drillTarget).toBe(2);
    // Disabled: preserves the historical "drill needs a laterally-aimed
    // sector" rule — no fallback to the stale sticky.
    expect(
      frame({ sec: null, sticky: 2, cycleStep: 0, cycleEnabled: false }).drillTarget,
    ).toBeNull();
  });

  it('drillTarget is the just-cycled sector on a step (so a firm twist drills it)', () => {
    expect(frame({ sec: null, sticky: 0, cycleStep: 1 }).drillTarget).toBe(1);
  });

  it('drillTarget is the laterally-aimed sector when aiming', () => {
    expect(frame({ sec: 3, sticky: 1, cycleStep: 0, cycleEnabled: false }).drillTarget).toBe(3);
  });
});
