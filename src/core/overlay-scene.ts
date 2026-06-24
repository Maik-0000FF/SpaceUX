// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The native overlay's fixed reference footprint.
 *
 * This module used to build the `SetScene` payload as a wedge/node *sector*
 * scene (`buildOverlayScene` → `OverlayScene`, rendered by a QML `tracePath`).
 * The #344 SVG convergence replaced that: the overlay now renders a single
 * `buildPieSvg` SVG (see `overlay-svg.ts`), so the sector scene and its types
 * were removed (#325). Only the footprint constant remains, kept here as its
 * long-standing home so `overlay-svg.ts` and the main process keep importing it
 * from the same place.
 */

import { OUTER_RING_OUTER_RATIO } from './pie-geometry.js';

/** The pie's base reference radius at pie-scale 1 (viewBox px). The single knob
 *  for the default pie size: everything below is a ratio of the footprint, so
 *  changing this scales the whole pie as one. A round 160 (down from the original
 *  240) is the recalibrated default (#456) — with the monitor scale now applied
 *  by the compositor (#473) instead of divided out, the old base was too large. */
const PIE_BASE_RADIUS = 160;

/** Pie outer radius (reference px) at pie-scale 1. The native overlay's ring
 *  radii, label-font caps, stroke widths and icon fits all derive from this, and
 *  the main process derives the surface size + cursor margins from it; the
 *  pie-size slider multiplies it. */
export const OVERLAY_FOOTPRINT = PIE_BASE_RADIUS * OUTER_RING_OUTER_RATIO;
