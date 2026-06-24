// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  gestureConflicts,
  gestureShadows,
  inputConflict,
  unreachableThresholdHint,
} from '../src/core/gesture-collision';
import type { GestureBinding, InputBinding, MenuNavigation } from '../src/shared/menu';

const nav = (over: Partial<MenuNavigation>): MenuNavigation => ({
  aim: 'push',
  deadzone: 50,
  hoverDeadzone: 25,
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  activate: { inputs: [] },
  ...over,
});

const binding = (...inputs: GestureBinding['inputs']): GestureBinding => ({ inputs });

describe('gestureShadows', () => {
  it('returns nothing for an absent or empty binding', () => {
    expect(gestureShadows(undefined, nav({}))).toEqual([]);
    expect(gestureShadows(binding(), nav({}))).toEqual([]);
  });

  it('flags the global back when the binding shares its axis (both overlaps a half)', () => {
    // back is TZ both; binding TZ− shadows it — true for an activation or an
    // exit alike, since both resolve ahead of the global gestures.
    const r = gestureShadows(
      binding({ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }),
      nav({}),
    );
    expect(r).toEqual(['Go back']);
  });

  it('does not flag a different axis', () => {
    const r = gestureShadows(
      binding({ kind: 'axis', axis: 'rx', direction: 'positive', threshold: 50 }),
      nav({}),
    );
    expect(r).toEqual([]);
  });

  it('flags cycle and commit-center by button / axis overlap', () => {
    const r = gestureShadows(
      binding(
        { kind: 'axis', axis: 'rz', direction: 'positive', threshold: 50 },
        { kind: 'button', button: 1 },
      ),
      nav({
        cycle: {
          inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
          priority: 'lateral',
        },
        commitCenter: { inputs: [{ kind: 'button', button: 1 }] },
      }),
    );
    expect(r).toEqual(['Step through items', 'Activate center']);
  });

  it('treats different input kinds as non-colliding', () => {
    // magnitude (tilt) vs an axis back binding: different mechanism.
    const r = gestureShadows(
      binding({ kind: 'magnitude', source: 'tilt', threshold: 200 }),
      nav({}),
    );
    expect(r).toEqual([]);
  });
});

describe('unreachableThresholdHint', () => {
  // nav({}) reach reference = max(deadzone 50, hoverDeadzone 25, back tz 50) = 50.
  it('flags a binding set firmer than the navigation reach', () => {
    const r = unreachableThresholdHint(
      binding({ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 200 }),
      nav({}),
    );
    expect(r).toEqual({ threshold: 200, reference: 50 });
  });

  it('stays quiet at or below the reach', () => {
    expect(
      unreachableThresholdHint(
        binding({ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }),
        nav({}),
      ),
    ).toBeNull();
    expect(
      unreachableThresholdHint(
        binding({ kind: 'magnitude', source: 'tilt', threshold: 40 }),
        nav({}),
      ),
    ).toBeNull();
  });

  it('reckons the reach from the firmest navigation gesture (drill/back/cycle)', () => {
    const navigation = nav({
      drillIn: { inputs: [{ kind: 'magnitude', source: 'lateral', threshold: 220 }] },
    });
    // reference now 220, so a 200 commit is reachable.
    expect(
      unreachableThresholdHint(
        binding({ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 200 }),
        navigation,
      ),
    ).toBeNull();
  });

  it('returns null for a binding with no analog threshold (button-only / empty / absent)', () => {
    expect(unreachableThresholdHint(binding({ kind: 'button', button: 1 }), nav({}))).toBeNull();
    expect(unreachableThresholdHint(binding(), nav({}))).toBeNull();
    expect(unreachableThresholdHint(undefined, nav({}))).toBeNull();
  });
});

describe('inputConflict / gestureConflicts', () => {
  // The default back is TZ both at threshold 50 (the nav() helper). A centre
  // commit on TZ− shares that input; commit has the higher runtime priority, so
  // the conflict is owned by commit's row.
  const tzNeg = (threshold: number): InputBinding =>
    ({ kind: 'axis', axis: 'tz', direction: 'negative', threshold }) as const;

  it('flags the higher-priority gesture when it is not set to fire first', () => {
    // commit at 200 does not reach before back at 50, so back wins; commit's
    // row carries the conflict, naming back and the threshold to drop below.
    const navigation = nav({ commitCenter: { inputs: [tzNeg(200)] } });
    const c = inputConflict('commitCenter', tzNeg(200), navigation);
    expect(c?.gestures).toEqual(['Go back']);
    expect(c?.trigger).toContain('Press down');
    expect(c?.fix).toMatch(/below 50/);
    // The lower-priority rival's own row stays quiet (no nagging the nav side).
    expect(gestureConflicts('back', navigation)).toEqual([]);
  });

  it('clears live once the gesture is set to fire first (strictly below the rival)', () => {
    const navigation = nav({ commitCenter: { inputs: [tzNeg(40)] } }); // 40 < back 50
    expect(inputConflict('commitCenter', tzNeg(40), navigation)).toBeNull();
    expect(gestureConflicts('commitCenter', navigation)).toEqual([]);
  });

  it('still flags at an equal threshold (priority there is only implicit)', () => {
    const navigation = nav({ commitCenter: { inputs: [tzNeg(50)] } }); // equal to back 50
    expect(inputConflict('commitCenter', tzNeg(50), navigation)?.gestures).toEqual(['Go back']);
  });

  it('pins to the specific input and ignores a non-colliding one', () => {
    const navigation = nav({
      commitCenter: { inputs: [tzNeg(200), { kind: 'button', button: 0 }] },
    });
    expect(inputConflict('commitCenter', { kind: 'button', button: 0 }, navigation)).toBeNull();
    expect(inputConflict('commitCenter', tzNeg(200), navigation)?.gestures).toEqual(['Go back']);
  });

  it('does not flag activate and commitCenter sharing a button (disjoint by hover state)', () => {
    // activate fires only on a hovered leaf, commitCenter only at the centre, so
    // one button doing both never co-fires. The first-run default relies on this.
    const navigation = nav({
      activate: { inputs: [{ kind: 'button', button: 0 }] },
      commitCenter: { inputs: [{ kind: 'button', button: 0 }] },
    });
    expect(inputConflict('activate', { kind: 'button', button: 0 }, navigation)).toBeNull();
    expect(inputConflict('commitCenter', { kind: 'button', button: 0 }, navigation)).toBeNull();
    expect(gestureConflicts('activate', navigation)).toEqual([]);
    expect(gestureConflicts('commitCenter', navigation)).toEqual([]);
  });

  it('asks for a distinct input on a button clash (no threshold to undercut)', () => {
    const navigation = nav({
      back: { inputs: [{ kind: 'button', button: 1 }] },
      commitCenter: { inputs: [{ kind: 'button', button: 1 }] },
    });
    const c = inputConflict('commitCenter', { kind: 'button', button: 1 }, navigation);
    expect(c?.gestures).toEqual(['Go back']);
    expect(c?.fix).toMatch(/distinct input/);
  });
});

describe('inputConflict: commitCenter + back at a cancel centre (#404)', () => {
  // A directional TZ− back (not the default both) so the pair shares exactly
  // axis:tz:negative; commitCenter outranks back, so the potential conflict is
  // owned by commitCenter's row.
  const tzNeg = (threshold: number): InputBinding =>
    ({ kind: 'axis', axis: 'tz', direction: 'negative', threshold }) as const;
  const staggered = (commit: number, back: number): MenuNavigation =>
    nav({ commitCenter: { inputs: [tzNeg(commit)] }, back: { inputs: [tzNeg(back)] } });

  it('clears at a cancel centre when commitCenter is staggered above back', () => {
    // The reported case: commit 200 above back 150. At a cancel centre back is
    // suppressed where commit fires, so the pairing is runtime-safe.
    const navigation = staggered(200, 150);
    expect(inputConflict('commitCenter', tzNeg(200), navigation, true)).toBeNull();
    expect(gestureConflicts('commitCenter', navigation, true)).toEqual([]);
  });

  it('still flags at a non-cancel centre (back dismisses in the lower band)', () => {
    const navigation = staggered(200, 150);
    // The flag defaults false; back is not suppressed, so commit's row keeps it.
    expect(inputConflict('commitCenter', tzNeg(200), navigation)?.gestures).toEqual(['Go back']);
    expect(inputConflict('commitCenter', tzNeg(200), navigation, false)?.gestures).toEqual([
      'Go back',
    ]);
  });

  it('still flags at a cancel centre when the thresholds are equal (commit not strictly above back)', () => {
    // At a drilled-in centre commit would preempt back at an equal threshold, so
    // the strict-greater guard keeps this flagged even at a cancel centre.
    const navigation = staggered(150, 150);
    expect(inputConflict('commitCenter', tzNeg(150), navigation, true)?.gestures).toEqual([
      'Go back',
    ]);
  });

  it('stays quiet at a cancel centre when commitCenter is below back (the generic rule owns it)', () => {
    // commit below back is already resolved by the generic "owner fires first"
    // rule, independent of the centre; the cancel flag does not change it.
    const navigation = staggered(100, 150);
    expect(inputConflict('commitCenter', tzNeg(100), navigation, true)).toBeNull();
    expect(inputConflict('commitCenter', tzNeg(100), navigation, false)).toBeNull();
  });
});
