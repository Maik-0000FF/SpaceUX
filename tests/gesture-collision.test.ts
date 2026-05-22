// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { gestureShadows } from '../src/editor/state/gesture-collision';
import type { GestureBinding, MenuNavigation } from '../src/shared/menu';

const nav = (over: Partial<MenuNavigation>): MenuNavigation => ({
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
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
