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

import type {
  ActivationDirection,
  AxisActivation,
  GestureBinding,
  InputBinding,
  MenuAxisName,
} from '../shared/menu';

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
 * Strict-greater on purpose, mirroring :func:`shouldCancelOnZ`, so a
 * deflection sitting exactly on the threshold doesn't fire. `threshold`
 * is always a positive magnitude; the sign handling lives here so the
 * caller passes the raw axis value untouched.
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
 * Whether the current TZ deflection should engage the back/pop gesture,
 * given an optional center activation that may reserve part of the TZ
 * axis.
 *
 * When the activation watches TZ, the back gesture takes the *opposite*
 * half — so binding the center to "TZ pulled up" leaves "TZ pushed
 * down" as back/pop, the split the feature is built around. A
 * `both`-direction TZ activation claims the whole axis, leaving no TZ
 * back trigger (callers should prefer `positive`/`negative` when they
 * still want back/pop). Activations on other axes — or none — leave the
 * historical direction-agnostic TZ back intact, identical to
 * :func:`shouldCancelOnZ`.
 */
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

export function tzBackEngaged(
  tz: number,
  tzDeadzone: number,
  activation: AxisActivation | undefined,
): boolean {
  // Delegate the magnitude test so the strict-greater contract lives in
  // exactly one place and the "identical to shouldCancelOnZ when no TZ
  // activation is configured" promise stays self-enforcing.
  if (!shouldCancelOnZ(tz, tzDeadzone)) return false;
  if (!activation || activation.axis !== 'tz') return true;
  if (activation.direction === 'positive') return tz < 0;
  if (activation.direction === 'negative') return tz > 0;
  return false; // 'both' → whole TZ axis reserved for the activation
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
      const magnitude = input.source === 'lateral' ? Math.hypot(tx, ty) : Math.hypot(rx, ry);
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
