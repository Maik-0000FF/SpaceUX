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
