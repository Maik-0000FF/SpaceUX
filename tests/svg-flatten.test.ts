// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { flattenIconDataUri, flattenIconSvg } from '../src/core/svg-flatten';

const svgUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

// A real Breeze icon shape: <style> colour scheme + class + fill="currentColor".
const breeze = `<?xml version="1.0"?>
<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <style id="current-color-scheme" type="text/css">.ColorScheme-Text { color: #fcfcfc; }</style>
  <g class="ColorScheme-Text" fill="currentColor">
    <path d="m8 2-4 4v4l4 4h1v-12z"/>
  </g>
</svg>`;

describe('flattenIconSvg', () => {
  it('flattens a Breeze icon: resolves currentColor, drops style + class', () => {
    const out = flattenIconSvg(breeze, 's0');
    expect(out).not.toBeNull();
    expect(out!.viewBox).toEqual([0, 0, 16, 16]);
    // currentColor became the explicit scheme colour…
    expect(out!.inner).toContain('fill="#fcfcfc"');
    // …and the CSS indirection is gone (no <style>, no class, no currentColor).
    expect(out!.inner).not.toContain('<style');
    expect(out!.inner).not.toContain('class=');
    expect(out!.inner.toLowerCase()).not.toContain('currentcolor');
    expect(out!.inner).toContain('<path');
  });

  it('flattens an explicit-fill icon with shapes + transforms', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <g transform="translate(1 1)"><circle cx="12" cy="12" r="9" fill="#4c5263"/>
      <rect x="1" y="1" width="4" height="4" fill="#fff"/></g></svg>`;
    const out = flattenIconSvg(svg, 's1');
    expect(out).not.toBeNull();
    expect(out!.viewBox).toEqual([0, 0, 24, 24]);
    expect(out!.inner).toContain('<circle');
    expect(out!.inner).toContain('transform="translate(1 1)"');
  });

  it('skips the xml declaration, DOCTYPE, and comments without bailing', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/svg.dtd">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <!-- generator comment --><rect width="8" height="8" fill="#000"/><!-- trailing --></svg>`;
    const out = flattenIconSvg(svg, 'x');
    expect(out).not.toBeNull();
    expect(out!.inner).toContain('<rect');
    expect(out!.inner).not.toContain('<!--');
  });

  it('derives the viewBox from width/height when none is given', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect width="32" height="32" fill="#000"/></svg>`;
    expect(flattenIconSvg(svg, 's2')!.viewBox).toEqual([0, 0, 32, 32]);
  });

  it('namespaces ids so two icons cannot collide on url(#…)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
      <rect width="10" height="10" fill="url(#g)"/></svg>`;
    const a = flattenIconSvg(svg, 'aa')!;
    const b = flattenIconSvg(svg, 'bb')!;
    expect(a.inner).toContain('id="iaa-g"');
    expect(a.inner).toContain('url(#iaa-g)');
    expect(b.inner).toContain('id="ibb-g"');
    // The two namespaced fragments share no id.
    expect(a.inner).not.toContain('ibb-g');
  });

  it('resolves currentColor per class for a multi-colour icon', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <style>.ColorScheme-Text { color:#d3dae3; } .ColorScheme-Highlight { color:#5294e2; }</style>
      <path class="ColorScheme-Text" fill="currentColor" d="M0 0h8v8H0z"/>
      <path class="ColorScheme-Highlight" fill="currentColor" d="M8 8h8v8H8z"/></svg>`;
    const out = flattenIconSvg(svg, 's3')!;
    expect(out.inner).toContain('fill="#d3dae3"');
    expect(out.inner).toContain('fill="#5294e2"');
  });

  it('inherits the parent class colour for a currentColor child', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <style>.ColorScheme-Text { color:#abcdef; }</style>
      <g class="ColorScheme-Text"><path fill="currentColor" d="M0 0h8v8H0z"/></g></svg>`;
    expect(flattenIconSvg(svg, 's4')!.inner).toContain('fill="#abcdef"');
  });

  it('resolves currentColor inside an inline style attribute', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <style>.c { color:#112233; }</style>
      <path class="c" style="fill:currentColor" d="M0 0h8v8H0z"/></svg>`;
    expect(flattenIconSvg(svg, 's5')!.inner).toContain('fill:#112233');
  });

  describe('falls back to null (safe <image> path) when not safely flattenable', () => {
    it('on a <script> element', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <script>alert(1)</script><rect width="8" height="8"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on an unknown/disallowed element (e.g. foreignObject, text)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <text x="0" y="8">hi</text></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on an inline event handler', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <rect width="8" height="8" onload="alert(1)"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on an external href (e.g. <use> referencing off-document)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <use href="https://evil/x.svg#a"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on currentColor with no resolvable colour', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <rect width="8" height="8" fill="currentColor"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on a missing/invalid viewBox and no size', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on class-based paint we cannot reproduce (e.g. <style> sets fill)', () => {
      // Dropping a class-set fill would render the icon black, worse than the
      // <image> fallback — so bail instead of rendering it wrong.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <style>.c { fill:#ff0000; }</style><path class="c" d="M0 0h8v8H0z"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });

    it('on an external url(...) paint reference (outbound fetch)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
        <rect width="8" height="8" fill="url(http://evil/x)"/></svg>`;
      expect(flattenIconSvg(svg, 'x')).toBeNull();
    });
  });
});

describe('flattenIconDataUri', () => {
  it('decodes a base64 svg data URI and flattens it', () => {
    const out = flattenIconDataUri(svgUri(breeze), 'c');
    expect(out).not.toBeNull();
    expect(out!.inner).toContain('fill="#fcfcfc"');
  });

  it('returns null for a raster (non-svg) data URI', () => {
    expect(flattenIconDataUri('data:image/png;base64,iVBORw0KGgo=', 'c')).toBeNull();
  });

  it('returns null for a non-data-URI string', () => {
    expect(flattenIconDataUri('https://example/icon.svg', 'c')).toBeNull();
  });
});
