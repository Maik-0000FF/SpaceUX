// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, useRef, useState, type CSSProperties } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { PLUGIN_MENU_ID_PREFIX, parseWorkbenchMenuId } from '@/shared/plugin-types';
import { menuTreeDepth, navigationRingRotation } from '@/core/menu-nav';
import {
  CANCEL_RADIUS_RATIO,
  INNER_LABEL_RATIO,
  OUTER_RING_INNER_RATIO,
  OUTER_RING_OUTER_RATIO,
  PLUGIN_BADGE_RATIO,
  sectorCenterAngle,
  segmentIconFitPx,
  segmentLabelFontPx,
  truncatePieLabel,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import { isCancelNode, type MenuNode } from '@/shared/menu';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useLivePreviewNavigation } from '../hooks/useLivePreviewNavigation';
import { usePieAppearance } from '../hooks/usePieAppearance';
import { useAppState } from '../state/app-state';
import { useCatalog } from '../state/catalog';
import { useMenuSettings } from '../state/menu-settings';
import { nodeKey } from '../state/node-keys';
import { ringBranches } from '../state/selectors';

import styles from './MenuPreview.module.scss';

const TAU = Math.PI * 2;

// Live pie's radius (PieMenu default) so fonts/strokes render at their true
// proportions; the viewBox scales the whole thing down to the panel — a
// faithful, just-smaller pie. Ratios are shared with the live PieMenu.
const RADIUS = 240;
const INNER_RADIUS = RADIUS * CANCEL_RADIUS_RATIO;
const OUTER_INNER_RADIUS = RADIUS * OUTER_RING_INNER_RATIO;
const OUTER_OUTER_RADIUS = RADIUS * OUTER_RING_OUTER_RATIO;
const INNER_LABEL_RADIUS = RADIUS * INNER_LABEL_RATIO;
const OUTER_LABEL_RADIUS = (OUTER_INNER_RADIUS + OUTER_OUTER_RADIUS) / 2;
const VIEW = OUTER_OUTER_RADIUS; // viewBox half-extent (reserves the outer ring)

/** A node's icon as an `<image>`, or null when the node has no renderable
 *  icon. Stacked above the label point (cx, cy); with an empty label it
 *  centres on the point instead. `iconSize` is the appearance-scaled size, so
 *  the preview tracks the live pie's icon size faithfully. */
function sectorIcon(node: MenuNode, cx: number, cy: number, iconSize: number) {
  if (!isRenderableIcon(node.icon)) return null;
  const top = node.label.trim().length > 0 ? cy - iconSize : cy - iconSize / 2;
  return (
    <image
      className={styles.icon}
      href={node.icon}
      x={cx - iconSize / 2}
      y={top}
      width={iconSize}
      height={iconSize}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

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
  const displaySize = (VIEW * 2 * (config.scale ?? 1)) / (window.devicePixelRatio || 1);

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
  const activeOuter = isDrilled ? OUTER_OUTER_RADIUS : RADIUS;
  const activeInner = isDrilled ? OUTER_INNER_RADIUS : INNER_RADIUS;
  const activeLabel = isDrilled ? OUTER_LABEL_RADIUS : INNER_LABEL_RADIUS;
  // Per-segment icon fit × the appearance icon-scale (100% = fills the wedge),
  // one size per ring since the inner pie and outer ring have different room.
  const activeIconSize =
    segmentIconFitPx(activeLabel, count, activeInner, activeOuter) * appearance.iconScale;
  const breadcrumbIconSize = isDrilled
    ? segmentIconFitPx(INNER_LABEL_RADIUS, parentRing.length, INNER_RADIUS, RADIUS) *
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
        {/* Breadcrumb ring (the parent menu) — only when drilled in. Dimmed
          and clickable to navigate back up; the drilled-into node is
          marked brighter. */}
        {isDrilled &&
          parentRing.map((node, i) => {
            const c = sectorCenterAngle(i, parentRing.length) + breadcrumbRotation;
            const h = Math.PI / parentRing.length;
            const d = describeWedgePath(RADIUS, INNER_RADIUS, c - h, c + h);
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

        {/* Active ring (the current menu): select / drag-reorder / drill. */}
        {currentRing.map((node, i) => {
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
        })}

        {/* Preview ring: the hovered branch's children, dimmed and
          non-interactive, in the outer band — overlay parity so the author
          sees what's inside before drilling. */}
        {previewSectors &&
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
            x={-VIEW * 0.95}
            y={VIEW * 0.95 - VIEW * PLUGIN_BADGE_RATIO}
            width={VIEW * PLUGIN_BADGE_RATIO}
            height={VIEW * PLUGIN_BADGE_RATIO}
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
