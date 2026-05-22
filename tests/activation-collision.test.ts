// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { activationCollisions } from '../src/editor/state/activation-collision';
import type { GestureBinding, MenuNavigation } from '../src/shared/menu';

const nav = (over: Partial<MenuNavigation>): MenuNavigation => ({
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  ...over,
});

const act = (...inputs: GestureBinding['inputs']): GestureBinding => ({ inputs });

describe('activationCollisions', () => {
  it('returns nothing for an absent or empty activation', () => {
    expect(activationCollisions(undefined, nav({}))).toEqual([]);
    expect(activationCollisions(act(), nav({}))).toEqual([]);
  });

  it('flags the global back when activation shares its axis (both overlaps a half)', () => {
    // back is TZ both; activating on TZ− shadows it.
    const r = activationCollisions(
      act({ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }),
      nav({}),
    );
    expect(r).toEqual(['Back']);
  });

  it('does not flag a different axis', () => {
    const r = activationCollisions(
      act({ kind: 'axis', axis: 'rx', direction: 'positive', threshold: 50 }),
      nav({}),
    );
    expect(r).toEqual([]);
  });

  it('flags cycle and commit-center by button / axis overlap', () => {
    const r = activationCollisions(
      act(
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
    expect(r).toEqual(
      ['cycle', 'commitCenter'].map((k) => (k === 'cycle' ? 'Cycle' : 'Commit center')),
    );
  });

  it('treats different input kinds as non-colliding', () => {
    // magnitude (tilt) vs an axis back binding: different mechanism.
    const r = activationCollisions(
      act({ kind: 'magnitude', source: 'tilt', threshold: 200 }),
      nav({}),
    );
    expect(r).toEqual([]);
  });
});
