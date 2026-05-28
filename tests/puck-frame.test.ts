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
  // deadzone = the open-submenu (high) threshold; hoverDeadzone = the hover
  // (low) threshold. Open is well above the ~100 magnitudes the hover tests
  // use, so a plain hover doesn't trip the aim-drill.
  deadzone: 250,
  hoverDeadzone: 50,
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  activate: { inputs: [] },
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

describe('resolvePuckFrame — cross-talk guard (direction-aware, #160)', () => {
  it('a directional back no longer suppresses its opposite half — a TZ split works', () => {
    // back on TZ− (press), drill on TZ+ (lift) — the Press/Lift split.
    // Lifting must drill the twist-hovered branch, not be quieted by the
    // back-axis cross-talk guard (which used to block the whole axis).
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({
          aim: 'twist',
          cycle: {
            inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
            priority: 'twist',
          },
          drillIn: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }] },
          back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }] },
        }),
      ),
      axes: axes({ tz: 100 }), // lift; no twist this frame
      navigation: [],
      sticky: 0, // a branch, reached earlier by twisting
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'drill', index: 0 });
  });

  it('still suppresses lateral when a both-direction back is deflected (held back)', () => {
    // back TZ both, held (no rising edge): the frame resolves to none and
    // lateral never sneaks through while the puck rests on the back axis.
    const r = resolvePuckFrame({
      menuConfig: config(
        nav({ back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] } }),
      ),
      axes: axes({ tz: -100, ty: 100 }),
      navigation: [],
      sticky: null,
      edges: { ...FRESH, back: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
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

  it('does nothing in an empty ring — no item to aim at, no NaN sector (#160)', () => {
    const r = resolvePuckFrame({
      menuConfig: {
        version: MENU_CONFIG_VERSION,
        navigation: nav({}),
        root: { label: '', branches: [] },
      },
      axes: axes({ ty: -300 }), // a firm aim that would normally hover/drill
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'none' });
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

  it('tilt aims by tilt axes and ignores push — RX (forward/back) drives the vertical', () => {
    // RX → vertical: rx −100 aims the top sector, like ty −100 does for push.
    expect(hover(nav({ aim: 'tilt' }), { rx: -100 })).toEqual({ kind: 'hover', index: 0 });
    expect(hover(nav({ aim: 'tilt' }), { ty: -100 })).toEqual({ kind: 'none' });
  });

  it('both sums push with the matching tilt axis — each alone below the deadzone, together over it', () => {
    // Push-forward (ty) and tilt-forward (rx) both drive the vertical, so they
    // reinforce: −30 each is inside the 50 deadzone, summed (−60) aims the top.
    expect(hover(nav({ aim: 'push' }), { ty: -30 })).toEqual({ kind: 'none' });
    expect(hover(nav({ aim: 'both' }), { ty: -30, rx: -30 })).toEqual({ kind: 'hover', index: 0 });
  });

  it('hoverDeadzone gates when an item lights up (#160)', () => {
    // ty −100 is over a 50 hover threshold (hovers), but under a 150 one.
    expect(hover(nav({ hoverDeadzone: 50 }), { ty: -100 })).toEqual({ kind: 'hover', index: 0 });
    expect(hover(nav({ hoverDeadzone: 150 }), { ty: -100 })).toEqual({ kind: 'none' });
  });

  it('aim drills past the open-submenu threshold; lighter aim only hovers (#160)', () => {
    const cfg = nav({ deadzone: 250, hoverDeadzone: 50 });
    const at = (p: Partial<SixAxes>, edges = FRESH) =>
      resolvePuckFrame({
        menuConfig: config(cfg),
        axes: axes(p),
        navigation: [],
        sticky: null,
        edges,
      }).outcome;
    // SECTORS[0] is a branch. A light aim (100: over hover 50, under open 250)
    // just hovers it.
    expect(at({ ty: -100 })).toEqual({ kind: 'hover', index: 0 });
    // A firm aim (300 > open 250) opens it — the aim itself is the drill.
    expect(at({ ty: -300 })).toEqual({ kind: 'drill', index: 0 });
    // Held past the threshold, it doesn't re-open (one level per rising edge).
    expect(at({ ty: -300 }, { ...FRESH, drill: true })).toEqual({ kind: 'hover', index: 0 });
  });

  it('drill re-arms only below the hover threshold — no cascade on overshoot (#160)', () => {
    const cfg = nav({ deadzone: 250, hoverDeadzone: 50 });
    const edgesAfter = (p: Partial<SixAxes>, drill: boolean) =>
      resolvePuckFrame({
        menuConfig: config(cfg),
        axes: axes(p),
        navigation: [],
        sticky: null,
        edges: { ...FRESH, drill },
      }).edges.drill;
    // Already consumed (just drilled): easing into the hover band (150, still
    // > hover 50) does NOT re-arm — overshoot near the open threshold can't
    // re-fire.
    expect(edgesAfter({ ty: -150 }, true)).toBe(true);
    // Only easing back below the hover threshold (30 ≤ 50) re-arms the drill.
    expect(edgesAfter({ ty: -30 }, true)).toBe(false);
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

describe('resolvePuckFrame — global activate gesture (#160)', () => {
  // SECTORS[0] is a branch, SECTORS[1] a leaf with an action. The menu-level
  // activate gesture (button 0 here) fires the hovered leaf without it
  // binding its own per-item activation.
  const navAct = nav({ activate: { inputs: [{ kind: 'button', button: 0 }] } });

  it('fires the hovered leaf when the global activate input rises', () => {
    const r = resolvePuckFrame({
      menuConfig: config(navAct),
      axes: ZERO,
      buttons: [true],
      navigation: [],
      sticky: 1,
      edges: FRESH,
    });
    expect(r.outcome).toEqual({ kind: 'activate', index: 1 });
    expect(r.edges.activate).toBe(true);
  });

  it('does not re-fire while the button stays held', () => {
    const r = resolvePuckFrame({
      menuConfig: config(navAct),
      axes: ZERO,
      buttons: [true],
      navigation: [],
      sticky: 1,
      edges: { ...FRESH, activate: true },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(r.edges.activate).toBe(true);
  });

  it('does not fire on a hovered branch — only a leaf with an action activates', () => {
    const r = resolvePuckFrame({
      menuConfig: config(navAct),
      axes: ZERO,
      buttons: [true],
      navigation: [],
      sticky: 0, // a branch
      edges: FRESH,
    });
    expect(r.outcome.kind).not.toBe('activate');
    expect(r.edges.activate).toBe(false);
  });

  it('does nothing at the centre (no hovered leaf)', () => {
    const r = resolvePuckFrame({
      menuConfig: config(navAct),
      axes: ZERO,
      buttons: [true],
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    expect(r.outcome.kind).not.toBe('activate');
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

describe('resolvePuckFrame — shape-plugin hit-test override (#107 PR3c)', () => {
  // The shape hit-test routes through the optional `hitTest` arg
  // instead of the wedge-default `axesToSector`. The wedge code path
  // stays the active sector resolver when `hitTest` is omitted (the
  // default for every preceding test in this file proves that).

  it('uses the callback instead of axesToSector when provided', () => {
    // The callback gets the unmodified axes (no aim-source reduction,
    // no rotation) plus the sector count.
    let received: { tx: number; ty: number; sectorCount: number } | null = null;
    resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tx: 1, ty: 2 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
      hitTest: (a, sectorCount) => {
        received = { tx: a.tx, ty: a.ty, sectorCount };
        return 0;
      },
    });
    expect(received).not.toBeNull();
    expect(received).toEqual({ tx: 1, ty: 2, sectorCount: SECTORS.length });
  });

  it('passes the raw six-axis snapshot, not the reduced aim source', () => {
    // The plugin gets the full six-axis snapshot so it can hit-test on
    // whichever axes its layout cares about (twist for a rotational
    // layout, lateral for orbital, etc.). The wedge path's aim-source
    // reduction and rotation are deliberately skipped.
    let received: { tz: number; rz: number } | null = null;
    resolvePuckFrame({
      menuConfig: config(nav({ aim: 'twist' })),
      axes: axes({ tx: 10, ty: 20, tz: 30, rx: 40, ry: 50, rz: 60 }),
      navigation: [],
      sticky: null,
      edges: FRESH,
      hitTest: (a) => {
        received = { tz: a.tz, rz: a.rz };
        return null;
      },
    });
    expect(received).not.toBeNull();
    // tz / rz reach the plugin even though `aim: 'twist'` would have
    // collapsed lateral aiming to null in the wedge path.
    expect(received).toEqual({ tz: 30, rz: 60 });
  });

  it('the wedge default path is untouched when hitTest is omitted', () => {
    // Sanity guard: every preceding test in this file calls
    // resolvePuckFrame without `hitTest` and the outcomes are what the
    // pre-PR3c behaviour produced. This case re-asserts it explicitly
    // with a frame the wedge path resolves to a non-null sector via
    // lateral aim, just to pin "the new optional arg can't have changed
    // the wedge path when it's left out".
    const r = resolvePuckFrame({
      menuConfig: config(nav({})),
      axes: axes({ tx: 200 }), // past hoverDeadzone, well into a sector
      navigation: [],
      sticky: null,
      edges: FRESH,
    });
    // The wedge path's aim landed on a sector; outcome is hover (the
    // hover-set-sticky case the resolver reports when no terminal
    // gesture fires).
    expect(r.outcome.kind).toBe('hover');
  });

  it('still short-circuits an empty ring (no sectors to hit-test)', () => {
    // An empty active ring (centre-only menu) returns `none` ahead of
    // any sector resolution, with or without a hitTest override. The
    // short-circuit must precede the callback so an empty pie doesn't
    // bother loading the plugin's hit-test.
    const emptyConfig: MenuConfig = {
      version: MENU_CONFIG_VERSION,
      navigation: nav({}),
      root: { label: '', branches: [] },
    };
    let callbackRan = false;
    const r = resolvePuckFrame({
      menuConfig: emptyConfig,
      axes: ZERO,
      navigation: [],
      sticky: null,
      edges: FRESH,
      hitTest: () => {
        callbackRan = true;
        return 0;
      },
    });
    expect(r.outcome).toEqual({ kind: 'none' });
    expect(callbackRan).toBe(false);
  });
});
