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

/** Label size as a *fraction of the per-segment fit* (1 = 100% = fill the
 *  segment's available space; less = smaller). The renderer computes the fit
 *  from the sector count + radius, so the same fraction yields smaller labels
 *  when there are more (narrower) segments — labels never spill past a wedge. */
export const PIE_LABEL_SCALE_MIN = 0.2;
export const PIE_LABEL_SCALE_MAX = 1;
export const PIE_LABEL_SCALE_STEP = 0.05;

/** Icon size as a *fraction of the per-segment fit* (1 = 100% = the largest
 *  icon that fits a wedge without crossing its edges; less = smaller) — the
 *  same contract as the label scale. Unlike the label, the icon is an SVG
 *  `<image>` dimension computed in TSX, so the renderers multiply this factor
 *  into the per-segment fit rather than reading a CSS var. */
export const PIE_ICON_SCALE_MIN = 0.2;
export const PIE_ICON_SCALE_MAX = 1;
export const PIE_ICON_SCALE_STEP = 0.05;

/** Overall pie size multiplier (1 = the default size). Part of the pie style
 *  now (#186 follow-up) — a global appearance setting like the others, so it's
 *  editable regardless of whether the active menu source is writable, and rides
 *  a device profile's bundled appearance. Was the per-menu `MenuConfig.scale`. */
export const PIE_SCALE_MIN = 0.5;
export const PIE_SCALE_MAX = 2;
export const PIE_SCALE_STEP = 0.05;

/** Ring-balance sliders (#182): 0..1 positions, 0.5 reproduces the historical
 *  pie proportions. `ringBalance` shifts the inner-pie / outer-ring split,
 *  `centerBalance` the centre-hole / inner-pie split. The footprint (the size
 *  slider) is unchanged; these only repartition it. */
export const PIE_BALANCE_MIN = 0;
export const PIE_BALANCE_MAX = 1;
export const PIE_BALANCE_STEP = 0.05;

export function clampPieBalance(n: number): number {
  return Math.min(PIE_BALANCE_MAX, Math.max(PIE_BALANCE_MIN, n));
}

/** Length cap for a stored font-family override. The value is only ever fed
 *  into `font-family: var(--pie-font-*)` via the CSSOM, which rejects a
 *  malformed value (the font simply falls back), so we only keep it a sane
 *  single-line token and bound its length for the settings file. */
export const FONT_FAMILY_MAX_LEN = 200;

/** Preset font stacks offered by the editor's font picker. `''` (stored when
 *  "Bundled" is chosen) falls through to the bundled default in
 *  typography.css; these stacks deliberately drop the bundled face so the OS
 *  font is used for "System". "Custom" stores the typed family verbatim. */
export const SYSTEM_FONT_UI = 'system-ui, sans-serif';
export const SYSTEM_FONT_MONO = 'monospace';

/** Defaults preserve the original look: dark palette, fills at ~60% (the
 *  palette's original baked translucency), labels filling the segment (100%).
 *  Opacity scales only the wedge fill alpha — strokes and labels are always
 *  fully opaque. Fonts default to `''` (the bundled stack). */
export const DEFAULT_PIE_APPEARANCE: PieAppearance = {
  theme: 'dark',
  opacity: 0.6,
  labelScale: 1,
  iconScale: 0.5,
  scale: 1,
  ringBalance: 0.5,
  centerBalance: 0.5,
  fontUi: '',
  fontMono: '',
  shapeModel: null,
};

/** Length cap for a stored shape-model identifier. The renderer accepts
 *  any non-empty string and falls back to the wedge default when the
 *  reference doesn't resolve to an installed plugin, so the structural
 *  guard here is only against absurd inputs (a hand-edited settings file
 *  with a megabyte string). The composite key is `<pluginId>/<shapeId>`,
 *  so 200 chars is generous: each side is a reverse-DNS-style id that
 *  comfortably fits in 80. */
export const SHAPE_MODEL_MAX_LEN = 200;

/** Normalise a shape-model id from an untrusted source. Strips control
 *  characters, trims, caps the length, and folds an empty result to
 *  `null` (the wedge default). A `null` input passes through unchanged.
 *  Does NOT verify the id resolves to an installed plugin; the renderer
 *  treats an unknown id as "fall back to wedge" so a saved appearance
 *  survives the plugin being uninstalled. */
export function clampShapeModel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (cleaned === '') return null;
  return cleaned.slice(0, SHAPE_MODEL_MAX_LEN);
}

/** Normalise a font-family override: strip control characters, trim, and cap
 *  the length. An empty result means "use the bundled default". */
export function clampFontFamily(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim()
    .slice(0, FONT_FAMILY_MAX_LEN);
}

export function clampPieOpacity(n: number): number {
  return Math.min(PIE_OPACITY_MAX, Math.max(PIE_OPACITY_MIN, n));
}

export function clampPieLabelScale(n: number): number {
  return Math.min(PIE_LABEL_SCALE_MAX, Math.max(PIE_LABEL_SCALE_MIN, n));
}

export function clampPieIconScale(n: number): number {
  return Math.min(PIE_ICON_SCALE_MAX, Math.max(PIE_ICON_SCALE_MIN, n));
}

export function clampPieScale(n: number): number {
  return Math.min(PIE_SCALE_MAX, Math.max(PIE_SCALE_MIN, n));
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
  if (typeof p.labelScale === 'number' && Number.isFinite(p.labelScale)) {
    clean.labelScale = clampPieLabelScale(p.labelScale);
  }
  if (typeof p.iconScale === 'number' && Number.isFinite(p.iconScale)) {
    clean.iconScale = clampPieIconScale(p.iconScale);
  }
  if (typeof p.scale === 'number' && Number.isFinite(p.scale)) {
    clean.scale = clampPieScale(p.scale);
  }
  if (typeof p.ringBalance === 'number' && Number.isFinite(p.ringBalance)) {
    clean.ringBalance = clampPieBalance(p.ringBalance);
  }
  if (typeof p.centerBalance === 'number' && Number.isFinite(p.centerBalance)) {
    clean.centerBalance = clampPieBalance(p.centerBalance);
  }
  if (typeof p.fontUi === 'string') {
    clean.fontUi = clampFontFamily(p.fontUi);
  }
  if (typeof p.fontMono === 'string') {
    clean.fontMono = clampFontFamily(p.fontMono);
  }
  // `shapeModel` accepts `null` (the wedge default) or a non-empty string
  // (clamped + trimmed); anything else is dropped from the patch instead
  // of being silently coerced. The renderer's fallback to wedge handles
  // an unknown id at runtime, so we don't gatekeep against installed
  // plugins at the IPC boundary.
  if (p.shapeModel === null || typeof p.shapeModel === 'string') {
    clean.shapeModel = clampShapeModel(p.shapeModel);
  }
  return clean;
}
