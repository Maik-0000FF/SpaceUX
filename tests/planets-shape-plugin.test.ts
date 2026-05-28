// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  validateShapeLayout,
  validateShapePluginModule,
  type ShapeRingRadii,
} from '@/shared/shape-plugin-api';

// Import the bundled planets plugin via the same path the host's
// renderer-side runtime would dynamic-import at load time. Vitest's
// ESM resolver loads it as a normal module; the host's contract
// (`layout`, `hitTest`) is what we exercise.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- plain-JS plugin shipped without ambient types
import * as planets from '../extensions/shape/org.spaceux.planets/index.js';

const RING_RADII: ShapeRingRadii = {
  cancelRadius: 30,
  innerInnerRadius: 30,
  innerOuterRadius: 70,
  innerLabelRadius: 50,
  outerInnerRadius: 80,
  outerOuterRadius: 120,
  outerLabelRadius: 100,
};

describe('planets shape plugin module shape', () => {
  it('exports both layout and hitTest as functions (validates against the host contract)', () => {
    expect(validateShapePluginModule(planets)).toBeNull();
  });
});

describe('planets layout()', () => {
  it('returns exactly sectorCount nodes and labels', () => {
    for (const n of [2, 3, 6, 8, 12]) {
      const raw = planets.layout(n, RING_RADII);
      const validated = validateShapeLayout(raw, n);
      expect(validated.ok).toBe(true);
      if (validated.ok) {
        expect(validated.layout.nodes).toHaveLength(n);
        expect(validated.layout.labels).toHaveLength(n);
      }
    }
  });

  it('handles a zero-sector pie (validator requires nodes.length === sectorCount)', () => {
    // The host short-circuits the empty-ring case before calling
    // the plugin, but the contract still says the plugin must
    // produce exactly `sectorCount` entries. A one-node fallback
    // would propagate to any plugin author copying this as a
    // template.
    const raw = planets.layout(0, RING_RADII);
    const validated = validateShapeLayout(raw, 0);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.layout.nodes).toHaveLength(0);
      expect(validated.layout.labels).toHaveLength(0);
    }
  });

  it('handles a single-sector pie (chord-degenerate, ring-thickness cap takes over)', () => {
    const raw = planets.layout(1, RING_RADII);
    const validated = validateShapeLayout(raw, 1);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.layout.nodes).toHaveLength(1);
      // Single planet sits at the top of the orbit, sized by the
      // ring-thickness cap (the chord term degenerates to Infinity at
      // n=1, so Math.min picks the thickness cap).
      const node = validated.layout.nodes[0]!;
      expect(node.cx).toBeCloseTo(0, 5);
      expect(node.cy).toBeCloseTo(-RING_RADII.outerLabelRadius, 5);
      const halfThickness = (RING_RADII.outerOuterRadius - RING_RADII.outerInnerRadius) / 2;
      expect(node.r).toBeLessThanOrEqual(halfThickness);
    }
  });

  it('places sector 0 at "12 o\'clock" (matches the wedge convention so push-forward keeps hovering it)', () => {
    const { nodes } = planets.layout(4, RING_RADII);
    expect(nodes[0]!.cx).toBeCloseTo(0, 5);
    expect(nodes[0]!.cy).toBeCloseTo(-RING_RADII.outerLabelRadius, 5);
  });

  it('lays out clockwise: sector 1 of 4 sits at "3 o\'clock", sector 2 at "6 o\'clock", sector 3 at "9 o\'clock"', () => {
    const { nodes } = planets.layout(4, RING_RADII);
    const r = RING_RADII.outerLabelRadius;
    expect(nodes[1]!.cx).toBeCloseTo(r, 5);
    expect(nodes[1]!.cy).toBeCloseTo(0, 5);
    expect(nodes[2]!.cx).toBeCloseTo(0, 5);
    expect(nodes[2]!.cy).toBeCloseTo(r, 5);
    expect(nodes[3]!.cx).toBeCloseTo(-r, 5);
    expect(nodes[3]!.cy).toBeCloseTo(0, 5);
  });

  it('all planets share one orbit radius (no eccentricity, no per-sector drift)', () => {
    const { nodes } = planets.layout(8, RING_RADII);
    for (const n of nodes) {
      expect(Math.hypot(n.cx, n.cy)).toBeCloseTo(RING_RADII.outerLabelRadius, 5);
    }
  });

  it('keeps neighbouring planets from overlapping at high sector counts', () => {
    const { nodes } = planets.layout(12, RING_RADII);
    // The chord between two adjacent planet centres must be at least
    // 2 * planetRadius (touching is fine, overlap is not). Use the
    // first pair as the representative; all pairs are equidistant on
    // a single orbit.
    const a = nodes[0]!;
    const b = nodes[1]!;
    const chord = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    expect(chord).toBeGreaterThanOrEqual(2 * a.r);
  });

  it('caps planet radius by half the outer ring thickness so a small sector count does not bleed past the band', () => {
    const { nodes } = planets.layout(2, RING_RADII);
    const halfThickness = (RING_RADII.outerOuterRadius - RING_RADII.outerInnerRadius) / 2;
    for (const n of nodes) {
      expect(n.r).toBeLessThanOrEqual(halfThickness);
    }
  });

  it('labels sit at the planet centre with middle anchor (host pairs this with dominant-baseline=middle)', () => {
    const { nodes, labels } = planets.layout(6, RING_RADII);
    for (let i = 0; i < 6; i++) {
      expect(labels[i]!.x).toBeCloseTo(nodes[i]!.cx, 5);
      expect(labels[i]!.y).toBeCloseTo(nodes[i]!.cy, 5);
      expect(labels[i]!.anchor).toBe('middle');
    }
  });
});

describe('planets hitTest()', () => {
  const layout4 = planets.layout(4, RING_RADII);

  it('returns null when the puck is inside the centre / cancel zone', () => {
    expect(planets.hitTest({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4)).toBe(
      null,
    );
    // Just inside cancelRadius from every direction.
    expect(
      planets.hitTest({ tx: 10, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4),
    ).toBe(null);
    expect(
      planets.hitTest({ tx: 0, ty: 10, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4),
    ).toBe(null);
  });

  it('hovers sector 0 (top) when the puck is pushed forward (raw evdev: axes.ty < 0 = screen-up = sector 0)', () => {
    // The host's wedge default uses MenuConfig-level invertY=false
    // (DEFAULT_AXIS_INVERT), so a puck push "forward" lands on
    // axes.ty < 0. The plugin uses the same sign convention so
    // switching from wedge to planets doesn't flip the up/down axis.
    expect(
      planets.hitTest(
        { tx: 0, ty: -RING_RADII.outerLabelRadius, tz: 0, rx: 0, ry: 0, rz: 0 },
        RING_RADII,
        layout4,
      ),
    ).toBe(0);
  });

  it('hovers sector 1 (right) for +tx, sector 2 (down) for +ty, sector 3 (left) for -tx', () => {
    const r = RING_RADII.outerLabelRadius;
    expect(planets.hitTest({ tx: r, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4)).toBe(
      1,
    );
    expect(planets.hitTest({ tx: 0, ty: r, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4)).toBe(
      2,
    );
    expect(
      planets.hitTest({ tx: -r, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4),
    ).toBe(3);
  });

  it('ignores tilt / twist axes (only tx/ty drive selection)', () => {
    // Puck pushed forward at full orbit magnitude, plus arbitrary
    // tilt/twist noise: still picks sector 0.
    const idx = planets.hitTest(
      { tx: 0, ty: -RING_RADII.outerLabelRadius, tz: 500, rx: 250, ry: -300, rz: 400 },
      RING_RADII,
      layout4,
    );
    expect(idx).toBe(0);
  });

  it('breaks the tie deterministically when the puck is equidistant from two adjacent planets', () => {
    // Between sector 0 (top) and sector 1 (right): half-orbit push along
    // the upper-right diagonal in screen-coords (+tx, -ty). Distance to
    // both planets is identical; the loop's tie-breaker (strict-less-than)
    // keeps the first match, so sector 0 wins. Test pins the convention
    // so a future loop rewrite doesn't flip selection direction without
    // notice.
    const r = RING_RADII.outerLabelRadius;
    const diag = r / Math.SQRT2;
    expect(
      planets.hitTest({ tx: diag, ty: -diag, tz: 0, rx: 0, ry: 0, rz: 0 }, RING_RADII, layout4),
    ).toBe(0);
  });

  it('a tiny deflection past the cancel zone already selects a sector (no second deadzone hides the planets)', () => {
    // The plugin gates only on cancelRadius; any push past that picks the
    // nearest planet immediately. Pre-empt a future regression that adds
    // a hidden hover-deadzone on top.
    const justPast = RING_RADII.cancelRadius + 1;
    const idx = planets.hitTest(
      { tx: 0, ty: -justPast, tz: 0, rx: 0, ry: 0, rz: 0 },
      RING_RADII,
      layout4,
    );
    expect(idx).toBe(0);
  });
});
