// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { inputFromValue, inputThreshold, inputValue } from '../src/editor/state/nav-input';

import type { InputBinding } from '@/shared/menu';

describe('nav-input encode/decode', () => {
  // One representative of every kind; the analog ones carry a threshold.
  const samples: InputBinding[] = [
    { kind: 'none' },
    { kind: 'button', button: 0 },
    { kind: 'button', button: 5 },
    { kind: 'axis', axis: 'tz', direction: 'positive', threshold: 200 },
    { kind: 'axis', axis: 'rz', direction: 'negative', threshold: 120 },
    { kind: 'axis', axis: 'tx', direction: 'both', threshold: 50 },
    { kind: 'magnitude', source: 'lateral', threshold: 250 },
    { kind: 'magnitude', source: 'tilt', threshold: 200 },
  ];

  it('round-trips every input kind through inputValue → inputFromValue', () => {
    for (const input of samples) {
      const decoded = inputFromValue(inputValue(input), inputThreshold(input), 999);
      expect(decoded, inputValue(input)).toEqual(input);
    }
  });

  it('seeds the default threshold for a fresh analog input (no previous)', () => {
    expect(inputFromValue('axis:tz:positive', null, 200)).toEqual({
      kind: 'axis',
      axis: 'tz',
      direction: 'positive',
      threshold: 200,
    });
    expect(inputFromValue('magnitude:lateral', null, 250)).toEqual({
      kind: 'magnitude',
      source: 'lateral',
      threshold: 250,
    });
  });

  it('carries the previous threshold across a kind/direction change', () => {
    // Flipping an axis direction must keep the tuned value, not reset it.
    expect(inputFromValue('axis:tz:negative', 137, 200)).toEqual({
      kind: 'axis',
      axis: 'tz',
      direction: 'negative',
      threshold: 137,
    });
  });

  it('inputThreshold is null for button/none, the value for analog', () => {
    expect(inputThreshold({ kind: 'none' })).toBeNull();
    expect(inputThreshold({ kind: 'button', button: 1 })).toBeNull();
    expect(inputThreshold({ kind: 'axis', axis: 'tz', direction: 'both', threshold: 80 })).toBe(80);
    expect(inputThreshold({ kind: 'magnitude', source: 'tilt', threshold: 90 })).toBe(90);
  });
});
