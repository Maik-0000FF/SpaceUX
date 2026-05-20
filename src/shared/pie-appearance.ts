// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure constants and validation for the pie appearance setting — no Node or
 * Electron deps, so both the main process (persistence in app-settings.ts,
 * the IPC trust boundary in app-ipc.ts) and the editor renderer (the toolbar
 * slider bounds) import the *same* source. Keeping these here is why the
 * slider range and the main-side clamp can't drift apart.
 */

import type { PieAppearance, PieThemeChoice } from './ipc';

export const PIE_THEMES: ReadonlySet<string> = new Set<PieThemeChoice>([
  'dark',
  'light',
  'spaceux',
]);

/** Opacity spans the full 0–100% range (0 = fully transparent). */
export const PIE_OPACITY_MIN = 0;
export const PIE_OPACITY_MAX = 1;
export const PIE_OPACITY_STEP = 0.05;

/** Defaults preserve the original look: dark palette, fills at ~60% (the
 *  palette's original baked translucency). Opacity scales only the wedge
 *  fill alpha — strokes and labels are always fully opaque. */
export const DEFAULT_PIE_APPEARANCE: PieAppearance = { theme: 'dark', opacity: 0.6 };

export function clampPieOpacity(n: number): number {
  return Math.min(PIE_OPACITY_MAX, Math.max(PIE_OPACITY_MIN, n));
}

/**
 * Sanitise an untrusted appearance patch from the renderer into the subset
 * of fields that are valid: an unknown theme is dropped, a non-finite or
 * out-of-range opacity is dropped/clamped, and any other shape yields an
 * empty patch. This is the IPC trust boundary (used by app-ipc); keeping it
 * pure makes the boundary behaviour unit-testable without Electron.
 */
export function sanitizePieAppearancePatch(patch: unknown): Partial<PieAppearance> {
  if (typeof patch !== 'object' || patch === null) return {};
  const p = patch as Record<string, unknown>;
  const clean: Partial<PieAppearance> = {};
  if (typeof p.theme === 'string' && PIE_THEMES.has(p.theme)) {
    clean.theme = p.theme as PieThemeChoice;
  }
  if (typeof p.opacity === 'number' && Number.isFinite(p.opacity)) {
    clean.opacity = clampPieOpacity(p.opacity);
  }
  return clean;
}
