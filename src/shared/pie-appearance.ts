// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure constants and validation for the pie appearance setting — no Node
 * deps, so the core (persistence in app-settings.ts, the wire trust boundary
 * in app-core-service.ts) and the editor model (the slider bounds) import the
 * *same* source. Keeping these here is why the slider range and the core-side
 * clamp can't drift apart.
 */

import type { PieAppearance, PieThemeChoice, PieWedgeGapStyle, PieWedgeStyle } from './ipc';

export const PIE_THEMES: ReadonlySet<string> = new Set<PieThemeChoice>([
  'dark',
  'light',
  'spaceux',
]);

/** Valid built-in wedge styles (#47). An unknown value in a stored/wire
 *  appearance is dropped by the sanitiser, leaving the default `classic`. */
export const PIE_WEDGE_STYLES: ReadonlySet<string> = new Set<PieWedgeStyle>(['classic', 'modern']);

/** Valid modern-wedge gap shapes (#47); unknown values fall back to `parallel`. */
export const PIE_WEDGE_GAP_STYLES: ReadonlySet<string> = new Set<PieWedgeGapStyle>([
  'parallel',
  'wedge',
]);

/** Modern-wedge gap-width slider (#47): a fraction of the footprint. 0 = no gap
 *  (rim-less but edge-to-edge); the max keeps the channel from eating the wedge.
 *  The 0.027 default reproduces the spike-validated look. */
export const PIE_WEDGE_GAP_MIN = 0;
export const PIE_WEDGE_GAP_MAX = 0.06;
export const PIE_WEDGE_GAP_STEP = 0.005;
export const PIE_WEDGE_GAP_DEFAULT = 0.027;

export function clampPieWedgeGap(n: number): number {
  return Math.min(PIE_WEDGE_GAP_MAX, Math.max(PIE_WEDGE_GAP_MIN, n));
}

/** Modern-wedge hover-pop slider (#47): the constant outset the hovered wedge
 *  grows by on every side, as a fraction of the footprint (like the gap). 0 = no
 *  pop. The inner radius moves in, the outer out, and the sides out, all by this. */
export const PIE_WEDGE_HOVER_MIN = 0;
export const PIE_WEDGE_HOVER_MAX = 0.15;
export const PIE_WEDGE_HOVER_STEP = 0.005;
export const PIE_WEDGE_HOVER_DEFAULT = 0.03;

export function clampPieWedgeHover(n: number): number {
  return Math.min(PIE_WEDGE_HOVER_MAX, Math.max(PIE_WEDGE_HOVER_MIN, n));
}

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

/** Icon size as a *fraction of the per-segment fit* (1 = 100% = the fit, a slim
 *  margin off the wedge edges; less = smaller). The renderers cap the scaled
 *  size at the wedge bound (`segmentIconScaledPx`), so even a stale config with
 *  a scale above 1 can never push the icon past the wedge edge (#439). */
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

/** Ring-balance sliders (#182): 0..1 positions, independent. `ringBalance`
 *  moves only the inner-pie / outer-ring split, `centerBalance` only the
 *  centre-hole size; both are footprint-relative so changing one no longer
 *  drags the other. At 0.5/0.5 the centre radius is 1/5 of the footprint and
 *  the inner/outer split 3/5 (a 1:3:5 centre:split:rim look). The footprint (the
 *  size slider) is unchanged; these only repartition it. */
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

/** The "System" preset stack offered by the label-font picker. `''` (stored
 *  when "Bundled" is chosen) resolves to the bundled "Inter SemiBold" face;
 *  this stack deliberately drops the bundled face so the OS font is used.
 *  "Custom" stores the typed family verbatim. */
export const SYSTEM_FONT_UI = 'system-ui, sans-serif';

/** Display name of the bundled label face, shown as "Bundled (Inter)" in the
 *  font picker. The resolved face is "Inter SemiBold" (overlay-svg); this is
 *  just the picker label. */
export const BUNDLED_FONT_UI_LABEL = 'Inter';

/** Defaults preserve the original look: dark palette, fills at ~60% (the
 *  palette's original baked translucency), labels filling the segment (100%).
 *  Opacity scales only the wedge fill alpha — strokes and labels are always
 *  fully opaque. Fonts default to `''` (the bundled stack). */
export const DEFAULT_PIE_APPEARANCE: PieAppearance = {
  theme: 'light',
  opacity: 0.8,
  blur: true,
  labelScale: 0.8,
  iconScale: 1,
  scale: 1,
  ringBalance: 0.5,
  centerBalance: 0.5,
  fontUi: '',
  fontMono: '',
  shapeModel: null,
  wedgeStyle: 'classic',
  wedgeGapStyle: 'parallel',
  wedgeGap: PIE_WEDGE_GAP_DEFAULT,
  wedgeHoverOffset: PIE_WEDGE_HOVER_DEFAULT,
  showSubmenuMarkers: true,
  showDepthDots: true,
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
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .trim()
      .slice(0, FONT_FAMILY_MAX_LEN)
  );
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
 * empty patch. This is the wire trust boundary (used by app-core-service);
 * keeping it pure makes the boundary behaviour unit-testable in isolation.
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
  if (typeof p.blur === 'boolean') {
    clean.blur = p.blur;
  }
  if (typeof p.labelScale === 'number' && Number.isFinite(p.labelScale)) {
    clean.labelScale = clampPieLabelScale(p.labelScale);
  }
  if (typeof p.iconScale === 'number' && Number.isFinite(p.iconScale)) {
    clean.iconScale = clampPieIconScale(p.iconScale);
  }
  if (typeof p.hideLabels === 'boolean') {
    clean.hideLabels = p.hideLabels;
  }
  if (typeof p.hideIcons === 'boolean') {
    clean.hideIcons = p.hideIcons;
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
  if (typeof p.wedgeStyle === 'string' && PIE_WEDGE_STYLES.has(p.wedgeStyle)) {
    clean.wedgeStyle = p.wedgeStyle as PieWedgeStyle;
  }
  if (typeof p.wedgeGapStyle === 'string' && PIE_WEDGE_GAP_STYLES.has(p.wedgeGapStyle)) {
    clean.wedgeGapStyle = p.wedgeGapStyle as PieWedgeGapStyle;
  }
  if (typeof p.wedgeGap === 'number' && Number.isFinite(p.wedgeGap)) {
    clean.wedgeGap = clampPieWedgeGap(p.wedgeGap);
  }
  if (typeof p.wedgeHoverOffset === 'number' && Number.isFinite(p.wedgeHoverOffset)) {
    clean.wedgeHoverOffset = clampPieWedgeHover(p.wedgeHoverOffset);
  }
  if (typeof p.showSubmenuMarkers === 'boolean') {
    clean.showSubmenuMarkers = p.showSubmenuMarkers;
  }
  if (typeof p.showDepthDots === 'boolean') {
    clean.showDepthDots = p.showDepthDots;
  }
  return clean;
}
