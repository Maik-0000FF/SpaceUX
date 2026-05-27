// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  clampFontFamily,
  clampPieIconScale,
  clampPieLabelScale,
  clampPieOpacity,
  FONT_FAMILY_MAX_LEN,
  PIE_ICON_SCALE_MAX,
  PIE_ICON_SCALE_MIN,
  PIE_LABEL_SCALE_MAX,
  PIE_LABEL_SCALE_MIN,
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

describe('clampPieLabelScale', () => {
  it('clamps to the label-scale band', () => {
    expect(clampPieLabelScale(5)).toBe(PIE_LABEL_SCALE_MAX);
    expect(clampPieLabelScale(0)).toBe(PIE_LABEL_SCALE_MIN);
    expect(clampPieLabelScale(0.6)).toBe(0.6);
  });
});

describe('clampPieIconScale', () => {
  it('clamps to the icon-scale band', () => {
    expect(clampPieIconScale(9)).toBe(PIE_ICON_SCALE_MAX);
    expect(clampPieIconScale(0)).toBe(PIE_ICON_SCALE_MIN);
    expect(clampPieIconScale(0.6)).toBe(0.6);
  });
});

describe('clampFontFamily', () => {
  it('trims whitespace and keeps an ordinary family string', () => {
    expect(clampFontFamily('  Cantarell, sans-serif  ')).toBe('Cantarell, sans-serif');
  });

  it('keeps an empty string empty (the bundled-default sentinel)', () => {
    expect(clampFontFamily('')).toBe('');
    expect(clampFontFamily('   ')).toBe('');
  });

  it('strips control characters to spaces', () => {
    expect(clampFontFamily('Foo\nBar\tBaz')).toBe('Foo Bar Baz');
  });

  it('caps the length', () => {
    expect(clampFontFamily('x'.repeat(500))).toHaveLength(FONT_FAMILY_MAX_LEN);
  });
});

describe('sanitizePieAppearancePatch', () => {
  it('keeps a valid theme and opacity', () => {
    expect(sanitizePieAppearancePatch({ theme: 'spaceux', opacity: 0.5 })).toEqual({
      theme: 'spaceux',
      opacity: 0.5,
    });
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

  it('keeps + clamps labelScale, drops a non-finite one', () => {
    expect(sanitizePieAppearancePatch({ labelScale: 0.7 })).toEqual({ labelScale: 0.7 });
    expect(sanitizePieAppearancePatch({ labelScale: 9 })).toEqual({
      labelScale: PIE_LABEL_SCALE_MAX,
    });
    expect(sanitizePieAppearancePatch({ labelScale: NaN })).toEqual({});
  });

  it('keeps + clamps iconScale, drops a non-finite one', () => {
    expect(sanitizePieAppearancePatch({ iconScale: 0.6 })).toEqual({ iconScale: 0.6 });
    expect(sanitizePieAppearancePatch({ iconScale: 9 })).toEqual({
      iconScale: PIE_ICON_SCALE_MAX,
    });
    expect(sanitizePieAppearancePatch({ iconScale: NaN })).toEqual({});
  });

  it('keeps + normalises a font override, dropping a non-string one', () => {
    expect(sanitizePieAppearancePatch({ fontUi: '  Cantarell  ' })).toEqual({
      fontUi: 'Cantarell',
    });
    expect(sanitizePieAppearancePatch({ fontMono: 'monospace' })).toEqual({
      fontMono: 'monospace',
    });
    expect(sanitizePieAppearancePatch({ fontUi: '' })).toEqual({ fontUi: '' });
    expect(sanitizePieAppearancePatch({ fontUi: 42 })).toEqual({});
  });

  it('returns an empty patch for non-object input', () => {
    expect(sanitizePieAppearancePatch(null)).toEqual({});
    expect(sanitizePieAppearancePatch('dark')).toEqual({});
    expect(sanitizePieAppearancePatch(42)).toEqual({});
    expect(sanitizePieAppearancePatch(undefined)).toEqual({});
  });

  it('returns an empty patch when no known keys are present', () => {
    expect(sanitizePieAppearancePatch({ blur: 5, foo: 'bar' })).toEqual({});
  });
});
