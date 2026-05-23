// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ICON_SIZE_RATIO, isRenderableIcon } from '../src/core/icon';

describe('isRenderableIcon', () => {
  it('accepts inline image data URIs (the icon pipeline output)', () => {
    expect(isRenderableIcon('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isRenderableIcon('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true);
  });

  it('rejects undefined, empty, and non-image values', () => {
    expect(isRenderableIcon(undefined)).toBe(false);
    expect(isRenderableIcon('')).toBe(false);
    expect(isRenderableIcon('box')).toBe(false); // legacy "theme icon name"
  });

  it('rejects external/non-image URLs so the renderer never fetches them', () => {
    expect(isRenderableIcon('https://evil.example/x.png')).toBe(false);
    expect(isRenderableIcon('file:///etc/passwd')).toBe(false);
    expect(isRenderableIcon('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
  });

  it('keeps the icon size a sane fraction of the pie radius', () => {
    expect(ICON_SIZE_RATIO).toBeGreaterThan(0);
    expect(ICON_SIZE_RATIO).toBeLessThan(0.5);
  });
});
