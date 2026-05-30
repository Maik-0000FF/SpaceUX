// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, useRef, useState, type CSSProperties } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { PLUGIN_MENU_ID_PREFIX, parseWorkbenchMenuId } from '@/shared/plugin-types';
import { menuTreeDepth, navigationRingRotation } from '@/core/menu-nav';
import {
  OUTER_RING_OUTER_RATIO,
  PLUGIN_BADGE_RATIO,
  ringRadii,
  sectorCenterAngle,
  segmentIconFitPx,
  segmentLabelFontPx,
  SUBMENU_MARKER_DOT_RATIO,
  SUBMENU_MARKER_GAP_RATIO,
  truncatePieLabel,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import { isCancelNode, resolveShapeModel } from '@/shared/menu';
import { type ShapeRingRadii } from '@/shared/shape-plugin-api';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useLivePreviewNavigation } from '../hooks/useLivePreviewNavigation';
import { usePieAppearance } from '../hooks/usePieAppearance';
import { useAppState } from '../state/app-state';
import { useCatalog } from '../state/catalog';
import { useMenuSettings } from '../state/menu-settings';
import { nodeKey } from '../state/node-keys';
import { ringBranches } from '../state/selectors';

import styles from './MenuPreview.module.scss';
import { sectorIcon } from './sectorIcon';
import { ShapePie } from './ShapePie';

const TAU = Math.PI * 2;

// Live pie's radius (PieMenu default) so fonts/strokes render at their true
// proportions; the viewBox scales the whole thing down to the panel — a
// faithful, just-smaller pie. Ratios are shared with the live PieMenu.
// Fixed footprint (matches the live PieMenu default inner radius × the
// footprint ratio). The viewBox reserves it; the balance sliders only
// repartition the footprint, so the overall preview size never changes. The
// per-ring radii are resolved per render from the appearance (see below).
const FOOTPRINT = 240 * OUTER_RING_OUTER_RATIO;
// Submenu-marker orbit + dot (#216). The viewBox reserves room for the dots
// just outside the outer ring (matches the live PieMenu's svgExtent), so VIEW
// is a touch larger than the footprint; the badges stay pinned to the footprint
// corner, not this enlarged extent.
const MARKER_DOT = FOOTPRINT * SUBMENU_MARKER_DOT_RATIO;
const VIEW = FOOTPRINT * (1 + SUBMENU_MARKER_GAP_RATIO) + MARKER_DOT; // viewBox half-extent

/**
 * Centre stage: the menu drawn exactly as the live pie shows it. The
 * **current** menu is the active ring — the inner band at the top level,
 * and the outer band once drilled in (the parent menu then fills the inner
 * band as a dimmed breadcrumb, with the drilled-into node marked). The
 * centre is the cancel target.
 *
 * Clicking a leaf in the active ring selects it; clicking a branch drills
 * into it (its submenu becomes the new active outer ring); dragging
 * reorders within the active ring. Clicking a breadcrumb node navigates
 * back up to it.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const moveNode = useMenuSettings((s) => s.moveNode);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectNode = useAppState((s) => s.selectNode);
  const selectPath = useAppState((s) => s.selectPath);
  const selectCenter = useAppState((s) => s.selectCenter);
  const centerSelected = useAppState((s) => s.centerSelected);
  const drillInto = useAppState((s) => s.drillInto);
  const livePreview = useAppState((s) => s.livePreview);
  // While live, the full configured navigation runs against the puck (#177):
  // drill / cycle / twist / back / aim, driving the editor's own viewPath plus
  // this highlighted sector — but the terminal commits (close / fire action)
  // are suppressed, so the preview is a non-destructive sandbox.
  const liveSticky = useLivePreviewNavigation(livePreview, config);
  // Icon size tracks the appearance slider (#169); the icon is a JS-computed
  // SVG dimension, so unlike the label scale it can't ride a CSS var. The
  // per-ring fit is computed below, once the ring geometry is known.
  const { appearance } = usePieAppearance();
  // Resolve the ring radii from the fixed footprint + the balance sliders
  // (#182). Local UPPER_CASE names so the render sites below read unchanged;
  // INNER_PIE_OUTER is the inner pie's rim (was the bare `RADIUS` constant).
  const rings = ringRadii(FOOTPRINT, appearance.ringBalance, appearance.centerBalance);
  const INNER_PIE_OUTER = rings.innerOuter;
  const INNER_RADIUS = rings.cancel;
  const OUTER_INNER_RADIUS = rings.outerInner;
  const OUTER_OUTER_RADIUS = rings.outerOuter;
  const INNER_LABEL_RADIUS = rings.innerLabel;
  const OUTER_LABEL_RADIUS = rings.outerLabel;

  // Repack the host's ring radii into the shape-plugin contract once per
  // (ringBalance, centerBalance) tuple. Without the memo, this object
  // literal would be a fresh reference every render, defeating the
  // memo inside ShapePie that gates the plugin's `layout()` call:
  // the layout would re-run at frame rate during live preview.
  const shapeRingRadii = useMemo<ShapeRingRadii>(
    () => ({
      cancelRadius: INNER_RADIUS,
      innerInnerRadius: INNER_RADIUS,
      innerOuterRadius: INNER_PIE_OUTER,
      innerLabelRadius: INNER_LABEL_RADIUS,
      outerInnerRadius: OUTER_INNER_RADIUS,
      outerOuterRadius: OUTER_OUTER_RADIUS,
      outerLabelRadius: OUTER_LABEL_RADIUS,
    }),
    [
      INNER_RADIUS,
      INNER_PIE_OUTER,
      INNER_LABEL_RADIUS,
      OUTER_INNER_RADIUS,
      OUTER_OUTER_RADIUS,
      OUTER_LABEL_RADIUS,
    ],
  );

  // Active-plugin badge (#186): when this plugin's pie is the active source
  // (its dynamic menu or a curated workbench pie), show its app icon in the
  // bottom-left corner. Sourced from the catalog plugin (FreeCAD today); the
  // mechanism is generic via the plugin's manifest `badge`.
  const catalogPlugin = useCatalog((s) => s.plugin);
  const appBadge = useCatalog((s) => s.appBadge);
  const activeSource = useDeviceInfo().profileId;
  const pluginBadge = useMemo(() => {
    if (!catalogPlugin) return null;
    const onPlugin =
      activeSource === `${PLUGIN_MENU_ID_PREFIX}${catalogPlugin.id}` ||
      parseWorkbenchMenuId(activeSource)?.pluginId === catalogPlugin.id;
    if (!onPlugin) return null;
    // Live app icon from the bridge (FreeCAD's own, not bundled — #186), else a
    // plugin that ships a static manifest badge.
    return appBadge ?? catalogPlugin.badge ?? null;
  }, [catalogPlugin, appBadge, activeSource]);

  // Active-workbench badge (#229), bottom-right: the active *curated* workbench's
  // own icon, from the catalog group for its key. Only for a curated `wb:` source
  // (a dynamic source's live workbench isn't known to the editor).
  const catalogGroups = useCatalog((s) => s.groups);
  const workbenchBadge = useMemo(() => {
    if (!catalogPlugin) return null;
    const parsed = parseWorkbenchMenuId(activeSource);
    if (!parsed || parsed.pluginId !== catalogPlugin.id) return null;
    return catalogGroups.find((g) => g.key === parsed.workbenchKey)?.icon ?? null;
  }, [catalogPlugin, catalogGroups, activeSource]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);

  const currentRing = config ? ringBranches(config, viewPath) : [];
  if (!config) {
    return <p className={styles.empty} />;
  }
  // An empty ring (the top-level ring deleted down to just the centre) is not
  // an error — fall through and render the pie with no wedges, so the preview
  // shows the centre alone, 1:1 with the live overlay.

  const isDrilled = viewPath.length > 0;
  const parentRing = isDrilled ? ringBranches(config, viewPath.slice(0, -1)) : [];
  const drilledIntoIndex = isDrilled ? viewPath[viewPath.length - 1]! : -1;
  // Effective shape model resolves once per render so the breadcrumb +
  // preview rings and the active-ring dispatch agree on whether a shape
  // plugin is in play. When non-null, the surrounding wedge bands are
  // suppressed so the preview shows only the active ring + centre, the
  // same way the live overlay does (the breadcrumb / preview-of-children
  // metaphors don't translate to orbital nodes).
  const effectiveShape = resolveShapeModel(config.shapeModel, appearance.shapeModel);

  // Depth dots (shared look with the live overlay): first dot = the centre,
  // then one per ring level (1 + deepest path). Active = the centre when the
  // centre is the focus, else the current ring's dot. Centre dot is red when
  // the centre is a cancel target. While live, the focus follows the puck
  // (centre = no sector hovered at the top), like the overlay's depth dots —
  // not the click-selection `centerSelected`, which would stick on dot 0 after
  // clicking the centre and skip the first ring's dot during puck navigation.
  const dotCount = 1 + menuTreeDepth(config);
  const atCentreDot = livePreview ? viewPath.length === 0 && liveSticky === null : centerSelected;
  const activeDot = Math.min(atCentreDot ? 0 : viewPath.length + 1, dotCount - 1);

  // Same size formula as the live pie so the preview matches its on-screen
  // size and tracks the slider live. The `/ devicePixelRatio` is a
  // compositor-specific correction for this KDE Wayland setup's fractional
  // scaling (see PieMenu's note / #71), not standard Chromium. Read at
  // render, not reactive — dragging the editor to a different-DPR monitor
  // updates on the next render. The viewBox stays VIEW·2; only the rendered
  // px size scales.
  const displaySize = (VIEW * 2 * appearance.scale) / (window.devicePixelRatio || 1);

  // Active ring = the current menu: inner band at top level, outer band when
  // drilled in. Rotated (when drilled) so its sector 0 lines up with the
  // parent sector — the live pie's preview-ring rotation.
  const count = currentRing.length;
  const half = Math.PI / count;
  const activeRotation = isDrilled ? navigationRingRotation(config, viewPath) : 0;
  // The breadcrumb (parent ring shown inner when drilled) keeps the parent
  // ring's own rotation, so its sectors stay where they sat while it was the
  // active ring — otherwise the node you drilled from jumps to 12 o'clock the
  // moment you go a level deeper. Mirrors the overlay (PieMenu).
  const breadcrumbRotation = isDrilled ? navigationRingRotation(config, viewPath.slice(0, -1)) : 0;
  const activeOuter = isDrilled ? OUTER_OUTER_RADIUS : INNER_PIE_OUTER;
  const activeInner = isDrilled ? OUTER_INNER_RADIUS : INNER_RADIUS;
  const activeLabel = isDrilled ? OUTER_LABEL_RADIUS : INNER_LABEL_RADIUS;
  // Per-segment icon fit × the appearance icon-scale (100% = fills the wedge),
  // one size per ring since the inner pie and outer ring have different room.
  const activeIconSize =
    segmentIconFitPx(activeLabel, count, activeInner, activeOuter) * appearance.iconScale;
  const breadcrumbIconSize = isDrilled
    ? segmentIconFitPx(INNER_LABEL_RADIUS, parentRing.length, INNER_RADIUS, INNER_PIE_OUTER) *
      appearance.iconScale
    : 0;

  // The centre is the *active* target whenever no sector is — mirroring the
  // live overlay (cancelActive = activeSector === null), so a cancel centre
  // shows its bright/active red right away instead of only after it's clicked
  // (the idle red is near-black and reads as "no centre, just a full ring").
  // While live, the highlight is the puck-driven sticky (the navigation hook
  // resolves the aim source / deadzone / cycling); otherwise the click select.
  const activeSector = livePreview ? liveSticky : selectedIndex;
  // While live, the centre lights from the puck alone (no sector hovered), like
  // the overlay — not from the click-selection `centerSelected`, which would
  // keep the centre stuck active after clicking it during a live session.
  const centerActive = livePreview
    ? activeSector === null
    : centerSelected || activeSector === null;

  // Preview ring (live, top level only), mirroring the live overlay (PieMenu):
  // when the puck hovers a branch sector, fade in its children as a dimmed,
  // non-interactive outer ring so the author sees what's inside before drilling
  // — the missing half of overlay parity (#177). Rotated so its sector 0 lines
  // up with the hovered parent, exactly like the overlay's preview rotation.
  // Gated on livePreview: the overlay has no click-selection, so a statically
  // selected branch shouldn't conjure a child ring during normal editing. At
  // depth > 0 the outer band is the active ring itself, so no preview (as overlay).
  const previewSectors =
    livePreview && !isDrilled && activeSector !== null
      ? currentRing[activeSector]?.branches
      : undefined;
  const previewRotation =
    previewSectors && activeSector !== null ? sectorCenterAngle(activeSector, count) : 0;
  const previewIconSize = previewSectors
    ? segmentIconFitPx(
        OUTER_LABEL_RADIUS,
        previewSectors.length,
        OUTER_INNER_RADIUS,
        OUTER_OUTER_RADIUS,
      ) * appearance.iconScale
    : 0;

  // Pointer angle → active-ring sector (undoing the ring's rotation; radius
  // irrelevant since reorder is angular).
  const sectorUnderPointer = (e: React.PointerEvent): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm || count === 0) return null; // no wedges → nothing to hit
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let theta = Math.atan2(p.x, -p.y) - activeRotation;
    theta = ((theta % TAU) + TAU) % TAU;
    return Math.round(theta / (TAU / count)) % count;
  };

  const endDrag = (): void => {
    setDragFrom(null);
    setDropTo(null);
  };

  return (
    <div className={styles.previewWrap}>
      <svg
        ref={svgRef}
        className={styles.pie}
        style={{ width: displaySize, height: displaySize }}
        viewBox={`-${VIEW} -${VIEW} ${VIEW * 2} ${VIEW * 2}`}
        role="group"
        aria-label="Menu preview"
        onPointerMove={(e) => {
          if (dragFrom === null) return;
          const to = sectorUnderPointer(e);
          if (to !== null) setDropTo(to);
        }}
        onPointerUp={() => {
          if (dragFrom === null) return;
          const from = dragFrom;
          const to = dropTo;
          endDrag();
          if (to !== null && to !== from) {
            moveNode(viewPath, from, to);
            selectNode(to);
          } else if (currentRing[from]?.branches?.length) {
            drillInto(from); // click a branch → go in (it becomes the outer ring)
          } else {
            selectNode(from); // click a leaf → select for editing
          }
        }}
        onPointerCancel={endDrag}
      >
        {/* Breadcrumb ring (the parent menu): only rendered when drilled.
          Wedge default = dimmed + clickable to navigate back up;
          drilled-into node marked brighter. When a shape plugin is the
          effective layout, the breadcrumb sectors render via ShapePie
          on the inner band instead (see the parallel block below), so
          this wedge map is suppressed. */}
        {isDrilled &&
          effectiveShape === null &&
          parentRing.map((node, i) => {
            const c = sectorCenterAngle(i, parentRing.length) + breadcrumbRotation;
            const h = Math.PI / parentRing.length;
            const d = describeWedgePath(INNER_PIE_OUTER, INNER_RADIUS, c - h, c + h);
            const lx = Math.sin(c) * INNER_LABEL_RADIUS;
            const ly = -Math.cos(c) * INNER_LABEL_RADIUS;
            const labelText = truncatePieLabel(node.label);
            return (
              <g
                key={`crumb-${nodeKey(node)}`}
                className={styles.breadcrumbGroup}
                role="button"
                tabIndex={0}
                aria-label={`Back to ${node.label}`}
                onClick={() => selectPath([...viewPath.slice(0, -1), i])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectPath([...viewPath.slice(0, -1), i]);
                  }
                }}
              >
                <path
                  d={d}
                  className={`${styles.wedgeBreadcrumb} ${
                    i === drilledIntoIndex ? styles.wedgeDrilledInto : ''
                  }`}
                />
                {sectorIcon(node, lx, ly, breadcrumbIconSize)}
                <text
                  x={lx}
                  y={isRenderableIcon(node.icon) ? ly + breadcrumbIconSize * 0.5 : ly}
                  className={styles.labelBreadcrumb}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: `calc(${segmentLabelFontPx(INNER_LABEL_RADIUS, parentRing.length, [...labelText].length)}px * var(--pie-label-scale, 1))`,
                  }}
                >
                  {labelText}
                </text>
              </g>
            );
          })}

        {/* Breadcrumb ring as plugin nodes: parallel to the wedge map
          above, runs when a shape plugin is the effective layout and
          we're drilled. Non-interactive in the editor for now (the
          wedge breadcrumb above is the canonical clickable navigation
          path); same visual parity as the live overlay's inner band. */}
        {isDrilled && effectiveShape !== null && parentRing.length > 0 && (
          <g aria-hidden="true" className={styles.previewGroup}>
            <ShapePie
              shapeKey={effectiveShape}
              sectors={parentRing}
              ringRadii={shapeRingRadii}
              ring="inner"
              selectedIndex={null}
              iconSize={breadcrumbIconSize}
              labelRadius={INNER_LABEL_RADIUS}
              fallback={null}
            />
          </g>
        )}

        {/* Active ring (the current menu): select / drag-reorder / drill.
            When a shape plugin is active (resolveShapeModel returns a
            non-null key), the map below is wrapped in a ShapePie that
            renders the same sectors as the plugin's layout output;
            ShapePie's `fallback` keeps the wedge map reachable while the
            plugin is loading or if its layout output fails validation. */}
        {(() => {
          const wedgeMap = currentRing.map((node, i) => {
            const c = sectorCenterAngle(i, count) + activeRotation;
            const d = describeWedgePath(activeOuter, activeInner, c - half, c + half);
            // While live, the highlight follows the puck (liveSticky); otherwise
            // it's the click selection. The click selection still drives editing.
            const selected = livePreview ? liveSticky === i : selectedIndex === i;
            const isDropTarget = dragFrom !== null && dropTo === i && dropTo !== dragFrom;
            const lx = Math.sin(c) * activeLabel;
            const ly = -Math.cos(c) * activeLabel;
            const labelText = truncatePieLabel(node.label);
            return (
              <g
                key={nodeKey(node)}
                className={`${styles.wedgeGroup} ${dragFrom === i ? styles.dragging : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setDragFrom(i);
                  setDropTo(i);
                  svgRef.current?.setPointerCapture(e.pointerId);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (currentRing[i]?.branches?.length) drillInto(i);
                    else selectNode(i);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={`${node.branches?.length ? 'Open' : 'Select'} ${node.label}`}
                aria-pressed={selected}
              >
                <path
                  d={d}
                  className={`${styles.wedge} ${selected ? styles.wedgeSelected : ''} ${
                    isDropTarget ? styles.wedgeDropTarget : ''
                  } ${isCancelNode(node) ? styles.wedgeCancel : ''}`}
                />
                {sectorIcon(node, lx, ly, activeIconSize)}
                <text
                  x={lx}
                  y={isRenderableIcon(node.icon) ? ly + activeIconSize * 0.5 : ly}
                  className={styles.label}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: `calc(${segmentLabelFontPx(activeLabel, count, [...labelText].length)}px * var(--pie-label-scale, 1))`,
                  }}
                >
                  {labelText}
                </text>
              </g>
            );
          });

          // The effective shape model was resolved at the top of the
          // component so the breadcrumb / preview gates can read it
          // too. `null` means render as wedge, so return the wedge
          // map directly. A non-null key dispatches to ShapePie, with
          // the ring slot picked to match which band the active ring
          // sits in (inner at top level, outer once drilled). This
          // matches the live overlay's per-slot dispatch.
          if (effectiveShape === null) return wedgeMap;

          const selectedIdx = livePreview ? liveSticky : selectedIndex;
          return (
            <ShapePie
              shapeKey={effectiveShape}
              sectors={currentRing}
              ringRadii={shapeRingRadii}
              ring={isDrilled ? 'outer' : 'inner'}
              selectedIndex={selectedIdx}
              iconSize={activeIconSize}
              labelRadius={activeLabel}
              dropTo={dropTo}
              dragFrom={dragFrom}
              onSectorPointerDown={(i, e) => {
                if (e.button !== 0) return;
                setDragFrom(i);
                setDropTo(i);
                svgRef.current?.setPointerCapture(e.pointerId);
              }}
              onSectorKeyDown={(i, e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (currentRing[i]?.branches?.length) drillInto(i);
                  else selectNode(i);
                }
              }}
              fallback={wedgeMap}
            />
          );
        })()}

        {/* Submenu markers (#216): a dot just outside the wedges for each
          active-ring sector that opens a submenu, mirroring the live overlay.
          Only on the wedge layout (a shape plugin owns its own affordances and
          positions nodes off the sector angle). Decorative. */}
        {effectiveShape === null &&
          currentRing.map((node, i) => {
            if (node.branches === undefined || node.branches.length === 0) return null;
            const c = sectorCenterAngle(i, count) + activeRotation;
            return (
              <circle
                key={`submenu-marker-${nodeKey(node)}`}
                className="pie-submenu-marker"
                cx={Math.sin(c) * rings.markerOrbit}
                cy={-Math.cos(c) * rings.markerOrbit}
                r={MARKER_DOT}
              />
            );
          })}

        {/* Preview ring: the hovered branch's children, dimmed and
          non-interactive, in the outer band — overlay parity so the author
          sees what's inside before drilling. Suppressed when a shape
          plugin is the effective layout so the orbital preview stays
          clean (matches the live overlay's behaviour). */}
        {effectiveShape === null &&
          previewSectors &&
          previewSectors.length > 0 &&
          previewSectors.map((node, i) => {
            const c = sectorCenterAngle(i, previewSectors.length) + previewRotation;
            const h = Math.PI / previewSectors.length;
            const d = describeWedgePath(OUTER_OUTER_RADIUS, OUTER_INNER_RADIUS, c - h, c + h);
            const lx = Math.sin(c) * OUTER_LABEL_RADIUS;
            const ly = -Math.cos(c) * OUTER_LABEL_RADIUS;
            const labelText = truncatePieLabel(node.label);
            return (
              <g
                key={`preview-${nodeKey(node)}`}
                className={styles.previewGroup}
                aria-hidden="true"
              >
                <path d={d} className={styles.wedgePreview} />
                {sectorIcon(node, lx, ly, previewIconSize)}
                <text
                  x={lx}
                  y={isRenderableIcon(node.icon) ? ly + previewIconSize * 0.5 : ly}
                  className={styles.labelPreview}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: `calc(${segmentLabelFontPx(OUTER_LABEL_RADIUS, previewSectors.length, [...labelText].length)}px * var(--pie-label-scale, 1))`,
                  }}
                >
                  {labelText}
                </text>
              </g>
            );
          })}

        {/* Preview ring as plugin nodes: parallel to the wedge map
          above, runs when a shape plugin is the effective layout, at
          top level, and a branch is hovered (so previewSectors is
          non-empty). Same non-interactive aria-hidden treatment as
          the wedge preview. */}
        {effectiveShape !== null && previewSectors && previewSectors.length > 0 && (
          <g aria-hidden="true" className={styles.previewGroup}>
            <ShapePie
              shapeKey={effectiveShape}
              sectors={previewSectors}
              ringRadii={shapeRingRadii}
              ring="outer"
              selectedIndex={null}
              iconSize={previewIconSize}
              labelRadius={OUTER_LABEL_RADIUS}
              fallback={null}
            />
          </g>
        )}

        {/* Centre target — mirrors the live pie (PieMenu.tsx): the
          configurable center field's label, falling back to the ✕ glyph
          when unset. Clickable here so its config opens in the Properties
          panel (the live pie's centre is non-interactive). */}
        <g
          className={styles.centerGroup}
          role="button"
          tabIndex={0}
          aria-label="Edit center field"
          aria-pressed={centerSelected}
          onClick={selectCenter}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectCenter();
            }
          }}
        >
          <circle
            className={`${styles.cancelCenter} ${centerActive ? styles.cancelCenterSelected : ''} ${
              isCancelNode(config.root) ? styles.cancelCenterCancel : ''
            }`}
            cx={0}
            cy={0}
            r={INNER_RADIUS}
          />
          <text
            className={styles.cancelLabel}
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {config.root.label || '✕'}
          </text>
        </g>

        {/* Active-plugin badge (#186): the plugin's app icon in the bottom-left
          corner outside the outer ring band. Sized off the pie geometry, so it
          scales with the pie size (not the item icon-scale). Decorative. */}
        {pluginBadge !== null && (
          <image
            className={styles.pluginBadge}
            href={pluginBadge}
            x={-FOOTPRINT * 0.95}
            y={FOOTPRINT * 0.95 - FOOTPRINT * PLUGIN_BADGE_RATIO}
            width={FOOTPRINT * PLUGIN_BADGE_RATIO}
            height={FOOTPRINT * PLUGIN_BADGE_RATIO}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          />
        )}
        {/* Active-workbench badge (#229): mirrored into the bottom-right corner. */}
        {workbenchBadge !== null && (
          <image
            className={styles.pluginBadge}
            href={workbenchBadge}
            x={FOOTPRINT * 0.95 - FOOTPRINT * PLUGIN_BADGE_RATIO}
            y={FOOTPRINT * 0.95 - FOOTPRINT * PLUGIN_BADGE_RATIO}
            width={FOOTPRINT * PLUGIN_BADGE_RATIO}
            height={FOOTPRINT * PLUGIN_BADGE_RATIO}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          />
        )}
      </svg>
      <div
        className="pie-depth-dots"
        style={{ ['--depth-dot-size']: `${displaySize * 0.02}px` } as CSSProperties}
        aria-hidden="true"
      >
        {Array.from({ length: dotCount }, (_, i) => {
          const cancel = i === 0 && isCancelNode(config.root);
          return (
            <span
              key={i}
              className={`pie-depth-dot${i === activeDot ? ' is-active' : ''}${cancel ? ' is-cancel' : ''}`}
            />
          );
        })}
      </div>
    </div>
  );
}
