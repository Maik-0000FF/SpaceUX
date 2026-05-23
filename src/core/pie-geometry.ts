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
  AimSource,
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

/** Pie-segment labels are capped at this many characters (counted by code
 *  point, so emoji/CJK count as one) — long names are truncated so they can't
 *  overflow a wedge. The ellipsis counts toward the cap, so a truncated label
 *  is 5 chars + "…". Applies only in the pie/preview segments; the editor tree
 *  shows full labels. The same cap drives the per-segment font fit below. */
export const MAX_PIE_LABEL_CHARS = 6;

/** Truncate a label for display inside a pie segment. */
export function truncatePieLabel(label: string): string {
  const chars = [...label];
  if (chars.length <= MAX_PIE_LABEL_CHARS) return label;
  return chars.slice(0, MAX_PIE_LABEL_CHARS - 1).join('') + '…';
}

// Label font-size bounds (px) for the per-segment fit below.
const PIE_LABEL_FONT_MIN = 8;
const PIE_LABEL_FONT_MAX = 20;

/**
 * Largest label font size (px) that keeps a {@link MAX_PIE_LABEL_CHARS}-char
 * label inside one wedge at `labelRadius`, for `sectorCount` sectors. Shrinks
 * as sectorCount grows (each wedge gets narrower), so labels never spill past
 * a segment boundary. The appearance label-scale (0–1) is applied on top by
 * the renderer as a fraction of this fit (`calc(fit * var(--pie-label-scale))`).
 */
export function segmentLabelFontPx(labelRadius: number, sectorCount: number): number {
  if (sectorCount <= 0) return PIE_LABEL_FONT_MAX;
  // Tangential room a wedge has at this radius (chord of its angular slice),
  // less ~10% so glyphs don't touch the wedge edges.
  const chord = 2 * labelRadius * Math.sin(Math.PI / sectorCount);
  const usable = chord * 0.9;
  // ~MAX chars at an average glyph advance of ~0.55em.
  const fit = usable / (MAX_PIE_LABEL_CHARS * 0.55);
  return Math.max(PIE_LABEL_FONT_MIN, Math.min(PIE_LABEL_FONT_MAX, fit));
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
