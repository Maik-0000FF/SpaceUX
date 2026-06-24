// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * SVG path builders for the radial menu.
 *
 * Sits in `src/core/` next to `pie-geometry.ts` so the functions can be
 * exercised in node with vitest: they emit strings, not DOM, and pinning the
 * exact path output is the cheapest way to catch a wrong `largeArc` flag or a
 * swapped sweep direction.
 *
 * Angle convention is the same as `pie-geometry.ts`: radians,
 * 12 o'clock = 0, clockwise positive. Callers convert to screen
 * coordinates inside this module so the renderer stays declarative.
 */

/** Cap on the perpendicular gap offset as a fraction of the radius before
 *  `Math.asin`: keeping `d / R` below 1 keeps `asin(d / R)` defined. Shared by
 *  the parallel gap here and the radial gap in `pie-svg` so the bound can't
 *  drift between the two. */
export const ASIN_DOMAIN_CAP = 0.9;

/** Clamp `v` to `[-lim, lim]`. The gap offset can be NEGATIVE for a hovered
 *  wedge (its sides grow out past their separators), so the asin input must be
 *  bounded on both sides, not just the upper one, to keep `asin(d / r)` defined
 *  when the popped inner radius gets small. */
export function clampAbs(v: number, lim: number): number {
  return Math.max(-lim, Math.min(lim, v));
}

/**
 * Build the SVG path for one annular (donut-slice) wedge from angle a
 * to angle b. The path traces the inner edge, lines out to the outer
 * arc, sweeps the outer arc, lines back to the inner edge, and sweeps
 * the inner arc *in reverse* — that reversal is what produces the hole
 * in the middle instead of two stacked filled pies.
 *
 * The `largeArc` flag is set when the sweep exceeds π so half-pies
 * still render correctly. The comparison is strict (`> π`, not `>=`),
 * which means a sweep of exactly π (a two-sector half-pie) still uses
 * `largeArc = 0`. SVG's small/large arc resolution is unambiguous at
 * exactly π, so either flag would draw the same arc — strict-greater
 * keeps the typical-case (0) path for the boundary.
 */
export function describeWedgePath(rOuter: number, rInner: number, a: number, b: number): string {
  const sweep = b - a;
  // Full-circle "wedge" (sectorCount=1, e.g. an outer ring whose
  // hovered branch has a single child): the regular path's start
  // and end points coincide, the SVG arc collapses to a no-op, and
  // the rendered shape degenerates to a radial line. Emit a donut
  // (two concentric circles, inner one punched out via
  // fill-rule: evenodd) so a 1-sector ring renders as a ring rather
  // than a stripe. Threshold is "almost 2π" so floating-point
  // accumulation doesn't accidentally miss it.
  if (sweep >= 2 * Math.PI - 1e-9) {
    return (
      `M ${rOuter} 0 ` +
      `A ${rOuter} ${rOuter} 0 1 1 ${-rOuter} 0 ` +
      `A ${rOuter} ${rOuter} 0 1 1 ${rOuter} 0 ` +
      `Z ` +
      `M ${rInner} 0 ` +
      `A ${rInner} ${rInner} 0 1 1 ${-rInner} 0 ` +
      `A ${rInner} ${rInner} 0 1 1 ${rInner} 0 ` +
      `Z`
    );
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const sinA = Math.sin(a);
  const cosA = Math.cos(a);
  const sinB = Math.sin(b);
  const cosB = Math.cos(b);
  const oax = (sinA * rOuter).toFixed(3);
  const oay = (-cosA * rOuter).toFixed(3);
  const obx = (sinB * rOuter).toFixed(3);
  const oby = (-cosB * rOuter).toFixed(3);
  const iax = (sinA * rInner).toFixed(3);
  const iay = (-cosA * rInner).toFixed(3);
  const ibx = (sinB * rInner).toFixed(3);
  const iby = (-cosB * rInner).toFixed(3);
  return (
    `M ${iax} ${iay} ` +
    `L ${oax} ${oay} ` +
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${obx} ${oby} ` +
    `L ${ibx} ${iby} ` +
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iax} ${iay} ` +
    `Z`
  );
}

/**
 * Build the SVG path for one "modern" wedge (#47): like {@link describeWedgePath}
 * but with a constant-width PARALLEL gap to each neighbour instead of a radial
 * edge. Each side edge is a straight line parallel to its separator radial,
 * offset toward the wedge interior by the perpendicular distance `gap / 2`. A
 * line at perpendicular distance d from the centre meets a circle of radius R at
 * the angular offset `asin(d / R)` from the radial it is parallel to, so the
 * outer/inner circle hits are the straight edge's endpoints; sampling the arcs
 * between those offset angles yields the closed gapped wedge. The channel between
 * two adjacent wedges is then a constant `gap` wide at every radius, not the
 * triangle a plain angular gap would widen into.
 *
 * `gap` is in the same units as the radii (the reference footprint). It is
 * clamped to {@link ASIN_DOMAIN_CAP} of the inner radius so the offset never
 * exceeds it (`asin` domain). With the bounded gap slider (a small footprint
 * fraction) the side edges stay well inside the sector, so the wedge can't
 * invert at realistic radii and sector counts. A near-full-circle sweep (a
 * 1-sector ring) has no neighbour to gap against and delegates to
 * {@link describeWedgePath}.
 */
export function describeModernWedgePath(
  rOuter: number,
  rInner: number,
  a: number,
  b: number,
  gap: number,
): string {
  const sweep = b - a;
  if (sweep >= 2 * Math.PI - 1e-9) return describeWedgePath(rOuter, rInner, a, b);
  // Half the gap, bounded by the inner radius so asin(d / rInner) is defined
  // (the gap can be negative for a hovered wedge growing past its separators).
  const d = clampAbs(gap / 2, rInner * ASIN_DOMAIN_CAP);
  const offOuter = Math.asin(d / rOuter);
  const offInner = Math.asin(d / rInner);
  // Pull each side edge inward by its angular offset (interior is between a, b).
  const aOutLo = a + offOuter;
  const aOutHi = b - offOuter;
  const aInLo = a + offInner;
  const aInHi = b - offInner;
  const point = (r: number, ang: number): [string, string] => [
    (Math.sin(ang) * r).toFixed(3),
    (-Math.cos(ang) * r).toFixed(3),
  ];
  const [oalx, oaly] = point(rOuter, aOutLo);
  const [oahx, oahy] = point(rOuter, aOutHi);
  const [ialx, ialy] = point(rInner, aInLo);
  const [iahx, iahy] = point(rInner, aInHi);
  const largeArc = aOutHi - aOutLo > Math.PI ? 1 : 0;
  return (
    `M ${ialx} ${ialy} ` +
    `L ${oalx} ${oaly} ` +
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oahx} ${oahy} ` +
    `L ${iahx} ${iahy} ` +
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ialx} ${ialy} ` +
    `Z`
  );
}

// Round to 3 decimals, matching the path builders' toFixed(3), so the sampled
// blur polygon and the painted fill share the SAME vertex coordinates (no
// rounding divergence between the colour and the frost).
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Sample one modern wedge as an explicit point polygon, for a blur region or a
 * tint fill that cannot carry SVG arcs (a Wayland `wl_region` is rectangles; a
 * QML fill is a polygon). Same geometry {@link describeModernWedgePath} draws:
 * `parallel` offsets each side edge to a line parallel to its separator radial
 * (constant-width gap); `wedge` trims the edges radially (the gap widens toward
 * the rim). Points use the same screen convention as the path builders
 * (`sin·r`, `-cos·r`), flattened to `[x0, y0, x1, y1, ...]` and rounded for a
 * compact wire payload. `segments` is the sample count per arc edge.
 */
export function sampledWedgePolygon(
  rOuter: number,
  rInner: number,
  a: number,
  b: number,
  gap: number,
  gapStyle: 'parallel' | 'wedge',
  segments: number,
): number[] {
  let aOutLo: number;
  let aOutHi: number;
  let aInLo: number;
  let aInHi: number;
  if (gapStyle === 'wedge') {
    // Radial edges: trim both radii by the same angle, so the side stays on the
    // sector radial and the channel widens outward.
    const half = Math.asin(clampAbs(gap / 2, rOuter * ASIN_DOMAIN_CAP) / rOuter);
    aOutLo = a + half;
    aOutHi = b - half;
    aInLo = aOutLo;
    aInHi = aOutHi;
  } else {
    // Parallel edges: each radius hits the offset line at its own asin angle.
    const d = clampAbs(gap / 2, rInner * ASIN_DOMAIN_CAP);
    aOutLo = a + Math.asin(d / rOuter);
    aOutHi = b - Math.asin(d / rOuter);
    aInLo = a + Math.asin(d / rInner);
    aInHi = b - Math.asin(d / rInner);
  }
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = aOutLo + (aOutHi - aOutLo) * (i / segments);
    pts.push(round3(Math.sin(ang) * rOuter), round3(-Math.cos(ang) * rOuter));
  }
  for (let i = 0; i <= segments; i++) {
    const ang = aInHi + (aInLo - aInHi) * (i / segments);
    pts.push(round3(Math.sin(ang) * rInner), round3(-Math.cos(ang) * rInner));
  }
  return pts;
}

/** Sample a full circle of radius `r` as a closed point polygon (same flattened
 *  `[x0, y0, ...]` form as {@link sampledWedgePolygon}). Used for the centre disc
 *  in the modern wedge's blur region / tint, which has no gap to cut. */
export function sampledCirclePolygon(r: number, segments: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (2 * Math.PI * i) / segments;
    pts.push(round3(Math.sin(ang) * r), round3(-Math.cos(ang) * r));
  }
  return pts;
}
