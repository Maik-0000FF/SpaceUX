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
 * Whether a TZ deflection should clear the sticky selection and light
 * up the cancel target. Direction-agnostic on purpose — push OR pull
 * both register, so users don't have to learn their puck's TZ polarity.
 *
 * Today this reuses the lateral TX/TY deadzone as the threshold; if
 * users report false fires we can split it out into its own
 * `tzDeadzone` field on `PieGeometryConfig`. Lives in this module as
 * a pure function so the rule is testable in isolation rather than
 * buried in the React effect that consumes it.
 */
export function shouldCancelOnZ(tz: number, deadzone: number): boolean {
  return Math.abs(tz) > deadzone;
}
