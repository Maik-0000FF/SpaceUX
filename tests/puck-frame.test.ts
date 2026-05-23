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
  type MenuNode,
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
const FRESH: PuckEdges = {
  activate: false,
  exit: false,
  commit: false,
  back: false,
  drill: false,
  cycle: false,
};

/** Full navigation block (resolveNavigation replaces wholesale, so a
 *  partial would drop the unspecified gestures). */
const nav = (over: Partial<MenuNavigation>): MenuNavigation => ({
  aim: 'push',
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  ...over,
});

const SECTORS = [
  { label: 'Branch', branches: [{ label: 'C0' }, { label: 'C1' }] },
  { label: 'Leaf', action: { id: builtinAction('exec'), config: { command: 'x' } } },
];

const config = (navigation: MenuNavigation): MenuConfig => ({
  version: MENU_CONFIG_VERSION,
  navigation,
  root: { label: '', branches: SECTORS },
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

  it('does not commit the centre while a sector is hovered (commit only at the centre)', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          back: { inputs: [] }, // isolate: only commitCenter reacts to TZ+
          commitCenter: {
            inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
          },
        }),
      ),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: 1, // a sector is hovered → the centre isn't the active target
      edges: FRESH,
    });
    expect(r.outcome).not.toEqual({ kind: 'commitCenter' });
    expect(r.edges.commit).toBe(true); // edge still tracked (no fire on return)
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
      edges: { activate: false, exit: false, commit: false, back: true, drill: true, cycle: true },
    });
    expect(r.outcome).toEqual({ kind: 'commitCenter' });
    expect(r.edges).toEqual({
      activate: false,
      exit: false,
      commit: true,
      back: true,
      drill: true,
      cycle: true,
    });
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

  it('walks to the centre from a hovered sector at the top level (#147)', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: 0, // a sector is focused → back focuses the centre, pie open
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'exitToCenter' });
    expect(r.edges.back).toBe(true);
  });

  it('dismisses from the centre at the top level (escape hatch)', () => {
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null, // already at the centre → back dismisses
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'back', mode: 'dismiss' });
  });

  // A cancel centre: back rests on it (no-op) only when it's closable
  // another way (toggle trigger, or a bound commitCenter); otherwise back
  // stays the fallback escape so the pie can't soft-lock.
  const cancelRoot = (over: {
    triggerMode: 'toggle' | 'open';
    commitBound?: boolean;
  }): MenuConfig => ({
    version: MENU_CONFIG_VERSION,
    triggerMode: over.triggerMode,
    navigation: nav(
      over.commitBound
        ? {
            commitCenter: {
              inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
            },
          }
        : {},
    ),
    root: { label: 'Quit', action: { id: builtinAction('cancel') }, branches: SECTORS },
  });
  const backAtCentre = (cfg: MenuConfig) =>
    resolvePuckFrame({
      menuConfig: cfg,
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    }).outcome;

  it('cancel centre, toggle mode: back rests on the centre (trigger closes)', () => {
    expect(backAtCentre(cancelRoot({ triggerMode: 'toggle' }))).toEqual({ kind: 'none' });
  });

  it('cancel centre, open mode + bound commitCenter: back rests on the centre (commit closes)', () => {
    expect(backAtCentre(cancelRoot({ triggerMode: 'open', commitBound: true }))).toEqual({
      kind: 'none',
    });
  });

  it('cancel centre, open mode + unbound commitCenter: back still dismisses (no soft-lock)', () => {
    expect(backAtCentre(cancelRoot({ triggerMode: 'open' }))).toEqual({
      kind: 'back',
      mode: 'dismiss',
    });
  });

  it('keeps the pie open the frame after walking to the centre while held (#147)', () => {
    // Frame 1 focuses the centre from a hovered sector and folds the
    // globals' activity into the edges; frame 2 (held, sticky now null)
    // must not phantom-dismiss.
    const cfg = config(nav({}));
    const f1 = resolvePuckFrame({
      menuConfig: cfg,
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: 0,
      edges: FRESH,
    });
    expect(f1.outcome).toEqual({ kind: 'exitToCenter' });
    expect(f1.edges.back).toBe(true);
    const f2 = resolvePuckFrame({
      menuConfig: cfg,
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null,
      edges: f1.edges,
    });
    expect(f2.outcome).toEqual({ kind: 'none' }); // not back/dismiss
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
      edges: { activate: false, exit: false, commit: false, back: false, drill: true, cycle: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges).toEqual({
      activate: false,
      exit: false,
      commit: false,
      back: false,
      drill: true,
      cycle: true,
    });
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

describe('resolvePuckFrame — aim source (#159)', () => {
  const hover = (navigation: MenuNavigation, p: Partial<SixAxes>) =>
    resolvePuckFrame({
      menuConfig: config(navigation),
      axes: axes(p),
      navigation: [],
      sticky: null,
      edges: FRESH,
    }).outcome;

  it('push (default) aims by TX/TY and ignores tilt', () => {
    expect(hover(nav({ aim: 'push' }), { ty: -100 })).toEqual({ kind: 'hover', index: 0 });
    // RX/RY don't steer when aiming by push.
    expect(hover(nav({ aim: 'push' }), { ry: -100 })).toEqual({ kind: 'none' });
  });

  it('tilt aims by RX/RY and ignores push', () => {
    expect(hover(nav({ aim: 'tilt' }), { ry: -100 })).toEqual({ kind: 'hover', index: 0 });
    expect(hover(nav({ aim: 'tilt' }), { ty: -100 })).toEqual({ kind: 'none' });
  });

  it('both sums push and tilt — each alone below the deadzone, together over it', () => {
    // -30 push and -30 tilt are each inside the 50 deadzone, but summed
    // (-60) they cross it and aim the top sector — proving equal contribution.
    expect(hover(nav({ aim: 'push' }), { ty: -30 })).toEqual({ kind: 'none' });
    expect(hover(nav({ aim: 'both' }), { ty: -30, ry: -30 })).toEqual({ kind: 'hover', index: 0 });
  });

  it('twist turns lateral pointing off — push and tilt no longer aim', () => {
    expect(hover(nav({ aim: 'twist' }), { ty: -100 })).toEqual({ kind: 'none' });
    expect(hover(nav({ aim: 'twist' }), { rx: -100, ry: -100 })).toEqual({ kind: 'none' });
  });

  it('twist enters the ring from the centre (sticky=null) — the first twist lands on item 0', () => {
    // The "I open at the centre, how do I reach the first item?" path: with
    // no lateral pointer, a forward twist steps in from null → index 0.
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          aim: 'twist',
          cycle: {
            inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
            priority: 'lateral',
          },
        }),
      ),
      axes: axes({ rz: 200 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'hover', index: 0 });
    expect(r.edges.cycle).toBe(true);
  });

  it('twist then steps on from the current selection', () => {
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          aim: 'twist',
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
});

describe('resolvePuckFrame — per-item activation (#130 R2)', () => {
  // The hovered leaf (index 1) binds TZ− to fire its own binding. The
  // default global back is TZ both — so TZ down collides, and the per-item
  // activation must win for this item; TZ up still backs (direction-aware).
  const ACT_SECTORS: MenuNode[] = [
    { label: 'Branch', branches: [{ label: 'C0' }, { label: 'C1' }] },
    {
      label: 'Vol',
      action: { id: builtinAction('exec'), config: { command: 'x' } },
      activation: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }] },
    },
  ];
  const actConfig = (navigation: MenuNavigation): MenuConfig => ({
    version: MENU_CONFIG_VERSION,
    navigation,
    root: { label: '', branches: ACT_SECTORS },
  });

  it('fires the hovered leaf and wins over the colliding global back', () => {
    const r = resolvePuckFrame({
      menuConfig: actConfig(nav({})),
      axes: axes({ tz: -100 }), // also satisfies global back (TZ both)
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'activate', index: 1 });
    expect(r.edges.activate).toBe(true);
  });

  it('does not re-fire while the activation input stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: actConfig(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: 1,
      edges: { ...FRESH, activate: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges.activate).toBe(true);
  });

  it('leaves the other half of the axis free: TZ up still backs (to the centre)', () => {
    const r = resolvePuckFrame({
      menuConfig: actConfig(nav({})),
      axes: axes({ tz: 100 }), // activation is TZ−, so this doesn't activate
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    // Top level with a hovered sector → back walks to the centre (#147),
    // it no longer dismisses outright.
    expect(r.outcome).toEqual({ kind: 'exitToCenter' });
    expect(r.edges.activate).toBe(false);
  });

  it('ignores activation when no sector is hovered (sticky null)', () => {
    const r = resolvePuckFrame({
      menuConfig: actConfig(nav({})),
      axes: axes({ tz: -100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    // No hovered leaf → activation can't fire; falls through to global back.
    expect(r.outcome).toEqual({ kind: 'back', mode: 'dismiss' });
  });
});

describe('resolvePuckFrame — per-item exit (#130 R3)', () => {
  // The hovered sector (index 1) binds TZ+ as its own way back to centre.
  // Global back is TZ both — so TZ up collides, and the per-item exit wins;
  // TZ down still backs (direction-aware).
  const EXIT_SECTORS: MenuNode[] = [
    { label: 'Branch', branches: [{ label: 'C0' }, { label: 'C1' }] },
    {
      label: 'Item',
      action: { id: builtinAction('exec'), config: { command: 'x' } },
      exit: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }] },
    },
  ];
  const exitConfig = (navigation: MenuNavigation): MenuConfig => ({
    version: MENU_CONFIG_VERSION,
    navigation,
    root: { label: '', branches: EXIT_SECTORS },
  });

  it('deselects to centre and wins over the colliding global back', () => {
    const r = resolvePuckFrame({
      menuConfig: exitConfig(nav({})),
      axes: axes({ tz: 100 }), // also satisfies global back (TZ both)
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'exitToCenter' });
    expect(r.edges.exit).toBe(true);
  });

  it('does not re-fire while the exit input stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: exitConfig(nav({})),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: 1,
      edges: { ...FRESH, exit: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges.exit).toBe(true);
  });

  it('leaves the other half of the axis free: TZ down still backs (to the centre)', () => {
    const r = resolvePuckFrame({
      menuConfig: exitConfig(nav({})),
      axes: axes({ tz: -100 }), // exit is TZ+, so this doesn't exit
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    // Top level with a hovered sector → back walks to the centre (#147).
    expect(r.outcome).toEqual({ kind: 'exitToCenter' });
    expect(r.edges.exit).toBe(false);
  });

  it('ignores exit when no sector is hovered (sticky null)', () => {
    const r = resolvePuckFrame({
      menuConfig: exitConfig(nav({})),
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    // No hovered sector → exit can't fire; TZ+ falls through to global back.
    expect(r.outcome).toEqual({ kind: 'back', mode: 'dismiss' });
  });

  it('keeps the pie open the frame after exit while the input stays held', () => {
    // Regression: exit deselects (sticky→null), so the next frame has no
    // hovered sector and the still-held TZ+ would fall through to the
    // default TZ-both back and dismiss. The exit return folds the globals'
    // activity into the edges to prevent that phantom rising edge.
    const cfg = exitConfig(nav({}));
    const f1 = resolvePuckFrame({
      menuConfig: cfg,
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    expect(f1.outcome).toEqual({ kind: 'exitToCenter' });
    // Global back marked active so it can't rising-edge next frame.
    expect(f1.edges.back).toBe(true);
    // Frame 2: input still held, sticky now null (hook applied hover(null)).
    const f2 = resolvePuckFrame({
      menuConfig: cfg,
      axes: axes({ tz: 100 }),
      navigation: [],
      sticky: null,
      edges: f1.edges,
    });
    expect(f2.outcome).toEqual({ kind: 'none' }); // not back/dismiss
  });
});

describe('resolvePuckFrame — button-bound inputs (#151)', () => {
  const btnCommit = config(nav({ commitCenter: { inputs: [{ kind: 'button', button: 1 }] } }));

  it('fires a gesture bound to a button when that button is held', () => {
    const r = resolvePuckFrame({
      menuConfig: btnCommit,
      axes: ZERO,
      buttons: [false, true],
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'commitCenter' });
    expect(r.edges.commit).toBe(true);
  });

  it('stays inert when no button state is passed (axis-only callers)', () => {
    const r = resolvePuckFrame({
      menuConfig: btnCommit,
      axes: ZERO,
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'none' });
  });

  it('does not re-fire while the button stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: btnCommit,
      axes: ZERO,
      buttons: [false, true],
      navigation: [],
      sticky: null,
      edges: { ...FRESH, commit: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
  });
});
