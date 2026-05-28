// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Runtime contract for a `kind: 'shape'` plugin (#107). A shape plugin
 * ships pure compute functions (no React, no DOM) that the renderer host
 * calls to lay out and hit-test a non-wedge pie (planets, polygon, ...).
 *
 * The renderer loads the plugin's JS source via a Blob-URL dynamic import
 * in PR2 and validates that the resulting module exports `layout` and
 * `hitTest` against the shape here. The wedge default code path
 * (`describeWedgePath`, `axesToSector`) stays unmodified and is the
 * active path whenever no shape plugin is selected.
 *
 * Shape API is deliberately small and JSON-shaped so the host can hand
 * the layout to standard SVG primitives (`<circle>` + `<text>`) without
 * the plugin reaching into the DOM. Future revisions of this contract
 * (rev'd via PLUGIN_API_VERSION) may add fields; today's plugins should
 * tolerate the host invoking them with at least the documented inputs.
 */

/** A puck axes snapshot the plugin's `hitTest` reads. Same shape as the
 *  live frame the host computes for the wedge default. */
export type ShapePuckAxes = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
};

/** Resolved ring radii passed to `layout` and `hitTest`. Mirrors the
 *  host's `ringRadii()` output: centre hole, inner ring's inner/outer,
 *  outer ring's inner/outer, plus the label-anchor radii used for text
 *  placement. The plugin uses these as the canvas it draws on. */
export type ShapeRingRadii = {
  /** Cancel-zone radius (centre hole). */
  cancelRadius: number;
  /** Inner ring inner/outer radii and its label-anchor radius. */
  innerInnerRadius: number;
  innerOuterRadius: number;
  innerLabelRadius: number;
  /** Outer ring inner/outer radii and its label-anchor radius. */
  outerInnerRadius: number;
  outerOuterRadius: number;
  outerLabelRadius: number;
};

/** One drawable sector node returned by `layout`. The renderer paints
 *  this as a circle centred at `(cx, cy)` with radius `r` (coordinates
 *  are relative to the pie centre). Future contract revisions may add a
 *  shape-kind discriminator to support non-circular nodes. */
export type ShapeNode = {
  cx: number;
  cy: number;
  r: number;
};

/** Label anchor coordinates + horizontal text alignment for a sector.
 *  `anchor` matches the SVG `text-anchor` attribute. */
export type ShapeLabel = {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
};

/** What `layout` returns: one node + one label per sector index in order
 *  (`nodes[i]` and `labels[i]` describe sector `i`). The host renders
 *  these alongside the wedge default whenever a shape plugin is the
 *  selected layout. */
export type ShapeLayout = {
  nodes: readonly ShapeNode[];
  labels: readonly ShapeLabel[];
};

/** The pure compute functions a shape plugin must export from its
 *  `index.js`. Both are stateless and side-effect-free: `layout` is
 *  called per pie open / drill, `hitTest` runs at frame rate. */
export type ShapePluginModule = {
  /** Compute layout for a given sector count + ring radii. Must return
   *  exactly `sectorCount` nodes and labels, in sector-index order. */
  layout(sectorCount: number, ringRadii: ShapeRingRadii): ShapeLayout;
  /** Map a puck axes snapshot to a hovered sector index, or null when no
   *  sector is hovered (the centre / cancel zone). Replaces the wedge
   *  default's `atan2`-bucketed hit-test for this layout only. */
  hitTest(axes: ShapePuckAxes, ringRadii: ShapeRingRadii, layout: ShapeLayout): number | null;
};

/** Structural validator for a module imported from a shape plugin's
 *  source. Returns `null` on success or a single human-readable reason
 *  on failure. Exported so the renderer's loader and unit tests share
 *  the same contract; the validator is intentionally narrow (only
 *  checks the two function exports exist) so a plugin can grow extra
 *  exports without breaking load.
 *
 *  Two things this validator deliberately does NOT do:
 *   - It does not check the *return shape* of `layout` / `hitTest`.
 *     A plugin returning the wrong shape will be caught downstream at
 *     the first render call (defensive parsing is the render-side's
 *     job; see PR3's render dispatch).
 *   - Validation runs *after* the imported module's top-level code has
 *     executed. A plugin that does `globalThis.x = 'pwn'` at top level
 *     has already done so by the time we reject; the contract here
 *     vouches for the exports, not for the load-time side effects. The
 *     same trust contract applies as for `kind: 'function'` plugins. */
export function validateShapePluginModule(mod: unknown): string | null {
  if (typeof mod !== 'object' || mod === null) {
    return 'shape plugin module is not an object';
  }
  const m = mod as Record<string, unknown>;
  if (typeof m.layout !== 'function') {
    return 'shape plugin must export a `layout` function';
  }
  if (typeof m.hitTest !== 'function') {
    return 'shape plugin must export a `hitTest` function';
  }
  return null;
}
