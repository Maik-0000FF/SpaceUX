// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Planets shape model (#107). Lays the menu's active ring out as
 * orbital nodes around the centre instead of wedge slices: every
 * sector becomes one circle (a "planet") evenly spaced on a single
 * orbit. The centre cancel zone reads as the "sun".
 *
 * Pure compute, no DOM, no host imports. The host loads this file
 * via Blob-URL dynamic import into the renderer process and calls
 * the two named exports per the contract in
 * src/shared/shape-plugin-api.ts.
 *
 * The wedge default code path stays untouched; this plugin is only
 * active when the pie appearance (or a per-menu override) selects
 * "org.spaceux.planets/planets".
 */

const TAU = Math.PI * 2;

/**
 * Place `sectorCount` planets evenly on a single orbit. The orbit
 * sits at the outer ring's label radius so the planets get the most
 * room and the centre still reads as a cancel zone (the "sun").
 *
 * Sector 0 sits at "12 o'clock"; subsequent sectors go clockwise.
 * Same convention as the wedge default's `sectorCenterAngle`, so a
 * puck push forward continues to hover sector 0 the way it did
 * before switching to the planets layout.
 *
 * Planet radius derives from the chord between adjacent planets so
 * neighbours never overlap and the visual stays balanced at any
 * sector count (the host clamps sectorCount to >= 2 effectively;
 * a 1-sector pie still works via the floor below).
 */
export function layout(sectorCount, ringRadii, ring) {
  // `Math.max(0, ...)` honours the contract: validateShapeLayout()
  // expects exactly `sectorCount` nodes, so a zero-sector pie must
  // produce an empty layout, not a one-node fallback. The for-loop
  // below skips entirely on n=0; the n=1 chord-degenerate case
  // falls through to the ring-thickness cap further down.
  const n = Math.max(0, Math.floor(sectorCount));
  // Pick orbit + ring-thickness cap based on which slot the host is
  // asking for. Both rings render simultaneously when both have
  // content (the wedge default's behaviour: active + breadcrumb /
  // preview); the plugin picks its own orbit per call so a planet on
  // the inner band sits inside its band and a planet on the outer
  // band sits inside its band. Unknown `ring` values fall back to
  // the outer slot for forward-compat.
  const isInner = ring === 'inner';
  const orbit = isInner ? ringRadii.innerLabelRadius : ringRadii.outerLabelRadius;
  // Half-chord between adjacent planet centres along the orbit:
  // chord = 2 * orbit * sin(pi/n), so the half-chord is the radius
  // budget before adjacent planets would touch. Use ~70% of that so
  // neighbours stay visibly separated even at high sector counts.
  // A single-sector pie (n=1) gets the chord term degenerate, so
  // fall back to the ring-thickness cap below.
  const halfChord = n >= 2 ? orbit * Math.sin(Math.PI / n) : Infinity;
  // Cap by half the ring's thickness so a planet never bleeds past
  // the band. Inner ring's "outer edge" is its outer radius; outer
  // ring's "outer edge" is its outer radius.
  const halfThickness = isInner
    ? (ringRadii.innerOuterRadius - ringRadii.innerInnerRadius) / 2
    : (ringRadii.outerOuterRadius - ringRadii.outerInnerRadius) / 2;
  const planetRadius = Math.min(halfChord * 0.7, halfThickness * 0.95);
  const nodes = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    // Angle 0 at "12 o'clock", measured clockwise. Screen y grows
    // downward so the vertical component is negated (top is -y).
    const angle = (i / n) * TAU;
    const cx = orbit * Math.sin(angle);
    const cy = -orbit * Math.cos(angle);
    nodes.push({ cx, cy, r: planetRadius });
    // Label centred inside the planet. The host pairs this with
    // dominant-baseline=middle so the text sits on (x, y).
    labels.push({ x: cx, y: cy, anchor: 'middle' });
  }
  return { nodes, labels };
}

/**
 * Resolve which planet (sector index) the puck is currently aiming at,
 * or null when the puck is inside the centre / cancel zone.
 *
 * Approach: treat raw puck (tx, ty) as the puck's screen-space position,
 * matching the wedge default's MenuConfig-level convention
 * (DEFAULT_AXIS_INVERT.y = false, so axesToSector reads y = -axes.ty
 * and a "push forward" with axes.ty < 0 lights sector 0 at the top).
 * Then return the index of the planet whose centre is closest to that
 * position. Nearest-by-distance is the natural mapping for an orbital
 * layout (the user points at a planet) and it stays well-defined even
 * when the puck deflects past the orbit radius.
 *
 * Limitations a future contract revision should address:
 *  - The per-device `axisInvert` flags from `MenuConfig` aren't plumbed
 *    to the plugin yet. The plugin hardcodes the host's default
 *    (`{x: false, y: false}`), which is what the wedge runtime uses
 *    when the config doesn't override; a user who flips invertY in
 *    their per-device profile would see the planets respond on the
 *    opposite vertical axis than the wedge default.
 *  - The cancel-zone gate compares pixel-space `cancelRadius` against
 *    raw axis magnitudes; on a SpaceMouse where one axis unit roughly
 *    corresponds to one pixel of intended deflection this lines up,
 *    but a future contract revision should pass `hoverDeadzone`
 *    explicitly so the threshold matches the units the host's own
 *    wedge default uses.
 */
export function hitTest(axes, ringRadii, layout) {
  const px = axes.tx;
  const py = axes.ty;
  if (Math.hypot(px, py) < ringRadii.cancelRadius) return null;
  let bestIndex = -1;
  let bestDistSq = Infinity;
  for (let i = 0; i < layout.nodes.length; i++) {
    const n = layout.nodes[i];
    const dx = n.cx - px;
    const dy = n.cy - py;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  }
  return bestIndex < 0 ? null : bestIndex;
}
