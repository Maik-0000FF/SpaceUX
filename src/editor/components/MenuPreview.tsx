// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState } from 'react';

import { navigationRingRotation } from '@/core/menu-nav';
import {
  CANCEL_RADIUS_RATIO,
  INNER_LABEL_RATIO,
  OUTER_RING_INNER_RATIO,
  OUTER_RING_OUTER_RATIO,
  sectorCenterAngle,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

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
 * band as a dimmed breadcrumb, with the drilled-into sector marked). The
 * centre is the cancel target.
 *
 * Clicking a leaf in the active ring selects it; clicking a branch drills
 * into it (its submenu becomes the new active outer ring); dragging
 * reorders within the active ring. Clicking a breadcrumb sector navigates
 * back up to it.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectSector = useAppState((s) => s.selectSector);
  const selectPath = useAppState((s) => s.selectPath);
  const drillInto = useAppState((s) => s.drillInto);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);

  const currentRing = config ? ringSectors(config, viewPath) : [];
  if (!config || currentRing.length === 0) {
    return <p className={styles.empty}>{config ? 'No sectors to preview.' : ''}</p>;
  }

  const isDrilled = viewPath.length > 0;
  const parentRing = isDrilled ? ringSectors(config, viewPath.slice(0, -1)) : [];
  const drilledIntoIndex = isDrilled ? viewPath[viewPath.length - 1]! : -1;

  // Active ring = the current menu: inner band at top level, outer band when
  // drilled in. Rotated (when drilled) so its sector 0 lines up with the
  // parent sector — the live pie's preview-ring rotation.
  const count = currentRing.length;
  const half = Math.PI / count;
  const activeRotation = isDrilled ? navigationRingRotation(config, viewPath) : 0;
  const activeOuter = isDrilled ? OUTER_OUTER_RADIUS : RADIUS;
  const activeInner = isDrilled ? OUTER_INNER_RADIUS : INNER_RADIUS;
  const activeLabel = isDrilled ? OUTER_LABEL_RADIUS : INNER_LABEL_RADIUS;

  // Pointer angle → active-ring sector (undoing the ring's rotation; radius
  // irrelevant since reorder is angular).
  const sectorUnderPointer = (e: React.PointerEvent): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
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
    <svg
      ref={svgRef}
      className={styles.pie}
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
          moveSector(viewPath, from, to);
          selectSector(to);
        } else if (currentRing[from]?.children?.length) {
          drillInto(from); // click a branch → go in (it becomes the outer ring)
        } else {
          selectSector(from); // click a leaf → select for editing
        }
      }}
      onPointerCancel={endDrag}
    >
      {/* Breadcrumb ring (the parent menu) — only when drilled in. Dimmed
          and clickable to navigate back up; the drilled-into sector is
          marked brighter. */}
      {isDrilled &&
        parentRing.map((sector, i) => {
          const c = sectorCenterAngle(i, parentRing.length);
          const h = Math.PI / parentRing.length;
          const d = describeWedgePath(RADIUS, INNER_RADIUS, c - h, c + h);
          const lx = Math.sin(c) * INNER_LABEL_RADIUS;
          const ly = -Math.cos(c) * INNER_LABEL_RADIUS;
          return (
            <g
              key={`crumb-${sectorKey(sector)}`}
              className={styles.breadcrumbGroup}
              role="button"
              tabIndex={0}
              aria-label={`Back to ${sector.label}`}
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
                {sector.label}
              </text>
            </g>
          );
        })}

      {/* Active ring (the current menu): select / drag-reorder / drill. */}
      {currentRing.map((sector, i) => {
        const c = sectorCenterAngle(i, count) + activeRotation;
        const d = describeWedgePath(activeOuter, activeInner, c - half, c + half);
        const selected = selectedIndex === i;
        const isDropTarget = dragFrom !== null && dropTo === i && dropTo !== dragFrom;
        const lx = Math.sin(c) * activeLabel;
        const ly = -Math.cos(c) * activeLabel;
        return (
          <g
            key={sectorKey(sector)}
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
                if (currentRing[i]?.children?.length) drillInto(i);
                else selectSector(i);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${sector.children?.length ? 'Open' : 'Select'} ${sector.label}`}
            aria-pressed={selected}
          >
            <path
              d={d}
              className={`${styles.wedge} ${selected ? styles.wedgeSelected : ''} ${
                isDropTarget ? styles.wedgeDropTarget : ''
              }`}
            />
            <text
              x={lx}
              y={ly}
              className={styles.label}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {sector.label}
            </text>
          </g>
        );
      })}

      {/* Centre cancel area — mirrors the live pie's release-to-dismiss
          target (and anchors the layout). Static for now. */}
      <circle className={styles.cancelCenter} cx={0} cy={0} r={INNER_RADIUS} />
      <text
        className={styles.cancelLabel}
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
      >
        ✕
      </text>
    </svg>
  );
}
