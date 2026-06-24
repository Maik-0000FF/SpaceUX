// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types for the rendered pie scene. `OverlaySvgScene` is the payload the
 * core builds (`buildOverlaySvgScene`) and that both the native overlay daemon
 * and the Qt editor render; the editor receives it from the core contract's
 * `BuildScene`. `PieLabel` is one native-text label descriptor inside it. These
 * live in `shared` so they are the leaf that both `core` (the builder) and the
 * editor contract depend on, with no `shared -> core` inversion.
 */

/** A single menu label as a plain descriptor, in viewBox/footprint coords. The
 *  overlay / editor re-render these as native text (sharp at any DPR) instead of
 *  the `<text>` the SVG carries, so the descriptor mirrors the SVG label's
 *  placement exactly: `x`/`y`/`fontPx` in the same reference space, `y` the
 *  VISUAL CENTRE (before the SVG's baseline shift, so the renderer applies its
 *  own vertical centring), and the same `color` (`"rgb(r, g, b)"`), `opacity` and
 *  `anchor`. Collected alongside the SVG so the two can never drift. */
export type PieLabel = {
  text: string;
  x: number;
  y: number;
  fontPx: number;
  color: string;
  opacity: number;
  anchor: 'start' | 'middle' | 'end';
};

export type OverlaySvgScene = {
  /** The whole pie as an SVG string; the QML renderer shows it as an `Image`
   *  data URI. Colours, icons, markers and dots are all baked in. */
  svg: string;
  /** Frosted-blur + input-region radius (surface logical px). State-dependent:
   *  the inner ring at the top level, the outer ring once a preview / drill makes
   *  the outer band visible (#324). The daemon reads this for the mask. */
  extent: number;
  /** Square edge (surface logical px) the SVG viewBox maps to, centred on the
   *  surface: the reference window (full marker/dot reserve) times pieScale,
   *  divided by the monitor's device-pixel ratio so the on-screen physical size
   *  stays constant across fractional scaling (#344, #71 family). */
  displaySize: number;
  /** The pie's menu labels as native-text descriptors (viewBox coords, the SAME
   *  the SVG was built from, with `emitLabelText: false` so the SVG carries no
   *  `<text>`). The QML overlay renders these as native Text on top of the SVG
   *  so the labels stay sharp at any DPR. */
  labels: PieLabel[];
  /** Square edge of the SVG viewBox (reference units): the labels' x/y are in
   *  this space, centred on 0, so QML maps them as `(coord + viewBoxSize/2) *
   *  displaySize / viewBoxSize`. */
  viewBoxSize: number;
  /** Resolved label font family (e.g. "Inter SemiBold"), so the QML Text uses
   *  the same face the SVG `<text>` would have. */
  fontFamily: string;
  /** Baseline offset (em) to add to a label's visual-centre y to get its
   *  baseline, so the QML overlay centres text exactly like the SVG (#344). */
  baselineEm: number;
  /** Pointer hit-test model for the editor preview's wedge rings (the active
   *  ring, plus the breadcrumb ring once drilled). The overlay ignores it (its
   *  input comes from the daemon's axes, not pointer picks); it exists so the
   *  Qt editor maps a click to a sector against the same geometry the SVG was
   *  drawn from instead of recomputing pie constants in QML. */
  hit: PieHitModel;
  /** Modern wedge style only (#47 PR2): each rendered wedge plus the centre disc
   *  as a flat point polygon `[x0, y0, x1, y1, ...]` in viewBox/reference coords
   *  (the SAME space as `labels`, centred on 0). The native overlay unions these
   *  into a per-wedge compositor blur region so the gaps stay sharp; the editor
   *  preview tints them as a glass hint. Absent for the classic style and for a
   *  shape-plugin pie (no wedges to gap), where the daemon keeps the single
   *  circular region. */
  blurWedges?: number[][];
};

/** One interactive ring's angular sectors for the editor preview's pointer
 *  hit-test, in viewBox/reference coords (the SAME space as {@link
 *  OverlaySvgScene.viewBoxSize} and the labels, centred on 0). The QML preview
 *  maps a click to reference coords, subtracts `rotation`, then picks the
 *  nearest of `count` equal sectors — generic angular math, no pie constants on
 *  the QML side. `r0`/`r1` are the ring's inner/outer radius so a click outside
 *  the band misses, and `branch[i]` says whether sector `i` drills (has its own
 *  submenu) or just selects. */
export type PieHitRing = {
  /** Ring rotation (rad) to undo before picking the sector. */
  rotation: number;
  /** Sector count (equal angular slices). */
  count: number;
  /** Inner radius of the ring's band (reference units). */
  r0: number;
  /** Outer radius of the ring's band (reference units). */
  r1: number;
  /** Per-sector: true if the sector has children (a click drills in). */
  branch: boolean[];
};

/** The wedge pie's pointer hit-test: the active ring (always present, the inner
 *  pie at the top level and the outer band once drilled) and the breadcrumb /
 *  parent ring (only when drilled, the inner band). Wedge layout only — a shape
 *  plugin's custom hit-test is not modelled here (the editor preview loads no
 *  shape plugin yet). */
export type PieHitModel = {
  active: PieHitRing;
  breadcrumb: PieHitRing | null;
};
