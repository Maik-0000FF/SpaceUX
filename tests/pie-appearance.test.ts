// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  clampFontFamily,
  clampPieBalance,
  clampPieIconScale,
  clampPieLabelScale,
  clampPieOpacity,
  clampShapeModel,
  FONT_FAMILY_MAX_LEN,
  PIE_BALANCE_MAX,
  PIE_BALANCE_MIN,
  PIE_ICON_SCALE_MAX,
  PIE_ICON_SCALE_MIN,
  PIE_LABEL_SCALE_MAX,
  PIE_LABEL_SCALE_MIN,
  PIE_OPACITY_MAX,
  PIE_OPACITY_MIN,
  SHAPE_MODEL_MAX_LEN,
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

describe('clampPieBalance', () => {
  it('clamps to the [0, 1] band', () => {
    expect(clampPieBalance(5)).toBe(PIE_BALANCE_MAX);
    expect(clampPieBalance(-1)).toBe(PIE_BALANCE_MIN);
    expect(clampPieBalance(0.5)).toBe(0.5);
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

  it('strips control characters (C0, DEL, C1) to spaces', () => {
    expect(clampFontFamily('Foo\u007fBar\u0080Baz')).toBe('Foo Bar Baz');
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

  it('keeps + clamps the balance sliders, dropping a non-finite one', () => {
    expect(sanitizePieAppearancePatch({ ringBalance: 0.3, centerBalance: 0.7 })).toEqual({
      ringBalance: 0.3,
      centerBalance: 0.7,
    });
    expect(sanitizePieAppearancePatch({ ringBalance: 9 })).toEqual({
      ringBalance: PIE_BALANCE_MAX,
    });
    expect(sanitizePieAppearancePatch({ centerBalance: NaN })).toEqual({});
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

  it('accepts null shapeModel (the wedge default)', () => {
    expect(sanitizePieAppearancePatch({ shapeModel: null })).toEqual({ shapeModel: null });
  });

  it('accepts a non-empty shapeModel string', () => {
    expect(sanitizePieAppearancePatch({ shapeModel: 'org.example.shape/planets' })).toEqual({
      shapeModel: 'org.example.shape/planets',
    });
  });

  it('folds blank-only shapeModel strings to null', () => {
    // An empty or whitespace-only string is meaningless; sanitizer
    // collapses it to the wedge default rather than persisting an empty
    // override that would never resolve.
    expect(sanitizePieAppearancePatch({ shapeModel: '' })).toEqual({ shapeModel: null });
    expect(sanitizePieAppearancePatch({ shapeModel: '   ' })).toEqual({ shapeModel: null });
  });

  it('drops a non-string / non-null shapeModel from the patch', () => {
    // Anything that isn't `string | null` is dropped (matches the
    // pattern other fields use: invalid types disappear from the patch
    // rather than being coerced).
    expect(sanitizePieAppearancePatch({ shapeModel: 42 })).toEqual({});
    expect(sanitizePieAppearancePatch({ shapeModel: false })).toEqual({});
    expect(sanitizePieAppearancePatch({ shapeModel: { id: 'x' } })).toEqual({});
  });
});

describe('clampShapeModel', () => {
  it('passes null through unchanged (the wedge default sentinel)', () => {
    expect(clampShapeModel(null)).toBeNull();
  });

  it('keeps a non-empty trimmed string', () => {
    expect(clampShapeModel('org.example.shape/planets')).toBe('org.example.shape/planets');
    expect(clampShapeModel('  org.example.shape/planets  ')).toBe('org.example.shape/planets');
  });

  it('folds blank / whitespace-only / control-char-only strings to null', () => {
    expect(clampShapeModel('')).toBeNull();
    expect(clampShapeModel('   ')).toBeNull();
    expect(clampShapeModel('\u0000\u0001')).toBeNull();
  });

  it('caps overly long ids', () => {
    expect(clampShapeModel('x'.repeat(500))).toHaveLength(SHAPE_MODEL_MAX_LEN);
  });

  it('returns null for non-string non-null inputs', () => {
    expect(clampShapeModel(42)).toBeNull();
    expect(clampShapeModel(undefined)).toBeNull();
    expect(clampShapeModel({ id: 'x' })).toBeNull();
  });
});
