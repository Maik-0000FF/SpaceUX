// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  clampPieBlur,
  clampPieOpacity,
  PIE_BLUR_MAX,
  PIE_BLUR_MIN,
  PIE_OPACITY_MAX,
  PIE_OPACITY_MIN,
  sanitizePieAppearancePatch,
} from '../src/shared/pie-appearance';

describe('clampPieOpacity', () => {
  it('clamps to the [MIN, MAX] band', () => {
    expect(clampPieOpacity(5)).toBe(PIE_OPACITY_MAX);
    expect(clampPieOpacity(-1)).toBe(PIE_OPACITY_MIN);
    expect(clampPieOpacity(0.42)).toBe(0.42);
  });
});

describe('clampPieBlur', () => {
  it('clamps to the [MIN, MAX] band', () => {
    expect(clampPieBlur(99)).toBe(PIE_BLUR_MAX);
    expect(clampPieBlur(-3)).toBe(PIE_BLUR_MIN);
    expect(clampPieBlur(2.5)).toBe(2.5);
  });
});

describe('sanitizePieAppearancePatch', () => {
  it('keeps a valid theme, opacity and blur', () => {
    expect(sanitizePieAppearancePatch({ theme: 'spaceux', opacity: 0.5, blur: 4 })).toEqual({
      theme: 'spaceux',
      opacity: 0.5,
      blur: 4,
    });
  });

  it('clamps an out-of-range blur and drops a non-finite one', () => {
    expect(sanitizePieAppearancePatch({ blur: 99 })).toEqual({ blur: PIE_BLUR_MAX });
    expect(sanitizePieAppearancePatch({ blur: -1 })).toEqual({ blur: PIE_BLUR_MIN });
    expect(sanitizePieAppearancePatch({ blur: NaN })).toEqual({});
  });

  it('keeps only the valid field of a mixed patch', () => {
    expect(sanitizePieAppearancePatch({ theme: 'neon', opacity: 0.3 })).toEqual({ opacity: 0.3 });
    expect(sanitizePieAppearancePatch({ theme: 'light', opacity: 'x' })).toEqual({
      theme: 'light',
    });
  });

  it('clamps an out-of-range opacity', () => {
    expect(sanitizePieAppearancePatch({ opacity: 5 })).toEqual({ opacity: PIE_OPACITY_MAX });
    expect(sanitizePieAppearancePatch({ opacity: -2 })).toEqual({ opacity: PIE_OPACITY_MIN });
  });

  it('drops a non-finite opacity', () => {
    expect(sanitizePieAppearancePatch({ opacity: NaN })).toEqual({});
    expect(sanitizePieAppearancePatch({ opacity: Infinity })).toEqual({});
  });

  it('returns an empty patch for non-object input', () => {
    expect(sanitizePieAppearancePatch(null)).toEqual({});
    expect(sanitizePieAppearancePatch('dark')).toEqual({});
    expect(sanitizePieAppearancePatch(42)).toEqual({});
    expect(sanitizePieAppearancePatch(undefined)).toEqual({});
  });

  it('returns an empty patch when no known keys are present', () => {
    expect(sanitizePieAppearancePatch({ foo: 'bar', baz: 1 })).toEqual({});
  });
});
