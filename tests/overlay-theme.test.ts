// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_PIE_APPEARANCE } from '../src/shared/pie-appearance';
import { buildOverlayTheme } from '../src/core/overlay-theme';
import type { PieAppearance } from '../src/shared/ipc';

const appearance = (patch: Partial<PieAppearance>): PieAppearance => ({
  ...DEFAULT_PIE_APPEARANCE,
  ...patch,
});

describe('buildOverlayTheme', () => {
  it('maps the dark palette to CSS rgb strings', () => {
    const t = buildOverlayTheme(appearance({ theme: 'dark' }));
    expect(t.fill).toBe('rgb(20, 22, 28)');
    expect(t.fillActive).toBe('rgb(80, 110, 180)');
    expect(t.stroke).toBe('rgb(255, 255, 255)');
    expect(t.label).toBe('rgb(240, 240, 240)');
    // The centre disc reuses the idle bg when not a cancel target.
    expect(t.center).toBe(t.fill);
    // Cancel palette: dim-red idle, bright-red active, theme-coloured label.
    expect(t.cancelBg).toBe('rgb(40, 22, 24)');
    expect(t.cancelBgActive).toBe('rgb(180, 80, 80)');
    expect(t.cancelLabel).toBe('rgb(240, 240, 240)');
  });

  it('switches palette with the theme', () => {
    expect(buildOverlayTheme(appearance({ theme: 'light' })).fill).toBe('rgb(245, 246, 249)');
    expect(buildOverlayTheme(appearance({ theme: 'spaceux' })).fillActive).toBe('rgb(0, 120, 170)');
  });

  it('passes opacity, blur, and the font override straight through', () => {
    const t = buildOverlayTheme(appearance({ opacity: 0.42, blur: true, fontUi: 'Cantarell' }));
    expect(t.opacity).toBe(0.42);
    expect(t.blur).toBe(true);
    expect(t.font).toBe('Cantarell');
  });

  it('passes the default blur through and resolves the default font to bundled Inter SemiBold', () => {
    const t = buildOverlayTheme(DEFAULT_PIE_APPEARANCE);
    expect(t.blur).toBe(DEFAULT_PIE_APPEARANCE.blur);
    // The appearance default is '' (bundled sentinel); the renderer bundles the
    // static Inter-SemiBold face (family "Inter SemiBold"), so the payload names
    // it explicitly instead of falling back to the system sans-serif.
    expect(t.font).toBe('Inter SemiBold');
  });

  it('falls back to the dark palette for an unrecognised theme', () => {
    // Past the IPC sanitiser the theme is always valid; guard against a
    // hand-edited settings file that slips an unknown value through.
    const t = buildOverlayTheme(appearance({ theme: 'neon' as PieAppearance['theme'] }));
    expect(t.fill).toBe('rgb(20, 22, 28)');
  });
});
