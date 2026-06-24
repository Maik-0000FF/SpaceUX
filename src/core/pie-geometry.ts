// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure geometry helpers for the radial menu.
 *
 * The renderer feeds raw TX/TY axis values into these functions; they
 * decide which sector is currently highlighted. Keeping the maths
 * framework-free (no DOM) means the same code can be unit-
 * tested in node with Vitest and the renderer just consumes the
 * result.
 *
 * Coordinate convention:
 *   - TX axis points right (+) / left (-) of the puck's neutral pose.
 *   - TY axis points away from (+) / toward (-) the user.
 *   - On screen the pie is centred at the cursor; sector 0 starts
 *     pointing up (-Y on screen, +Y on the puck because we flip the
 *     vertical sign so "push forward" maps to "up").
 *   - Sectors are numbered clockwise starting from 0 at top.
 */

import type {
  ActivationDirection,
  AimSource,
  GestureBinding,
  InputBinding,
  MenuAxisName,
} from '../shared/menu.js';
import type { ShapeRingRadii } from '../shared/shape-plugin-api.js';

export type PieAxes = {
  tx: number;
  ty: number;
};

/** A full six-axis snapshot. The lateral selection maths only need
 *  `tx`/`ty` (see :type:`PieAxes`); the axis-activation gestures can
 *  watch any of the six, so they take this wider shape. */
export type SixAxes = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
};

export type PieGeometryConfig = {
  /** Total number of sectors in the menu. Must be >= 2 for selection
   *  to mean anything; smaller values are clamped at runtime. */
  sectorCount: number;
  /** Magnitude below which no selection is made. Same unit as the raw
   *  axis values fed in. */
  deadzone: number;
  /** Flip the X axis. Useful when the puck's TX sign points opposite
   *  to what the user expects from the screen layout. */
  invertX: boolean;
  /** Flip the Y axis so pushing the puck forward feels like "up" on
   *  screen — most users expect this. False keeps the raw evdev sign. */
  invertY: boolean;
};

export const DEFAULT_PIE_GEOMETRY: PieGeometryConfig = {
  sectorCount: 8,
  deadzone: 50,
  invertX: false,
  invertY: true,
};

// ── Radial layout ratios ────────────────────────────────────────────
// Multiples of the inner pie's outer radius, shared by the live pie
// (PieMenu) and the editor's faithful preview (MenuPreview) so the two
// can't drift apart on proportions.

/** Inner edge of the outer (preview / child) ring. A small `>1` leaves a
 *  visible gap between the inner pie and the outer ring. */
export const OUTER_RING_INNER_RATIO = 1.04;

/** Outer edge of the outer ring — the overall pie footprint. */
export const OUTER_RING_OUTER_RATIO = 1.5;

// ── Submenu markers (issue #216) ────────────────────────────────────
// Each submenu sector in the active ring shows a small arc of dots on one
// orbit just outside the active band (the inner pie at the top level, where no
// outer ring is drawn), one dot per level the branch nests. They lie on a
// single radius (an arc, not a radial spoke). GAP is the orbit's distance past
// the active band's edge and DOT the dot radius, both fractions of the
// footprint so they scale with the pie; DOT is kept below the depth dots
// (~0.02). STEP_FACTOR is the centre-to-centre arc spacing between adjacent
// dots as a multiple of the dot radius (kept tight). The SVG viewport reserves
// GAP + 2·DOT past the outer ring (the drilled case) so the dots never clip and
// the size stays deterministic.
export const SUBMENU_MARKER_GAP_RATIO = 0.02;
export const SUBMENU_MARKER_DOT_RATIO = 0.013;
export const SUBMENU_MARKER_STEP_FACTOR = 2.6;

// Depth-dot level indicator (#296). The dots (one per ring depth) used to be an
// HTML flex row hanging *below* the SVG, which made the overlay window's real
// footprint a rectangle (square pie + a strip underneath). They now render as
// plain SVG circles inside the viewBox, so the window is a single self-contained
// square. These ratios are footprint-relative (the old size was displaySize-
// relative, which can't feed a viewBox extent without a self-reference) and are
// tuned to reproduce the old on-screen size at the default footprint:
//   RADIUS ≈ 0.02·submenuMarkerExtent  →  ≈ 0.021·footprint
//   GAP    = 1.4·diameter above the row →  2.8·RADIUS ≈ 0.059·footprint
//   spacing (centre-to-centre) = diameter + an equal gap = 4·RADIUS
export const DEPTH_DOT_RADIUS_RATIO = 0.021;
export const DEPTH_DOT_GAP_RATIO = 0.059;

// Safety border around the whole window so the outer circle / markers never
// clip a few pixels at the edge. ~2% of the footprint, applied symmetrically so
// the box stays square and the pie centre stays exactly on the cursor.
export const PIE_WINDOW_MARGIN_RATIO = 0.02;

// ── Ring balance (issue #182) ───────────────────────────────────────
// Two appearance sliders repartition the fixed footprint among the three
// radial bands (centre hole / inner pie = first child / outer ring) without
// changing the overall size. Each slider is a 0..1 position; both boundaries are
// fractions of the FOOTPRINT, so the sliders are independent (the ring moves the
// inner/outer split, the centre moves the hole, neither drags the other). At the
// 0.5/0.5 default the centre radius is a fifth of the footprint and the split
// three-fifths, i.e. centre 1, split 3, rim 5 — the inner band and the outer
// ring an equal 2 each (the 1:3:5 default look).

/** The ring slider moves the inner/outer split by ±BALANCE_MARGIN of its
 *  midpoint (slider 0 → mid×0.8, 0.5 → mid, 1 → mid×1.2). Footprint-relative, so
 *  it doesn't drag the centre. */
const BALANCE_MARGIN = 0.2;

/** Inner-pie outer radius midpoint as a fraction of the footprint: 3/5, so at
 *  the 0.5 default the split sits at 3 of a 5-radius pie, leaving the inner band
 *  and the outer ring an equal 2 each (the 3 of the 1:3:5 default). */
const INNER_FRACTION_MID = 3 / 5;

/** Centre hole radius as a fraction of the footprint, set linearly by the centre
 *  slider: 1/10 at slider 0, 3/10 at 1 — centre radius 0.5 to 1.5 of a 5-radius
 *  pie, with the 0.5 midpoint landing on 1/5 = the 1 of the 1:3:5 default.
 *  Footprint-relative, so the ring slider doesn't drag it. */
const CANCEL_FRACTION_MIN = 1 / 10;
const CANCEL_FRACTION_MAX = 3 / 10;

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/** Every ring radius (px) resolved for a frame. */
export type RingRadii = {
  /** Centre cancel hole radius (the inner cut-out of every wedge). */
  cancel: number;
  /** Outer radius of the inner pie (the first-child ring). */
  innerOuter: number;
  /** Inner edge of the outer ring (a small gap past the inner pie). */
  outerInner: number;
  /** Outer edge of the outer ring = the pie footprint. */
  outerOuter: number;
  /** Inner-pie label radius: the middle of the band between the cancel hole
   *  and the inner rim, so labels track the centre slider and never fall into
   *  an enlarged hole. */
  innerLabel: number;
  /** Outer-ring label radius: the middle of the outer band. */
  outerLabel: number;
};

/**
 * Resolve all ring radii from the pie footprint and the two balance sliders
 * (#182). `ringBalance` moves the inner-pie ↔ outer-ring boundary;
 * `centerBalance` moves the centre-hole ↔ inner-pie boundary. Both are 0..1
 * with 0.5 = the historical proportions. The footprint is fixed (set by the
 * size slider), so balancing only repartitions, never resizes. Shared by the
 * live pie and the editor preview so they can't drift.
 */
export function ringRadii(
  footprint: number,
  ringBalance: number,
  centerBalance: number,
): RingRadii {
  const innerOuter =
    footprint * INNER_FRACTION_MID * lerp(1 - BALANCE_MARGIN, 1 + BALANCE_MARGIN, ringBalance);
  const cancel = footprint * lerp(CANCEL_FRACTION_MIN, CANCEL_FRACTION_MAX, centerBalance);
  const outerInner = innerOuter * OUTER_RING_INNER_RATIO;
  const outerOuter = footprint;
  return {
    cancel,
    innerOuter,
    outerInner,
    outerOuter,
    innerLabel: (cancel + innerOuter) / 2,
    outerLabel: (outerInner + outerOuter) / 2,
  };
}

/** Repack the host's {@link RingRadii} into the shape-plugin contract's
 *  {@link ShapeRingRadii} (the canvas a shape plugin's `layout` / `hitTest`
 *  draw on). One helper so every caller that hands radii to a plugin (the
 *  editor preview and the native overlay's {@link buildPieSvg})
 *  derives the same packing and can't drift — the inner band's inner edge is
 *  the cancel hole, matching the wedge default. */
export function shapeRingRadii(r: RingRadii): ShapeRingRadii {
  return {
    cancelRadius: r.cancel,
    innerInnerRadius: r.cancel,
    innerOuterRadius: r.innerOuter,
    innerLabelRadius: r.innerLabel,
    outerInnerRadius: r.outerInner,
    outerOuterRadius: r.outerOuter,
    outerLabelRadius: r.outerLabel,
  };
}

const TAU = Math.PI * 2;

/** Truncate a label to `maxChars` code points (emoji/CJK count as one) for
 *  display inside a pie segment, so a long name can't overflow. The ellipsis
 *  counts toward the cap (a truncated label is `maxChars`-1 glyphs + "…").
 *  `maxChars` is the segment's MIN-font capacity ({@link segmentLabelCharCapacity}),
 *  not a fixed number, so a smaller font (more room) keeps more characters.
 *  Applies only in the pie/preview segments; the editor tree shows full labels. */
export function truncatePieLabel(label: string, maxChars: number): string {
  const chars = [...label];
  if (chars.length <= maxChars) return label;
  return chars.slice(0, Math.max(1, maxChars - 1)).join('') + '…';
}

// Label font-size bounds (px) for the per-segment fit below.
const PIE_LABEL_FONT_MIN = 8;
const PIE_LABEL_FONT_MAX = 30;
// Average glyph advance as a fraction of the font size (sans-serif ≈ 0.55em).
const LABEL_CHAR_EM = 0.55;
// Fraction of the band thickness a centred label may use radially, so the text
// stays inside a thin ring instead of overflowing it.
const LABEL_RADIAL_MARGIN = 0.9;
// Off-the-edge margin on the tangential chord room, shared by the font fit and
// the truncation capacity so both measure the same usable width.
const LABEL_CHORD_MARGIN = 0.95;

// Usable tangential width at `labelRadius` for `sectorCount` sectors, less the
// edge margin. A lone item (or the degenerate 0-sector case) has no angular
// edges, so it gets the full width at that radius.
function segmentUsableChord(labelRadius: number, sectorCount: number): number {
  const chord =
    sectorCount >= 2 ? 2 * labelRadius * Math.sin(Math.PI / sectorCount) : 2 * labelRadius;
  return chord * LABEL_CHORD_MARGIN;
}

/**
 * Largest label font size (px) that keeps a `charCount`-glyph label inside one
 * wedge at `labelRadius`, for `sectorCount` sectors. Sized to the *actual*
 * (already truncated to {@link segmentLabelCharCapacity}) label length, so a
 * short label fills its wedge rather than being sized for the worst case. Shrinks as
 * sectorCount grows (each wedge narrower), so labels never spill past a
 * boundary. The appearance label-scale (0–1) is applied on top by the renderer
 * as a fraction of this fit (`calc(fit * var(--pie-label-scale))`).
 *
 * `fontScale` scales the absolute MIN/MAX bounds. It's 1 when the whole SVG is
 * zoomed as one graphic (the bounds live in the fixed
 * viewBox and scale with it). The native overlay passes the pie-size factor, so
 * the bounds scale with the pie there too — otherwise the cap is a fixed px
 * value the geometry outgrows, and the label stops scaling at large sizes.
 */
export function segmentLabelFontPx(
  labelRadius: number,
  sectorCount: number,
  charCount: number,
  bandInner?: number,
  bandOuter?: number,
  fontScale = 1,
): number {
  const min = PIE_LABEL_FONT_MIN * fontScale;
  const max = PIE_LABEL_FONT_MAX * fontScale;
  // Radial cap from the band thickness (when the band is given): the label is
  // centred at labelRadius, so its height is bounded by the room to the nearer
  // band edge. Without this a wide-chord wedge in a *thin* ring (a low
  // ringBalance, or a few-item submenu on the outer ring) sizes the font by the
  // chord alone and overflows the band — "big text in a thin slice". Mirrors
  // the radial bound segmentIconFitPx already applies to icons.
  const radialCap =
    bandInner !== undefined && bandOuter !== undefined
      ? 2 * Math.min(labelRadius - bandInner, bandOuter - labelRadius) * LABEL_RADIAL_MARGIN
      : Infinity;
  // A single sector spans the full ring — it has no angular edges, so the
  // chord (sin(π/1) = 0) doesn't bound it and only the font cap (and the radial
  // band, if given) applies. Without this a lone item (e.g. a fresh one-child
  // submenu) would collapse to the *minimum* font. (< 2 also covers the
  // degenerate 0-sector case.)
  if (sectorCount < 2) {
    return Math.max(min, Math.min(max, radialCap));
  }
  // Tangential room a wedge has at this radius (chord of its angular slice),
  // less a little so glyphs don't touch the wedge edges.
  const usable = segmentUsableChord(labelRadius, sectorCount);
  const fit = Math.min(usable / (Math.max(1, charCount) * LABEL_CHAR_EM), radialCap);
  return Math.max(min, Math.min(max, fit));
}

/**
 * Most glyphs that still fit in a wedge at the MINIMUM font — the point past
 * which the font can't shrink further, so the label is truncated (by
 * {@link truncatePieLabel}) instead of overflowing. Geometry-driven: a wider
 * wedge (fewer sectors / larger radius) or a smaller min keeps more characters,
 * so a small font shows more than a fixed cap would. At least 1.
 */
export function segmentLabelCharCapacity(labelRadius: number, sectorCount: number): number {
  const usable = segmentUsableChord(labelRadius, sectorCount);
  return Math.max(1, Math.floor(usable / (PIE_LABEL_FONT_MIN * LABEL_CHAR_EM)));
}

// Fraction of the centre-disc radius the label may use, leaving a little off the
// rim. Drives both the per-glyph width and the lone-glyph height cap.
const CENTER_LABEL_WIDTH = 0.85;

/**
 * Font size (px) for the centre-field label, before the label-scale slider.
 * Fills the centre disc by glyph count, like a wedge label fills its wedge: the
 * usable disc extent divided by the glyph advance shrinks the font as the label
 * lengthens (fewer glyphs → bigger, more → smaller), with the lone-glyph height
 * capping the very-short case. Uses the same glyph-advance estimate as the wedge
 * labels and is clamped to the wedge-label bounds, so the native overlay (via
 * `buildPieSvg`) and the editor preview match for any length. The renderer
 * applies the label-scale on top (`calc(fit * var(--pie-label-scale))`).
 *
 * `fontScale` scales the absolute MIN/MAX bounds, exactly as in
 * {@link segmentLabelFontPx}: the pie-size factor for the native overlay.
 */
export function centerLabelFontPx(centerRadius: number, charCount: number, fontScale = 1): number {
  const usable = 2 * centerRadius * CENTER_LABEL_WIDTH;
  const widthFit = usable / (Math.max(1, charCount) * LABEL_CHAR_EM);
  return Math.max(
    PIE_LABEL_FONT_MIN * fontScale,
    Math.min(PIE_LABEL_FONT_MAX * fontScale, Math.min(usable, widthFit)),
  );
}

// How much of the per-segment fit the largest icon may use; 1 = the full wedge
// bound (chord / band). Deliberately 1: most icons carry their own transparent
// padding, so the visible glyph stays inside the wedge even though the icon BOX
// reaches the bound — a value below 1 would only shrink the artwork for box
// corners the padding already keeps clear. Was 0.9 (#439: icons sat too small).
// The renderer still caps the scaled size at this bound (segmentIconScaledPx),
// so a stale iconScale > 1 can never push the box past the wedge.
export const ICON_FIT_MARGIN = 1;

// Square-in-disc inscribe ratios. Centred in a disc of radius r, a square of
// edge e fits when its half-diagonal e/√2 stays within r, so e ≤ r·√2. Stacked
// *above* the centre (its bottom at the centre, leaving the lower half for a
// label below it), the binding corners are the two top ones at distance e·√1.25
// from the centre, so e ≤ r/√1.25.
const CENTER_ICON_CENTERED = Math.SQRT2;
const CENTER_ICON_ABOVE = 1 / Math.sqrt(1.25);

/**
 * Largest square-icon edge (px) for the centre disc of radius `centerRadius`.
 * Without a label the icon is centred and inscribed (edge ≤ r·√2); with a label
 * it stacks above the centre (label below), bounded by its top-corner inscribe
 * (edge ≤ r/√1.25) so the lower half is left for the label, the same stack a
 * ring item uses. Both kept off the rim by {@link ICON_FIT_MARGIN}. At
 * icon-scale 100% the icon fills its share of the disc, mirroring the wedge
 * "100% fills"; the renderer applies the icon-scale on top. Shared by the
 * native overlay (`buildPieSvg`) and the editor preview so the centre matches.
 */
export function centerIconFitPx(centerRadius: number, hasLabel = false): number {
  const ratio = hasLabel ? CENTER_ICON_ABOVE : CENTER_ICON_CENTERED;
  return centerRadius * ratio * ICON_FIT_MARGIN;
}

/**
 * Largest square-icon edge (px) that fits inside one wedge centred at
 * `iconRadius`, bounded by *both* the wedge's tangential room (the chord of
 * its angular slice) and its radial band (`bandInner`..`bandOuter`) — so the
 * icon never crosses an angular edge nor the inner/outer arcs. The icon is
 * stacked above the label (top at `iconRadius - edge`), so the binding radial
 * limit is the room inward to `bandInner`. The appearance icon-scale (0–1) is
 * applied on top by the renderer as a fraction of this fit — 100% = fills the
 * segment, exactly like the label scale. Differs per ring because the inner
 * pie and the thinner outer ring have different room.
 */
export function segmentIconFitPx(
  iconRadius: number,
  sectorCount: number,
  bandInner: number,
  bandOuter: number,
): number {
  if (sectorCount <= 0) return 0;
  // Tangential room: the wedge's chord at the icon's radius. A single sector
  // spans the full ring — there are no angular edges to cross — so the chord
  // bound doesn't apply and only the radial band limits the icon. (Without
  // this, sin(π/1) = 0 would collapse the fit to zero and the icon would
  // vanish, while the label survives via its font-size floor.)
  const tangential = sectorCount < 2 ? Infinity : 2 * iconRadius * Math.sin(Math.PI / sectorCount);
  // Radial room: distance to the nearer band edge (inward bound is what the
  // stacked layout actually hits; the outward bound is the conservative twin).
  const radial = Math.min(iconRadius - bandInner, bandOuter - iconRadius);
  return Math.max(0, Math.min(tangential, radial) * ICON_FIT_MARGIN);
}

/**
 * Icon size to actually render for a user `iconScale`: the comfortable fit
 * scaled by `iconScale`, but capped at the wedge edge (the fit with its
 * breathing margin removed). So raising the scale grows the icon up to the
 * wedge bounds yet never past them — a high scale on a narrow wedge (many
 * items) can no longer push the icon over the edge (#439).
 */
export function segmentIconScaledPx(
  iconRadius: number,
  sectorCount: number,
  bandInner: number,
  bandOuter: number,
  iconScale: number,
): number {
  const fit = segmentIconFitPx(iconRadius, sectorCount, bandInner, bandOuter);
  const edge = fit / ICON_FIT_MARGIN; // the wedge bound, breathing margin removed
  return Math.min(fit * iconScale, edge);
}

/**
 * Map raw axes to a sector index 0..sectorCount-1, or null if inside
 * the deadzone. The angle is computed relative to "12 o'clock" so
 * sector 0 sits at the top of the menu regardless of the chosen
 * sectorCount.
 */
export function axesToSector(
  axes: PieAxes,
  config: PieGeometryConfig = DEFAULT_PIE_GEOMETRY,
): number | null {
  const sectors = Math.max(2, Math.floor(config.sectorCount));
  const x = config.invertX ? -axes.tx : axes.tx;
  // invertY=true maps the puck's "push forward" (+ty) to math-up
  // (+Y), which axesToSector treats as sector 0 (12 o'clock). The
  // raw-evdev case (invertY=false) keeps +ty pointing down because
  // that's the kernel's native screen-coords convention.
  const y = config.invertY ? axes.ty : -axes.ty;
  const magnitude = Math.hypot(x, y);
  if (magnitude < config.deadzone) return null;

  // atan2 returns radians in (-π, π], measured counter-clockwise from
  // the +X axis. We want clockwise from the +Y (up) axis so the maths
  // matches the visual numbering: shift by π/2 and negate to flip
  // direction. Then normalise into [0, 2π) before bucketing.
  let angle = -Math.atan2(y, x) + Math.PI / 2;
  if (angle < 0) angle += TAU;
  if (angle >= TAU) angle -= TAU;

  const sectorWidth = TAU / sectors;
  // Bias by half a sector so the boundary between two sectors sits
  // between them, not at the centre of one. Without this nudge the
  // top sector would actually start at 12 o'clock and end at the
  // next boundary — visually correct, but selection feels "off by
  // half" because users aim at the middle of a wedge.
  const biased = angle + sectorWidth / 2;
  let sector = Math.floor(biased / sectorWidth);
  if (sector >= sectors) sector -= sectors;
  return sector;
}

/**
 * Inverse helper: angle in radians for the centre of the given sector.
 * Used by the renderer to position labels and icons. Returns radians
 * measured clockwise from "12 o'clock", i.e. the same convention used
 * by axesToSector.
 */
export function sectorCenterAngle(sectorIndex: number, sectorCount: number): number {
  const sectors = Math.max(2, Math.floor(sectorCount));
  return ((sectorIndex % sectors) * TAU) / sectors;
}

/**
 * Angles (radians, same 12-o'clock convention as `sectorCenterAngle`) for a
 * submenu sector's depth-marker dots (#216): `count` dots laid out as an arc on
 * one orbit, centred on the sector, spaced `stepAngle` apart. One dot sits dead
 * centre; none yields an empty array (a leaf gets no marker). The caller derives
 * `stepAngle` from the dot size and orbit radius so the arc spacing is a fixed
 * arc length. Shared by the live overlay and the editor preview so they can't
 * drift.
 */
export function submenuMarkerAngles(
  sectorIndex: number,
  sectorCount: number,
  count: number,
  rotation: number,
  stepAngle: number,
): number[] {
  if (count <= 0) return [];
  const center = sectorCenterAngle(sectorIndex, sectorCount) + rotation;
  return Array.from({ length: count }, (_, k) => center + (k - (count - 1) / 2) * stepAngle);
}

/**
 * SVG half-extent the viewport must reserve for the submenu markers (#216): the
 * outer ring plus the orbit gap and a full dot diameter. Band-independent (the
 * markers ride one orbit, so depth doesn't matter), reserved unconditionally so
 * the size stays deterministic. Shared by the live overlay and the editor
 * preview so the two can't drift.
 */
export function submenuMarkerExtent(footprint: number, outerOuter: number): number {
  return (
    outerOuter + footprint * SUBMENU_MARKER_GAP_RATIO + 2 * footprint * SUBMENU_MARKER_DOT_RATIO
  );
}

/**
 * Square half-extent for the whole pie *window* (#296): the submenu-marker
 * extent, plus room below for the depth-dot row (now inside the SVG), plus a
 * safety margin so nothing clips. Symmetric, so the SVG viewBox stays square
 * and the pie centre lands exactly on the cursor while the extra room is pure
 * transparent border. This (×2) is the window the compositor sees, which is the
 * box the later click-through region will be cut from. Shared by the live
 * overlay and the editor preview so the two can't drift.
 */
export function pieWindowExtent(footprint: number, outerOuter: number): number {
  const dotRow = footprint * (DEPTH_DOT_GAP_RATIO + 2 * DEPTH_DOT_RADIUS_RATIO);
  const margin = footprint * PIE_WINDOW_MARGIN_RATIO;
  return submenuMarkerExtent(footprint, outerOuter) + dotRow + margin;
}

/**
 * Geometry for the depth-dot level indicator now that it renders inside the SVG
 * as circles (#296): each dot's radius, the shared row centre-line `cy` (just
 * below the submenu-marker extent), and the per-dot `xs` centres for a row of
 * `count` dots centred on x = 0. All in viewBox units. Shared by the live
 * overlay and the editor preview.
 */
export function depthDotLayout(
  footprint: number,
  outerOuter: number,
  count: number,
): { radius: number; cy: number; xs: number[] } {
  const radius = footprint * DEPTH_DOT_RADIUS_RATIO;
  const cy = submenuMarkerExtent(footprint, outerOuter) + footprint * DEPTH_DOT_GAP_RATIO + radius;
  // Centre spacing = dot diameter + an equal gap, matching the old flex row.
  const spacing = 4 * radius;
  const xs = Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
  return { radius, cy, xs };
}

/**
 * Orbit radius, per-dot angular spacing and dot radius for the submenu markers
 * (#216). The orbit hugs the outermost band currently on screen: the inner pie
 * when only it shows, the outer ring once it's visible (`outerBandVisible`), so
 * the dots move outside the outer band when it opens. The arc spacing is a fixed
 * arc length (dot size × the spacing factor, converted to an angle at the
 * orbit), so a branch's arc stays tight whatever the sector width. Shared by the
 * live overlay and the editor preview.
 */
export function submenuMarkerOrbit(params: {
  footprint: number;
  innerOuter: number;
  outerOuter: number;
  outerBandVisible: boolean;
}): { orbit: number; stepAngle: number; dotRadius: number } {
  const { footprint, innerOuter, outerOuter, outerBandVisible } = params;
  const dotRadius = footprint * SUBMENU_MARKER_DOT_RATIO;
  const gap = footprint * SUBMENU_MARKER_GAP_RATIO;
  const orbit = (outerBandVisible ? outerOuter : innerOuter) + gap + dotRadius;
  const stepAngle = (dotRadius * SUBMENU_MARKER_STEP_FACTOR) / orbit;
  return { orbit, stepAngle, dotRadius };
}

/** Compute the magnitude of the axes vector. Lets the renderer scale
 *  the visual indicator radially (e.g. arrow extends further with
 *  stronger deflection). */
export function axesMagnitude(axes: PieAxes): number {
  return Math.hypot(axes.tx, axes.ty);
}

/**
 * Rotate the lateral axes vector by `angle` radians. Used to align
 * the puck-to-sector mapping with a visually-rotated ring: pass the
 * negative of the ring's rotation offset to "undo" the rotation
 * before running `axesToSector`, so the puck pointing at the
 * parent sector's screen direction still resolves to the
 * corresponding visual sector after a drill-in.
 *
 * Pure 2D rotation matrix on `tx`/`ty`. The axis-inversion flags
 * inside `axesToSector` are applied to the *rotated* output, which
 * is what callers want — invert is a per-user puck calibration and
 * should still apply post-rotation.
 */
export function rotateAxes(axes: PieAxes, angle: number): PieAxes {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    tx: axes.tx * c - axes.ty * s,
    ty: axes.tx * s + axes.ty * c,
  };
}

/**
 * Resolve the 2D aiming vector for the configured aim source (#159) —
 * which axes steer the hovered sector. Replaces the previously hardwired
 * `{ tx, ty }`:
 *   - `push` → the lateral push (TX/TY), the historical behaviour;
 *   - `tilt` → the rotational tilt, mapped to match push: RY (tilt
 *     left/right) drives the horizontal aim like TX, RX (tilt
 *     forward/back) the vertical like TY. (Mapping RX→x/RY→y would aim
 *     90° off and fight push in `both`.)
 *   - `both` → push + the matching tilt axis summed, so the two aim the
 *     same way and reinforce rather than cancel;
 *   - `twist` → `null`: there's no lateral pointer at all, so the caller
 *     makes no sector from deflection and lets the cycle/twist step drive
 *     the selection alone.
 *
 * For the 2D sources the result feeds the same `rotateAxes` →
 * `axesToSector` pipeline, so ring rotation and per-axis inversion still
 * apply downstream unchanged.
 */
export function aimAxes(source: AimSource, axes: SixAxes): PieAxes | null {
  switch (source) {
    case 'push':
      return { tx: axes.tx, ty: axes.ty };
    case 'tilt':
      // RY (left/right) → horizontal, RX (forward/back) → vertical, so tilt
      // aims the same way push does. RY is negated: tilting left reads RY+
      // on our hardware but must aim left (−x), so −RY puts it there.
      return { tx: -axes.ry, ty: axes.rx };
    case 'both':
      return { tx: axes.tx - axes.ry, ty: axes.ty + axes.rx };
    case 'twist':
      return null;
  }
}

/** Read a named axis from a six-axis snapshot. Thin indexed access,
 *  but centralising it keeps the activation call sites from hand-
 *  mapping axis names to fields (and lets the helper be unit-tested
 *  against the daemon's broadcast order). */
export function axisValue(axes: SixAxes, axis: MenuAxisName): number {
  return axes[axis];
}

/**
 * Direction-aware threshold test for an axis-activation gesture.
 *
 *   - `positive`: the raw value is above `+threshold`.
 *   - `negative`: the raw value is below `-threshold`.
 *   - `both`: the magnitude is above `threshold` (direction-agnostic,
 *     matching the historical TZ-cancel rule).
 *
 * Strict-greater on purpose (a deflection sitting exactly on the
 * threshold doesn't fire). `threshold` is always a positive magnitude;
 * the sign handling lives here so the caller passes the raw axis value
 * untouched.
 */
export function meetsActivation(
  value: number,
  direction: ActivationDirection,
  threshold: number,
): boolean {
  if (direction === 'positive') return value > threshold;
  if (direction === 'negative') return value < -threshold;
  return Math.abs(value) > threshold; // 'both'
}

/**
 * Direction of a twist-to-cycle step from the raw RZ value: `+1` for a
 * positive twist (step to the next sector, clockwise), `-1` for a
 * negative twist (previous), `0` while within the threshold. Strict-
 * greater on the magnitude, mirroring the other twist gestures.
 *
 * Pure and direction-aware (unlike the direction-agnostic twist-*drill*
 * test, which only cares about magnitude) so the cycle knows which way
 * to step. The rising-edge gating that turns a sustained twist into a
 * single step lives at the call site.
 */
export function twistCycleStep(rz: number, threshold: number): -1 | 0 | 1 {
  if (rz > threshold) return 1;
  if (rz < -threshold) return -1;
  return 0;
}

/**
 * The twist-cycle step for a frame, derived from a gesture's inputs:
 * the first axis input whose deflection passes its threshold decides the
 * direction (+1 next / -1 previous) via :func:`twistCycleStep`. Non-axis
 * inputs (button/magnitude) carry no direction and are skipped. `0` when
 * nothing steps. Rising-edge gating stays at the call site.
 */
export function cycleStepFromInputs(inputs: readonly InputBinding[], axes: SixAxes): -1 | 0 | 1 {
  for (const input of inputs) {
    if (input.kind !== 'axis') continue;
    const step = twistCycleStep(axisValue(axes, input.axis), input.threshold);
    if (step !== 0) return step;
  }
  return 0;
}

/**
 * Whether the back gesture's axis is deflected enough to suppress the
 * lateral selection this frame — the generalised cross-talk guard.
 *
 * Direction-*aware* (#160): a back bound to one half of an axis only
 * suppresses when the deflection is on that half, leaving the other half
 * free for a different gesture. So a TZ− back no longer blocks a TZ+ drill
 * — the "press = back, lift = deeper" split now works. A `both` back still
 * quiets either sense (the historical TZ-cancel rule, where the whole axis
 * means back). Only `axis` inputs participate; button/magnitude back
 * bindings don't induce lateral cross-talk.
 */
export function backAxisEngaged(back: GestureBinding, axes: SixAxes): boolean {
  return back.inputs.some(
    (input) =>
      input.kind === 'axis' &&
      meetsActivation(axisValue(axes, input.axis), input.direction, input.threshold),
  );
}

/**
 * Push a pie anchor inward from any viewport edge so the full circle
 * of `radius` stays visible. Called by the renderer before placing
 * the SVG: without it, opening the menu near the top-left of the
 * screen (e.g. cursor at (10, 10) with a 240 px radius) lets the SVG
 * bleed into negative viewport coordinates and the browser clips off
 * the sectors on that edge.
 *
 * Behaviour:
 *   - Well inside the viewport: returned unchanged.
 *   - Past an edge: pinned to `radius` away from that edge so the
 *     pie touches but does not overflow.
 *   - Viewport smaller than the pie diameter on either axis: falls
 *     back to the viewport centre on that axis. The pie still
 *     doesn't fit (the viewport just isn't big enough), but the
 *     fallback is symmetric and predictable — better than emitting
 *     `Math.max(radius, …)` greater than `Math.min(…)`, which would
 *     land somewhere meaningless and asymmetric.
 *
 * Pure function with no DOM dependency, so vitest can pin every
 * corner case without a renderer harness.
 */
export function clampPieAnchor(
  point: { x: number; y: number },
  radius: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const x =
    viewport.width >= 2 * radius
      ? Math.max(radius, Math.min(viewport.width - radius, point.x))
      : viewport.width / 2;
  const y =
    viewport.height >= 2 * radius
      ? Math.max(radius, Math.min(viewport.height - radius, point.y))
      : viewport.height / 2;
  return { x, y };
}

// ── Navigation input resolver (issue #105) ──────────────────────────

/** A single puck frame for resolving navigation input bindings: the
 *  six axes plus the current button states (indexed by button number). */
export type GestureFrame = {
  axes: SixAxes;
  /** `buttons[i]` is true while device button `i` is held. */
  buttons: readonly boolean[];
};

/**
 * Whether a single :type:`InputBinding` is satisfied this frame. Pure —
 * the rising-edge gating that turns "satisfied" into "fires once" stays
 * at the call site (the renderer hook), exactly like the existing
 * gesture detectors.
 *
 *   - `button`: the device button is held.
 *   - `axis`: the named axis is past the threshold on the chosen side
 *     (reuses :func:`meetsActivation`).
 *   - `magnitude`: the lateral (TX/TY) or tilt (RX/RY) magnitude is past
 *     the threshold. Strict-greater throughout, matching the axis path.
 *   - `none`: never.
 */
export function inputActive(input: InputBinding, frame: GestureFrame): boolean {
  switch (input.kind) {
    case 'button':
      return frame.buttons[input.button] === true;
    case 'axis':
      return meetsActivation(axisValue(frame.axes, input.axis), input.direction, input.threshold);
    case 'magnitude': {
      const { tx, ty, rx, ry } = frame.axes;
      const magnitude = input.source === 'lateral' ? axesMagnitude({ tx, ty }) : Math.hypot(rx, ry);
      return magnitude > input.threshold;
    }
    case 'none':
      return false;
  }
}

/** Whether a gesture is active this frame — true if ANY of its inputs
 *  is satisfied (matches today's "any drill gesture drills"). A gesture
 *  with no inputs is never active. */
export function gestureActive(gesture: GestureBinding, frame: GestureFrame): boolean {
  return gesture.inputs.some((input) => inputActive(input, frame));
}
