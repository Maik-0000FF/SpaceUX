// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { resolvePuckFrame, type PuckEdges } from '../src/core/menu-nav';
import type { SixAxes } from '../src/core/pie-geometry';
import {
  MENU_CONFIG_VERSION,
  builtinAction,
  type MenuConfig,
  type MenuNavigation,
} from '../src/shared/menu';

/**
 * Golden tests pinning the per-frame navigation decision that
 * `resolvePuckFrame` lifted out of `useDrillNavigation`. They lock the
 * current behaviour (gesture priority, the cross-talk guard, and the
 * partial rising-edge update on early return) so a later reorder /
 * per-sector-override PR can't change it silently.
 */

const ZERO: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
const axes = (p: Partial<SixAxes>): SixAxes => ({ ...ZERO, ...p });

/** No gesture remembered as active — the post-reset / first-frame state
 *  is the opposite (`true` everywhere), but for asserting rising edges a
 *  clean `false` baseline is clearer. */
const FRESH: PuckEdges = { commit: false, back: false, drill: false, cycle: false };

/** Full navigation block (resolveNavigation replaces wholesale, so a
 *  partial would drop the unspecified gestures). */
const nav = (over: Partial<MenuNavigation>): MenuNavigation => ({
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  ...over,
});

const SECTORS = [
  { label: 'Branch', children: [{ label: 'C0' }, { label: 'C1' }] },
  { label: 'Leaf', binding: { action: builtinAction('exec'), config: { command: 'x' } } },
];

const config = (navigation: MenuNavigation): MenuConfig => ({
  version: MENU_CONFIG_VERSION,
  navigation,
  sectors: SECTORS,
});

describe('resolvePuckFrame — commit center', () => {
  it('fires on the rising edge of the commit gesture', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          commitCenter: {
            inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
          },
        }),
      ),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'commitCenter' });
    expect(r.edges.commit).toBe(true);
  });

  it('does not re-fire while the commit gesture stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          commitCenter: {
            inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
          },
        }),
      ),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: null,
      edges: { ...FRESH, commit: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges.commit).toBe(true);
  });

  it('leaves the other gestures’ memory untouched when it short-circuits', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          commitCenter: {
            inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
          },
        }),
      ),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: null,
      edges: { commit: false, back: true, drill: true, cycle: true },
    });
    expect(r.outcome).toEqual({ kind: 'commitCenter' });
    expect(r.edges).toEqual({ commit: true, back: true, drill: true, cycle: true });
  });
});

describe('resolvePuckFrame — back / pop / dismiss', () => {
  it('pops one level when drilled in', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [0],
      sticky: 0,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'back', mode: 'pop' });
    expect(r.edges.back).toBe(true);
  });

  it('dismisses at the top level', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'back', mode: 'dismiss' });
  });

  it('does not re-fire while back stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null,
      edges: { ...FRESH, back: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges.back).toBe(true);
  });
});

describe('resolvePuckFrame — cross-talk guard', () => {
  it('suppresses lateral selection when the back axis is deflected on its non-firing half', () => {
    // Back bound to tz-positive only: tz=-100 doesn't fire back, but the
    // axis is engaged, so lateral hover/drill is quieted. The later
    // gestures' memory passes through untouched.
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }] },
        }),
      ),
      axes: axes({ tz: -100, ty: 100 }),
      navigation: [],
      sticky: null,
      edges: { commit: false, back: false, drill: true, cycle: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges).toEqual({ commit: false, back: false, drill: true, cycle: true });
  });
});

describe('resolvePuckFrame — drill / hover / cycle', () => {
  it('drills into the hovered branch on the rising edge', () => {
    // axisInvert defaults to y:false (raw evdev), so -ty aims at the top
    // sector (index 0 = the branch); tilt magnitude past 200 drills it.
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({ drillIn: { inputs: [{ kind: 'magnitude', source: 'tilt', threshold: 200 }] } }),
      ),
      axes: axes({ ty: -100, rx: 300 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'drill', index: 0 });
    expect(r.edges.drill).toBe(true);
  });

  it('hovers the laterally-aimed sector when no drill fires', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ ty: -100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'hover', index: 0 });
  });

  it('steps the selection on a twist-cycle from a centred puck', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          cycle: {
            inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
            priority: 'lateral',
          },
        }),
      ),
      axes: axes({ rz: 200 }),
      navigation: [],
      sticky: 0,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'hover', index: 1 });
    expect(r.edges.cycle).toBe(true);
  });

  it('does nothing with a centred puck and no gestures', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: ZERO,
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'none' });
  });
});
