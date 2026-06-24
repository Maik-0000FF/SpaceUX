// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Resolves a `PieAppearance` into the flat theme payload the native overlay
 * daemon renders (#296 P2b-4a), pushed via `OverlayController.SetTheme` as
 * JSON. Pure (no DOM/IPC) so the core and the unit tests share it.
 *
 * The palettes below are the canonical pie colours: the one place a theme is
 * retuned. Both pie renderers (the live overlay and the editor preview) paint
 * from this payload.
 */

import type { PieAppearance, PieThemeChoice } from '../shared/ipc.js';

export type Rgb = readonly [number, number, number];

export type Palette = {
  /** Idle wedge fill. */
  bg: Rgb;
  /** Hovered wedge fill. */
  bgActive: Rgb;
  /** Wedge rim. */
  border: Rgb;
  /** Label text. */
  label: Rgb;
  /** Idle centre fill when the root is a cancel target. */
  cancelBg: Rgb;
  /** Active centre fill when the root is a cancel target. */
  cancelBgActive: Rgb;
  /** Centre label colour. */
  cancelLabel: Rgb;
  /** Marker-dot colour (submenu depth markers + depth dots). */
  marker: Rgb;
};

/** Mirror of the `--pie-*` tokens per `data-pie-theme` in pie-theme.css. */
export const PALETTES: Record<PieThemeChoice, Palette> = {
  dark: {
    bg: [20, 22, 28],
    bgActive: [80, 110, 180],
    border: [255, 255, 255],
    label: [240, 240, 240],
    cancelBg: [40, 22, 24],
    cancelBgActive: [180, 80, 80],
    cancelLabel: [240, 240, 240],
    marker: [255, 255, 255],
  },
  light: {
    bg: [245, 246, 249],
    bgActive: [60, 95, 200],
    border: [40, 44, 54],
    label: [20, 22, 28],
    cancelBg: [248, 226, 226],
    cancelBgActive: [200, 70, 70],
    cancelLabel: [20, 22, 28],
    marker: [245, 246, 249],
  },
  spaceux: {
    bg: [13, 20, 36],
    bgActive: [0, 120, 170],
    border: [124, 211, 255],
    label: [226, 240, 255],
    cancelBg: [40, 18, 22],
    cancelBgActive: [200, 70, 70],
    cancelLabel: [160, 190, 220],
    marker: [124, 211, 255],
  },
};

const rgb = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`;

/** Flat, JSON-friendly theme the QML overlay paints with. Colours are CSS
 *  `rgb()` strings (Canvas accepts them directly); the wedge/centre alpha is
 *  applied separately from `opacity` so strokes and labels stay fully opaque,
 *  matching how pie-theme.css scales only the fill. */
export type OverlayTheme = {
  /** Idle wedge fill; QML applies `opacity` as its alpha. */
  fill: string;
  /** Hovered wedge fill; QML applies `opacity` as its alpha. */
  fillActive: string;
  /** Wedge rim, drawn at full opacity. */
  stroke: string;
  /** Label text colour, drawn at full opacity. */
  label: string;
  /** Centre disc fill when idle (the idle bg), drawn at `opacity`. */
  center: string;
  /** Centre disc fill when the root is a cancel target and idle (dim red),
   *  drawn at `opacity`. */
  cancelBg: string;
  /** Centre disc fill when the root is a cancel target and active (bright red),
   *  drawn at `opacity`. The non-cancel active fill reuses `fillActive`. */
  cancelBgActive: string;
  /** Centre label colour, drawn at full opacity. */
  cancelLabel: string;
  /** Wedge + centre fill alpha (0..1) — the appearance opacity slider. */
  opacity: number;
  /** Request a compositor backdrop blur behind the pie. Honoured only by a
   *  compositor that supports it (KWin); ignored elsewhere. */
  blur: boolean;
  /** Font-family for the labels. Resolved to the bundled "Inter SemiBold" face
   *  when the appearance leaves it at the default (`''`); a user override passes
   *  through verbatim. The renderers bundle the static Inter-SemiBold face
   *  (src/qt-shared/fonts): Qt does not apply a weight to the variable Inter
   *  face, hence the static one. */
  font: string;
};

/** Resolve the appearance into the overlay's paint payload. An unrecognised
 *  theme (shouldn't happen past the IPC sanitiser) falls back to dark. */
export function buildOverlayTheme(appearance: PieAppearance): OverlayTheme {
  const p = PALETTES[appearance.theme] ?? PALETTES.dark;
  return {
    fill: rgb(p.bg),
    fillActive: rgb(p.bgActive),
    stroke: rgb(p.border),
    label: rgb(p.label),
    center: rgb(p.bg),
    cancelBg: rgb(p.cancelBg),
    cancelBgActive: rgb(p.cancelBgActive),
    cancelLabel: rgb(p.cancelLabel),
    opacity: appearance.opacity,
    blur: appearance.blur,
    font: appearance.fontUi || 'Inter SemiBold',
  };
}
