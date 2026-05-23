// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { menuTreeDepth, navigationRingRotation } from '@/core/menu-nav';
import {
  CANCEL_RADIUS_RATIO,
  DEFAULT_PIE_GEOMETRY,
  INNER_LABEL_RATIO,
  OUTER_RING_INNER_RATIO,
  OUTER_RING_OUTER_RATIO,
  aimAxes,
  axesToSector,
  rotateAxes,
  sectorCenterAngle,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import {
  DEFAULT_TRIGGER_BUTTON,
  isCancelNode,
  resolveAxisInvert,
  resolveNavigation,
} from '@/shared/menu';

import { useEditorSpaceMouse } from '../hooks/useEditorSpaceMouse';
import { useAppState } from '../state/app-state';
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
  const liveAxes = useEditorSpaceMouse(livePreview);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);
  // Latest live-highlighted sector, read by the trigger-button handler
  // (which is subscribed once, so it can't close over a render value).
  const liveSectorRef = useRef<number | null>(null);

  // While live, the trigger button commits the highlighted sector — drill
  // into a branch, select a leaf — so the puck navigates the menu like the
  // real pie (going back up is the breadcrumb).
  useEffect(() => {
    if (!livePreview) return;
    return window.editor.onButton(({ bnum, pressed }) => {
      if (!pressed) return;
      const cfg = useMenuSettings.getState().config;
      if (!cfg) return;
      if (bnum !== (cfg.triggerButton ?? DEFAULT_TRIGGER_BUTTON)) return;
      const sector = liveSectorRef.current;
      if (sector === null) return;
      const ring = ringBranches(cfg, useAppState.getState().viewPath);
      if (ring.length === 0) return;
      // axesToSector clamps its internal sectorCount to a minimum of 2, so a
      // 1-child ring can yield index 1 → out of bounds. Wrap into range, the
      // same guard the live pie uses (useDrillNavigation: rawSec % length).
      const idx = sector % ring.length;
      if (ring[idx]?.branches?.length) drillInto(idx);
      else selectNode(idx);
    });
  }, [livePreview, drillInto, selectNode]);

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
  // centre is selected, else the current ring's dot. Centre dot is red when
  // the centre is a cancel target.
  const dotCount = 1 + menuTreeDepth(config);
  const activeDot = Math.min(centerSelected ? 0 : viewPath.length + 1, dotCount - 1);

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
  const activeOuter = isDrilled ? OUTER_OUTER_RADIUS : RADIUS;
  const activeInner = isDrilled ? OUTER_INNER_RADIUS : INNER_RADIUS;
  const activeLabel = isDrilled ? OUTER_LABEL_RADIUS : INNER_LABEL_RADIUS;

  // Live preview: the sector under the puck, mapped exactly like the live
  // pie. The aim source (#159) picks which axes steer the highlight — so a
  // tilt/both setting previews the same way the overlay aims. Axes are
  // un-rotated by the active ring's rotation first so the highlight lines
  // up with the rendered (rotated) outer ring. Null inside the deadzone —
  // so a centred puck highlights nothing, like the real pie.
  const invert = resolveAxisInvert(config);
  const nav = resolveNavigation(config);
  const aim = nav.aim;
  // null for the twist source (no lateral pointer) — the preview then
  // highlights nothing from deflection, matching the overlay.
  const aimVec =
    livePreview && liveAxes
      ? aimAxes(aim, {
          tx: liveAxes[0],
          ty: liveAxes[1],
          tz: liveAxes[2],
          rx: liveAxes[3],
          ry: liveAxes[4],
          rz: liveAxes[5],
        })
      : null;
  const liveSector = aimVec
    ? axesToSector(rotateAxes(aimVec, -activeRotation), {
        ...DEFAULT_PIE_GEOMETRY,
        sectorCount: count,
        // The preview highlights the *hovered* sector, so it lights up at the
        // hover threshold (low) — the deadzone field is the open-submenu (high).
        deadzone: nav.hoverDeadzone,
        invertX: invert.x,
        invertY: invert.y,
      })
    : null;
  liveSectorRef.current = liveSector;

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
            const c = sectorCenterAngle(i, parentRing.length);
            const h = Math.PI / parentRing.length;
            const d = describeWedgePath(RADIUS, INNER_RADIUS, c - h, c + h);
            const lx = Math.sin(c) * INNER_LABEL_RADIUS;
            const ly = -Math.cos(c) * INNER_LABEL_RADIUS;
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
                <text
                  x={lx}
                  y={ly}
                  className={styles.labelBreadcrumb}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {node.label}
                </text>
              </g>
            );
          })}

        {/* Active ring (the current menu): select / drag-reorder / drill. */}
        {currentRing.map((node, i) => {
          const c = sectorCenterAngle(i, count) + activeRotation;
          const d = describeWedgePath(activeOuter, activeInner, c - half, c + half);
          // While live, the highlight follows the puck (liveSector); otherwise
          // it's the click selection. The click selection still drives editing.
          const selected = livePreview ? liveSector === i : selectedIndex === i;
          const isDropTarget = dragFrom !== null && dropTo === i && dropTo !== dragFrom;
          const lx = Math.sin(c) * activeLabel;
          const ly = -Math.cos(c) * activeLabel;
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
              <text
                x={lx}
                y={ly}
                className={styles.label}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {node.label}
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
            className={`${styles.cancelCenter} ${centerSelected ? styles.cancelCenterSelected : ''} ${
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
