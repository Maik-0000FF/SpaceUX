// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { buildOverlaySvgScene, pieSvgAppearanceOf } from '../src/core/overlay-svg';
import { OVERLAY_FOOTPRINT } from '../src/core/overlay-scene';
import { pieWindowExtent, ringRadii } from '../src/core/pie-geometry';
import { DEFAULT_PIE_APPEARANCE } from '../src/shared/pie-appearance';
import { DEFAULT_MENU_CONFIG } from '../src/shared/menu';
import type { PieAppearance } from '../src/shared/ipc';
import type { MenuConfig, MenuNode } from '../src/shared/menu';
import type { ShapePluginModule } from '../src/shared/shape-plugin-api';

const leaf = (label: string): MenuNode => ({ label });
const branch = (label: string, branches: MenuNode[]): MenuNode => ({ label, branches });
const cfg = (branches: MenuNode[]): MenuConfig => ({
  ...DEFAULT_MENU_CONFIG,
  root: { label: '', branches },
});
const appAt = (scale: number): PieAppearance => ({ ...DEFAULT_PIE_APPEARANCE, scale });

// The full reference window (pie-scale 1): the SVG viewBox spans this.
const WINDOW_HALF = pieWindowExtent(
  OVERLAY_FOOTPRINT,
  ringRadii(OVERLAY_FOOTPRINT, 0.5, 0.5).outerOuter,
);

const build = (
  config: MenuConfig,
  nav: readonly number[],
  active: number | null,
  scale = 1,
): ReturnType<typeof buildOverlaySvgScene> =>
  buildOverlaySvgScene(config, nav, active, appAt(scale));

describe('buildOverlaySvgScene', () => {
  it('returns the pie as an <svg> string plus positive extent and displaySize', () => {
    const scene = build(cfg([leaf('A'), leaf('B')]), [], null);
    expect(scene.svg.startsWith('<svg')).toBe(true);
    expect(scene.svg).toContain('viewBox=');
    expect(scene.extent).toBeGreaterThan(0);
    expect(scene.displaySize).toBeGreaterThan(0);
  });

  it('maps the viewBox window to displaySize = 2 * windowHalf * pieScale', () => {
    expect(build(cfg([leaf('A')]), [], null, 1).displaySize).toBeCloseTo(2 * WINDOW_HALF);
    expect(build(cfg([leaf('A')]), [], null, 1.5).displaySize).toBeCloseTo(2 * WINDOW_HALF * 1.5);
  });

  it('keeps the frosted extent inside the display window, and scales it with pieScale', () => {
    const one = build(cfg([leaf('A'), leaf('B')]), [], null, 1);
    const two = build(cfg([leaf('A'), leaf('B')]), [], null, 2);
    // The frosted radius is within the visible window (the marker/dot reserve).
    expect(one.extent).toBeLessThan(one.displaySize / 2);
    // Pie-size doubles the surface-space extent.
    expect(two.extent).toBeCloseTo(one.extent * 2);
  });

  it('grows the frosted extent when a preview opens the outer band (#324)', () => {
    const config = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    const idle = build(config, [], null).extent;
    const previewing = build(config, [], 0).extent;
    expect(previewing).toBeGreaterThan(idle);
  });

  it('bakes the hovered highlight into the svg (a different string per active sector)', () => {
    const config = cfg([leaf('A'), leaf('B')]);
    const none = build(config, [], null).svg;
    const first = build(config, [], 0).svg;
    expect(first).not.toBe(none); // hover is part of the graphic, not a side channel
  });

  it('carries native-label descriptors out of the SVG (labels[], viewBoxSize, fontFamily)', () => {
    const scene = build(cfg([leaf('A'), leaf('B')]), [], null);
    // The labels live as descriptors, NOT as <text> in the SVG (the QML overlay
    // renders them natively for sharpness).
    expect(scene.svg).not.toContain('<text');
    expect(scene.labels.map((l) => l.text).sort()).toEqual(['A', 'B', '✕']); // A, B + centre ✕
    // viewBoxSize matches the reference window the SVG viewBox spans.
    expect(scene.viewBoxSize).toBeCloseTo(2 * WINDOW_HALF);
    expect(scene.fontFamily).toBe('Inter SemiBold');
    for (const l of scene.labels) {
      expect(l.fontPx).toBeGreaterThan(0);
      expect(typeof l.color).toBe('string');
    }
  });

  it('keeps label coords in viewBox units, not scaled by pieScale', () => {
    const at1 = build(cfg([leaf('A')]), [], null, 1);
    const at2 = build(cfg([leaf('A')]), [], null, 2);
    // displaySize changes with scale, but the label descriptors do not (the
    // QML side applies the viewBox-to-surface scale itself).
    expect(at2.displaySize).not.toBeCloseTo(at1.displaySize);
    expect(at2.viewBoxSize).toBeCloseTo(at1.viewBoxSize);
    const a1 = at1.labels.find((l) => l.text === 'A')!;
    const a2 = at2.labels.find((l) => l.text === 'A')!;
    expect(a2.x).toBeCloseTo(a1.x);
    expect(a2.y).toBeCloseTo(a1.y);
    expect(a2.fontPx).toBeCloseTo(a1.fontPx);
  });
});

describe('buildOverlaySvgScene blur wedges (#47 PR2)', () => {
  const modern = (
    config: MenuConfig,
    nav: readonly number[],
    active: number | null,
    gapStyle: 'parallel' | 'wedge' = 'parallel',
  ): ReturnType<typeof buildOverlaySvgScene> =>
    buildOverlaySvgScene(config, nav, active, {
      ...DEFAULT_PIE_APPEARANCE,
      wedgeStyle: 'modern',
      wedgeGapStyle: gapStyle,
    });

  it('omits blurWedges for the classic style', () => {
    expect(build(cfg([leaf('A'), leaf('B')]), [], null).blurWedges).toBeUndefined();
  });

  it('emits one polygon per wedge plus the centre disc for the modern style', () => {
    const scene = modern(cfg([leaf('A'), leaf('B'), leaf('C')]), [], null);
    expect(scene.blurWedges).toBeDefined();
    // three inner wedges + the centre disc
    expect(scene.blurWedges).toHaveLength(4);
    for (const poly of scene.blurWedges ?? []) {
      // a non-empty flat [x0, y0, ...] in viewBox coords, inside the window
      expect(poly.length).toBeGreaterThan(0);
      expect(poly.length % 2).toBe(0);
      for (const v of poly) expect(Math.abs(v)).toBeLessThanOrEqual(WINDOW_HALF + 1);
    }
  });

  it('adds the outer-band wedges once a preview opens them', () => {
    const config = cfg([branch('A', [leaf('A1'), leaf('A2')]), leaf('B')]);
    const top = modern(config, [], null).blurWedges?.length ?? 0; // 2 inner + centre
    const previewing = modern(config, [], 0).blurWedges?.length ?? 0; // + outer band
    expect(previewing).toBeGreaterThan(top);
  });

  it('differs between the parallel and wedge gap shapes', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    const par = JSON.stringify(modern(config, [], null, 'parallel').blurWedges);
    const wed = JSON.stringify(modern(config, [], null, 'wedge').blurWedges);
    expect(par).not.toBe(wed);
  });

  it('omits blurWedges when a shape plugin renders the bands', () => {
    // A trivial shape module turns both bands into nodes, so no wedges are
    // emitted and the daemon keeps its single circular region.
    const shape: ShapePluginModule = {
      layout: (count: number) => ({
        nodes: Array.from({ length: count }, () => ({ cx: 0, cy: 0, r: 1 })),
        labels: Array.from({ length: count }, () => ({ x: 0, y: 0, anchor: 'middle' as const })),
      }),
      hitTest: () => null,
    };
    const scene = buildOverlaySvgScene(
      cfg([leaf('A'), leaf('B')]),
      [],
      null,
      { ...DEFAULT_PIE_APPEARANCE, wedgeStyle: 'modern' },
      shape,
    );
    expect(scene.blurWedges).toBeUndefined();
  });
});

describe('buildOverlaySvgScene hit model (#457 editor drill)', () => {
  // The hit bands use the SAME radii the SVG was drawn from, so resolve them
  // from the appearance `build` actually passes (its balance sliders), not the
  // 0.5 midpoint.
  const RR = ringRadii(
    OVERLAY_FOOTPRINT,
    DEFAULT_PIE_APPEARANCE.ringBalance,
    DEFAULT_PIE_APPEARANCE.centerBalance,
  );

  it('models the active ring at the top level: branch flags, no breadcrumb', () => {
    const scene = build(cfg([leaf('A'), branch('B', [leaf('B1')]), leaf('C')]), [], null);
    expect(scene.hit.breadcrumb).toBeNull();
    expect(scene.hit.active.count).toBe(3);
    expect(scene.hit.active.rotation).toBe(0);
    expect(scene.hit.active.branch).toEqual([false, true, false]);
    // The top-level active ring is the visible inner pie (centre hole → inner
    // rim), so a click only registers on a drawn wedge, not the empty annulus.
    expect(scene.hit.active.r0).toBeCloseTo(RR.cancel);
    expect(scene.hit.active.r1).toBeCloseTo(RR.innerOuter);
  });

  it('once drilled: active ring = the submenu (outer band), breadcrumb = the parent (inner band)', () => {
    const config = cfg([branch('B', [leaf('B1'), branch('B2', [leaf('x')])])]);
    const scene = build(config, [0], null);
    // Active = B's children, on the outer band, with B2 marked drillable.
    expect(scene.hit.active.count).toBe(2);
    expect(scene.hit.active.branch).toEqual([false, true]);
    expect(scene.hit.active.r0).toBeCloseTo(RR.outerInner);
    expect(scene.hit.active.r1).toBeCloseTo(RR.outerOuter);
    // Breadcrumb = the top-level ring on the inner band.
    expect(scene.hit.breadcrumb).not.toBeNull();
    expect(scene.hit.breadcrumb!.count).toBe(1);
    expect(scene.hit.breadcrumb!.branch).toEqual([true]);
    expect(scene.hit.breadcrumb!.r0).toBeCloseTo(RR.cancel);
    expect(scene.hit.breadcrumb!.r1).toBeCloseTo(RR.innerOuter);
  });
});

describe('pieSvgAppearanceOf', () => {
  it('carries the graphic inputs through and falls back the font to Inter SemiBold', () => {
    const a = pieSvgAppearanceOf({ ...DEFAULT_PIE_APPEARANCE, fontUi: '' });
    expect(a.fontFamily).toBe('Inter SemiBold');
    expect(a.theme).toBe(DEFAULT_PIE_APPEARANCE.theme);
    expect(a.showSubmenuMarkers).toBe(DEFAULT_PIE_APPEARANCE.showSubmenuMarkers);
    expect(a.showDepthDots).toBe(DEFAULT_PIE_APPEARANCE.showDepthDots);
  });

  it('passes a user font override through verbatim', () => {
    const a = pieSvgAppearanceOf({ ...DEFAULT_PIE_APPEARANCE, fontUi: 'Cantarell, sans-serif' });
    expect(a.fontFamily).toBe('Cantarell, sans-serif');
  });
});

describe('buildOverlaySvgScene shape forwarding (#325)', () => {
  // Place the single node at a distinctive coordinate so the test can prove the
  // module reached buildPieSvg (the wedge path never emits cx="12.5").
  const shape: ShapePluginModule = {
    layout: (sectorCount) => ({
      nodes: Array.from({ length: sectorCount }, () => ({ cx: 12.5, cy: 0, r: 7 })),
      labels: Array.from({ length: sectorCount }, () => ({ x: 12.5, y: 20, anchor: 'middle' })),
    }),
    hitTest: () => 0,
  };

  it('forwards the shape module so the overlay SVG renders plugin nodes', () => {
    const config = cfg([leaf('A')]);
    const withShape = buildOverlaySvgScene(config, [], null, DEFAULT_PIE_APPEARANCE, shape);
    const noShape = buildOverlaySvgScene(config, [], null, DEFAULT_PIE_APPEARANCE);
    expect(withShape.svg).toContain('cx="12.5"');
    expect((withShape.svg.match(/<path/g) ?? []).length).toBe(0); // nodes, not wedges
    expect((noShape.svg.match(/<path/g) ?? []).length).toBe(1); // wedge default
  });

  it('keeps the wedge default when no shape is passed', () => {
    const scene = buildOverlaySvgScene(cfg([leaf('A')]), [], null, DEFAULT_PIE_APPEARANCE);
    expect(scene.svg).not.toContain('cx="12.5"');
  });
});
