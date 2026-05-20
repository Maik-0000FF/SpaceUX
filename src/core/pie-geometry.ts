// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure geometry helpers for the radial menu.
 *
 * The renderer feeds raw TX/TY axis values into these functions; they
 * decide which sector is currently highlighted. Keeping the maths
 * framework-free (no React, no DOM) means the same code can be unit-
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

export type PieAxes = {
  tx: number;
  ty: number;
};

export type PieGeometryConfig = {
  /** Total number of sectors in the menu. Must be >= 2 for selection
   *  to mean anything; smaller values are clamped at runtime. */
  sectorCount: number;
  /** Magnitude below which no selection is made. Same unit as the raw
   *  axis values fed in. */
  deadzone: number;
  /** Optional separate threshold for the TZ-cancel gesture
   *  (puck pushed forward / pulled back). When unset it defaults
   *  to `deadzone` — same behaviour as before this field existed.
   *  Splitting it out lets the user raise the TZ cutoff to filter
   *  out lateral-push cross-talk on pucks where TZ shares a sense
   *  with TX/TY, without making the lateral selection more
   *  jittery. Use :func:`resolveTzDeadzone` rather than reading
   *  this field directly so a missing override never silently
   *  produces a 0 threshold. */
  tzDeadzone?: number;
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

/** Central cancel hole / inner cut-out of every wedge, as a fraction of
 *  the inner pie's outer radius. */
export const CANCEL_RADIUS_RATIO = 0.18;

/** Inner edge of the outer (preview / child) ring. A small `>1` leaves a
 *  visible gap between the inner pie and the outer ring. */
export const OUTER_RING_INNER_RATIO = 1.04;

/** Outer edge of the outer ring — the overall pie footprint. */
export const OUTER_RING_OUTER_RATIO = 1.5;

/** Radius at which inner-pie labels sit, as a fraction of the inner pie's
 *  outer radius (between the cancel hole and the rim). */
export const INNER_LABEL_RATIO = 0.62;

const TAU = Math.PI * 2;

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
 * Whether a TZ deflection should clear the sticky selection and light
 * up the cancel target. Direction-agnostic on purpose — push OR pull
 * both register, so users don't have to learn their puck's TZ polarity.
 *
 * Lives in this module as a pure function so the rule is testable in
 * isolation rather than buried in the React effect that consumes it.
 * Pair with :func:`resolveTzDeadzone` at the call site so the
 * caller's optional `tzDeadzone` override on `PieGeometryConfig`
 * applies — passing `config.deadzone` directly here ignores any
 * separately-configured TZ threshold.
 */
export function shouldCancelOnZ(tz: number, deadzone: number): boolean {
  return Math.abs(tz) > deadzone;
}

/**
 * Pick the right TZ-cancel threshold: the caller's `override` if
 * set, the lateral `fallback` otherwise. Centralising the
 * `?? fallback` rule in one helper keeps every TZ-related call
 * site (cancel/pop, future TZ-cancel UI hints, etc.) from
 * re-implementing the coalesce and drifting on edge cases —
 * notably the explicit `0` carry, which a future `||`
 * "simplification" would silently coalesce to the fallback.
 *
 * Takes two scalars rather than a `PieGeometryConfig` so the
 * caller (the per-frame puck-handling effect) doesn't have to
 * synthesise a config object just to read two fields.
 */
export function resolveTzDeadzone(override: number | undefined, fallback: number): number {
  return override ?? fallback;
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
