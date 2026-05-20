// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState } from 'react';

import { sectorAtPoint, sectorCenterAngle } from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

import styles from './MenuPreview.module.scss';

// Preview geometry, in viewBox units. Static — reuses the renderer's
// wedge-path and sector-angle helpers so the preview matches the live
// pie's layout exactly.
const OUTER_RADIUS = 130;
const INNER_RADIUS = 52;
const LABEL_RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2;

/**
 * Centre stage: a static SVG rendering of the ring currently in view
 * (top level, or a submenu after drilling in). Clicking a wedge selects
 * it; dragging a wedge to another angular slot reorders the ring (via the
 * existing `moveSector`). Drilling into a submenu is done from the
 * list/properties; the breadcrumb navigates back.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectSector = useAppState((s) => s.selectSector);
  const sectors = config ? ringSectors(config, viewPath) : [];

  const svgRef = useRef<SVGSVGElement>(null);
  // Source sector while dragging, and the slot the pointer is currently
  // over. Both null when not dragging.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTo, setDropTo] = useState<number | null>(null);

  if (sectors.length === 0) {
    return <p className={styles.empty}>{config ? 'No sectors to preview.' : ''}</p>;
  }

  const count = sectors.length;
  const half = Math.PI / count;

  // Pointer position → target sector by angle (radius is irrelevant). Maps
  // client coords into the centred viewBox via the SVG's screen matrix.
  const sectorUnderPointer = (e: React.PointerEvent): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return sectorAtPoint(p.x, p.y, count);
  };

  const endDrag = (): void => {
    setDragFrom(null);
    setDropTo(null);
  };

  return (
    <svg
      ref={svgRef}
      className={styles.pie}
      viewBox="-150 -150 300 300"
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
        // An angular move reorders; no move (or same slot) is a plain
        // click → just select the wedge.
        if (to !== null && to !== from) {
          moveSector(viewPath, from, to);
          selectSector(to);
        } else {
          selectSector(from);
        }
      }}
      onPointerCancel={endDrag}
    >
      {sectors.map((sector, i) => {
        const center = sectorCenterAngle(i, count);
        const d = describeWedgePath(OUTER_RADIUS, INNER_RADIUS, center - half, center + half);
        const selected = selectedIndex === i;
        const isDropTarget = dragFrom !== null && dropTo === i && dropTo !== dragFrom;
        // 12 o'clock = 0, clockwise positive: x = sin·r, y = -cos·r.
        const lx = Math.sin(center) * LABEL_RADIUS;
        const ly = -Math.cos(center) * LABEL_RADIUS;
        return (
          // tabIndex + onKeyDown keep the wedges keyboard-operable (drag is
          // pointer-only by design); the focus ring is suppressed in CSS.
          <g
            key={sectorKey(sector)}
            className={`${styles.wedgeGroup} ${dragFrom === i ? styles.dragging : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setDragFrom(i);
              setDropTo(i);
              // Capture on the SVG so move/up keep flowing here even if the
              // pointer leaves the wedge mid-drag.
              svgRef.current?.setPointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectSector(i);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`Select ${sector.label}`}
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
    </svg>
  );
}
