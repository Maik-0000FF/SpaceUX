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

/** Which concentric band of the pie a layout call is computing
 *  positions for. The host calls `layout` once per visible ring so the
 *  plugin can place its nodes on the inner vs outer orbit; ring slots
 *  match the wedge default's "inner pie" + "outer ring" bands. */
export type ShapeRingSlot = 'inner' | 'outer';

/** The pure compute functions a shape plugin must export from its
 *  `index.js`. Both are stateless and side-effect-free: `layout` is
 *  called per pie open / drill (potentially once per visible ring),
 *  `hitTest` runs at frame rate. */
export type ShapePluginModule = {
  /** Compute layout for a given sector count + ring radii on the
   *  specified ring slot (#107). The plugin uses the slot to pick the
   *  appropriate fields from `ringRadii` (e.g. `innerLabelRadius` for
   *  `ring === 'inner'`, `outerLabelRadius` for `ring === 'outer'`) so
   *  the host can render both bands as plugin nodes simultaneously
   *  (active ring + breadcrumb / preview). Must return exactly
   *  `sectorCount` nodes and labels, in sector-index order. */
  layout(sectorCount: number, ringRadii: ShapeRingRadii, ring: ShapeRingSlot): ShapeLayout;
  /** Map a puck axes snapshot to a hovered sector index, or null when no
   *  sector is hovered (the centre / cancel zone). Replaces the wedge
   *  default's `atan2`-bucketed hit-test for this layout only. The host
   *  only calls hitTest against the *active* ring's layout, so the
   *  plugin doesn't need a separate ring slot here. */
  hitTest(axes: ShapePuckAxes, ringRadii: ShapeRingRadii, layout: ShapeLayout): number | null;
};

/** Validate the runtime output of a shape plugin's `layout(...)` call.
 *  PR2's module-shape validator only checks that `layout` / `hitTest`
 *  are exported as functions; it can't check what `layout` *returns* at
 *  call time. This guard runs the defensive check the renderer needs:
 *  the return value is an object with `nodes` and `labels` arrays of
 *  exactly `sectorCount` items, and each item carries the right
 *  numeric / enum fields.
 *
 *  Returns `null` on success (with the value cast to {@link ShapeLayout})
 *  or a human-readable reason on failure. The renderer falls back to
 *  the wedge code path on failure so a malformed plugin output can't
 *  blank the pie or render NaN coordinates. */
export function validateShapeLayout(
  value: unknown,
  sectorCount: number,
): { ok: true; layout: ShapeLayout } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'layout() must return an object' };
  }
  const v = value as { nodes?: unknown; labels?: unknown };
  if (!Array.isArray(v.nodes)) {
    return { ok: false, reason: 'layout().nodes must be an array' };
  }
  if (!Array.isArray(v.labels)) {
    return { ok: false, reason: 'layout().labels must be an array' };
  }
  if (v.nodes.length !== sectorCount) {
    return {
      ok: false,
      reason: `layout().nodes has ${v.nodes.length} entries; expected ${sectorCount} (one per sector)`,
    };
  }
  if (v.labels.length !== sectorCount) {
    return {
      ok: false,
      reason: `layout().labels has ${v.labels.length} entries; expected ${sectorCount} (one per sector)`,
    };
  }
  for (let i = 0; i < sectorCount; i += 1) {
    const n = v.nodes[i] as { cx?: unknown; cy?: unknown; r?: unknown };
    if (typeof n !== 'object' || n === null) {
      return { ok: false, reason: `layout().nodes[${i}] must be an object` };
    }
    for (const key of ['cx', 'cy', 'r'] as const) {
      if (typeof n[key] !== 'number' || !Number.isFinite(n[key])) {
        return {
          ok: false,
          reason: `layout().nodes[${i}].${key} must be a finite number`,
        };
      }
    }
    if ((n.r as number) < 0) {
      return { ok: false, reason: `layout().nodes[${i}].r must be non-negative` };
    }
    const l = v.labels[i] as { x?: unknown; y?: unknown; anchor?: unknown };
    if (typeof l !== 'object' || l === null) {
      return { ok: false, reason: `layout().labels[${i}] must be an object` };
    }
    for (const key of ['x', 'y'] as const) {
      if (typeof l[key] !== 'number' || !Number.isFinite(l[key])) {
        return {
          ok: false,
          reason: `layout().labels[${i}].${key} must be a finite number`,
        };
      }
    }
    if (l.anchor !== 'start' && l.anchor !== 'middle' && l.anchor !== 'end') {
      return {
        ok: false,
        reason: `layout().labels[${i}].anchor must be 'start', 'middle', or 'end'`,
      };
    }
  }
  return { ok: true, layout: value as ShapeLayout };
}

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
