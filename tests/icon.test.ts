// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ICON_MIME, MAX_ICON_BYTES, isRenderableIcon, sanitizeSvg } from '../src/core/icon';

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
});

describe('sanitizeSvg', () => {
  it('strips <script> blocks', () => {
    const dirty = '<svg><script>alert(1)</script><rect/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).toContain('<rect/>');
  });

  it('strips quoted on* event handlers', () => {
    expect(sanitizeSvg('<svg onload="x()"><g onclick=\'y()\'/></svg>')).not.toMatch(/on\w+=/i);
  });

  it('leaves benign markup untouched', () => {
    const svg = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });
});

describe('icon picker constants', () => {
  it('maps the accepted extensions to MIME types', () => {
    expect(ICON_MIME['.svg']).toBe('image/svg+xml');
    expect(ICON_MIME['.png']).toBe('image/png');
    expect(ICON_MIME['.jpg']).toBe('image/jpeg');
    expect(ICON_MIME['.jpeg']).toBe('image/jpeg');
    expect(ICON_MIME['.bmp']).toBeUndefined(); // unsupported → rejected
  });

  it('caps the source size at a sane bound', () => {
    expect(MAX_ICON_BYTES).toBeGreaterThan(0);
    expect(MAX_ICON_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});
