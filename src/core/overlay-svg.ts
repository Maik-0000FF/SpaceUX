// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Builds the `SetScene` payload the native overlay daemon renders now that the
 * overlay paints the shared pie *graphic* (#344): the whole pie as one SVG
 * string (from {@link buildPieSvg}, the same source the editor preview uses),
 * plus the surface-space sizes the daemon needs around it. Pure (no DOM/IPC),
 * so the core and the unit tests share it.
 *
 * Coordinate spaces:
 *  - buildPieSvg builds in a FIXED reference footprint ({@link OVERLAY_FOOTPRINT},
 *    pie-scale 1); its viewBox spans the full submenu-marker / depth-dot window.
 *  - The pie-size zoom happens at render time: the QML `Image` displays that
 *    viewBox at `displaySize` surface px (= reference window * pieScale), so the
 *    caps, strokes and labels scale losslessly with the whole graphic.
 *  - `extent` is the smaller, state-dependent frosted radius (#324) in surface
 *    px the daemon masks + blurs to.
 */

import {
  buildPieSvg,
  pieRenderExtent,
  BASELINE_CENTER_EM,
  type PieSvgAppearance,
} from './pie-svg.js';
import { pieWindowExtent, ringRadii, type RingRadii } from './pie-geometry.js';
import { currentBranches, navigationRingRotation } from './menu-nav.js';
import { OVERLAY_FOOTPRINT } from './overlay-scene.js';
import type { PieAppearance } from '../shared/ipc.js';
import type { MenuConfig, MenuNode } from '../shared/menu.js';
import type { OverlaySvgScene, PieLabel, PieHitModel, PieHitRing } from '../shared/pie-scene.js';
import type { ShapePluginModule, ShapeRingSlot } from '../shared/shape-plugin-api.js';

export type { OverlaySvgScene, PieLabel };

/** Resolve a `PieAppearance` (IPC shape) into the graphic's appearance inputs.
 *  The font family falls back to the bundled "Inter SemiBold" when unset, the
 *  same default `buildOverlayTheme` uses. */
export function pieSvgAppearanceOf(a: PieAppearance): PieSvgAppearance {
  return {
    theme: a.theme,
    opacity: a.opacity,
    ringBalance: a.ringBalance,
    centerBalance: a.centerBalance,
    labelScale: a.labelScale,
    iconScale: a.iconScale,
    wedgeStyle: a.wedgeStyle,
    wedgeGapStyle: a.wedgeGapStyle,
    wedgeGap: a.wedgeGap,
    wedgeHoverOffset: a.wedgeHoverOffset,
    hideLabels: a.hideLabels,
    hideIcons: a.hideIcons,
    fontFamily: a.fontUi || 'Inter SemiBold',
    showSubmenuMarkers: a.showSubmenuMarkers,
    showDepthDots: a.showDepthDots,
  };
}

/** Whether a node opens a submenu (a click on its sector drills in). */
function isBranchNode(node: MenuNode): boolean {
  return (node.branches?.length ?? 0) > 0;
}

/** One ring's pointer hit-test descriptor (rotation, sector count, radial band,
 *  per-sector branch flags) from its branches + radii. */
function hitRing(
  branches: readonly MenuNode[],
  rotation: number,
  r0: number,
  r1: number,
): PieHitRing {
  return { rotation, count: branches.length, r0, r1, branch: branches.map(isBranchNode) };
}

/**
 * Build the editor preview's wedge hit-test model (#457) from the same config,
 * drill path and radii the SVG was drawn from, so the Qt preview maps a click
 * to a sector without recomputing pie geometry in QML. The active ring is the
 * inner pie at the top level (centre hole → inner rim) and the outer band once
 * drilled, with the parent ring shown as the inner breadcrumb band — each
 * band's radii match the wedges actually drawn, so a click only registers on
 * what is visible. Radii are reference/viewBox units (matching {@link
 * OverlaySvgScene.viewBoxSize}).
 */
function buildPieHitModel(
  config: MenuConfig,
  navigation: readonly number[],
  rings: RingRadii,
): PieHitModel {
  const isDrilled = navigation.length > 0;
  const active = hitRing(
    currentBranches(config, navigation),
    navigationRingRotation(config, navigation),
    isDrilled ? rings.outerInner : rings.cancel,
    isDrilled ? rings.outerOuter : rings.innerOuter,
  );
  if (!isDrilled) return { active, breadcrumb: null };
  const parentNav = navigation.slice(0, -1);
  const breadcrumb = hitRing(
    currentBranches(config, parentNav),
    navigationRingRotation(config, parentNav),
    rings.cancel,
    rings.innerOuter,
  );
  return { active, breadcrumb };
}

/**
 * Full SVG scene for the current drill state. `navigation` is the drill path
 * (`[]` = top level) and `activeSector` the hovered sector in the active ring
 * (drives the highlight + the top-level preview); null = the centre is active.
 *
 * The surface-space sizes (`displaySize`, `extent`) are LOGICAL px at the pie
 * scale. The consumer's compositor scales them up by the monitor's scale, so the
 * pie scales with the monitor like the rest of the desktop UI (#473), instead of
 * being divided to a constant physical size. The editor preview and the live
 * overlay therefore stay the same size as each other on a given monitor. The SVG
 * itself is resolution-independent, so it isn't touched.
 *
 * `shape` is the active shape plugin's module (#325), forwarded to buildPieSvg
 * so the overlay renders plugin nodes instead of wedges; null / omitted keeps
 * the wedge default. The host resolves + loads it (the main-process shape
 * loader) before building the scene. `onShapeFallback` is forwarded too so the
 * host can log when a band reverts to wedges (a broken plugin), keeping the
 * pure core itself log-free.
 */
export function buildOverlaySvgScene(
  config: MenuConfig,
  navigation: readonly number[],
  activeSector: number | null,
  appearance: PieAppearance,
  shape: ShapePluginModule | null = null,
  onShapeFallback?: (ring: ShapeRingSlot, reason: string) => void,
  centreActive?: boolean,
): OverlaySvgScene {
  const svgAppearance = pieSvgAppearanceOf(appearance);
  const labels: PieLabel[] = [];
  // Modern wedge style only: collects the per-wedge (+ centre) polygons for the
  // overlay's blur region and the editor tint (#47 PR2). Stays empty for the
  // classic style and for a shape-plugin pie, so blurWedges is then omitted.
  const wedgePolygons: number[][] = [];
  const svg = buildPieSvg({
    config,
    navigation,
    activeSector,
    centreActive,
    appearance: svgAppearance,
    footprint: OVERLAY_FOOTPRINT,
    shape,
    onShapeFallback,
    emitLabelText: false,
    labelsOut: labels,
    wedgePolygonsOut: wedgePolygons,
  });
  const extentRef = pieRenderExtent({
    config,
    navigation,
    activeSector,
    footprint: OVERLAY_FOOTPRINT,
    ringBalance: appearance.ringBalance,
    centerBalance: appearance.centerBalance,
  });
  const rings = ringRadii(OVERLAY_FOOTPRINT, appearance.ringBalance, appearance.centerBalance);
  const windowExtentRef = pieWindowExtent(OVERLAY_FOOTPRINT, rings.outerOuter);
  return {
    svg,
    extent: extentRef * appearance.scale,
    displaySize: 2 * windowExtentRef * appearance.scale,
    labels,
    viewBoxSize: 2 * windowExtentRef,
    fontFamily: svgAppearance.fontFamily,
    baselineEm: BASELINE_CENTER_EM,
    hit: buildPieHitModel(config, navigation, rings),
    ...(wedgePolygons.length > 0 ? { blurWedges: wedgePolygons } : {}),
  };
}
