// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * SVG path builders for the radial menu.
 *
 * Sits next to `pie-geometry.ts` rather than in `src/renderer/` so the
 * functions can be exercised in node with vitest — they emit strings,
 * not DOM, and pinning the exact path output is the cheapest way to
 * catch a wrong `largeArc` flag or a swapped sweep direction.
 *
 * Angle convention is the same as `pie-geometry.ts`: radians,
 * 12 o'clock = 0, clockwise positive. Callers convert to screen
 * coordinates inside this module so the renderer stays declarative.
 */

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
