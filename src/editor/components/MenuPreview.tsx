// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState } from 'react';

import { sectorCenterAngle } from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import type { MenuConfig, MenuSector } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorKey } from '../state/sector-keys';

import styles from './MenuPreview.module.scss';

const TAU = Math.PI * 2;

// Stacked-ring preview geometry, in viewBox units. The pie is drawn as
// concentric rings along the selected path: the top level innermost, each
// deeper level a larger ring around it. The band width is *constant* and
// rendered at a fixed px scale, so the inner (parent) rings keep their size
// as deeper levels appear — the pie grows outward and the panel scrolls,
// rather than every ring shrinking or the pie clipping at a fixed frame.
const CENTER_HOLE = 16;
const BAND = 26;
const RING_GAP = 3;
const LABEL_FONT = 10;
const MARGIN = 6;
const SCALE = 3; // px per viewBox unit (fixed → inner ring keeps its size)

type PreviewRing = {
  sectors: readonly MenuSector[];
  /** Index path to this ring (the moveSector ring path); `[]` for root. */
  basePath: number[];
  /** Sector on the selected path within this ring, or null. */
  selectedIndex: number | null;
  /** Cumulative rotation so each ring's children fan out from their
   *  parent sector, matching the live pie's preview-ring rotation. */
  rotation: number;
};

/** Walk from the root following `path`, collecting one ring per level
 *  plus, when the deepest selected sector is a branch, its children as the
 *  outermost ring. */
function buildRings(config: MenuConfig, path: readonly number[]): PreviewRing[] {
  const rings: PreviewRing[] = [];
  let sectors: readonly MenuSector[] = config.sectors;
  let rotation = 0;
  for (let depth = 0; ; depth++) {
    const selectedIndex = depth < path.length ? path[depth]! : null;
    rings.push({ sectors, basePath: path.slice(0, depth), selectedIndex, rotation });
    if (selectedIndex === null) break;
    const sel = sectors[selectedIndex];
    if (!sel?.children || sel.children.length === 0) break;
    rotation += sectorCenterAngle(selectedIndex, sectors.length);
    sectors = sel.children;
  }
  return rings;
}

/**
 * Centre stage: the menu drawn as concentric rings along the selected
 * path — top level innermost, each deeper submenu a larger ring around it.
 * Clicking a wedge navigates to it (deeper rings rebuild); dragging a
 * wedge reorders within its own ring. The centre is the cancel target.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectPath = useAppState((s) => s.selectPath);

  const svgRef = useRef<SVGSVGElement>(null);
  // Dragged wedge (its ring path + index + ring depth) and the hovered
  // sibling slot within that same ring.
  const [drag, setDrag] = useState<{ basePath: number[]; index: number; depth: number } | null>(
    null,
  );
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (!config || config.sectors.length === 0) {
    return <p className={styles.empty}>{config ? 'No sectors to preview.' : ''}</p>;
  }

  const fullPath = selectedIndex !== null ? [...viewPath, selectedIndex] : [...viewPath];
  const rings = buildRings(config, fullPath);
  const band = BAND;
  // The pie grows outward with depth; the SVG is sized to its extent at a
  // fixed px scale so the inner ring stays the same size and the panel
  // scrolls instead of clipping.
  const view = CENTER_HOLE + rings.length * BAND + MARGIN;
  const px = 2 * view * SCALE;

  const ringRadii = (depth: number): { inner: number; outer: number; label: number } => {
    const inner = CENTER_HOLE + depth * band;
    const outer = inner + band;
    return { inner: inner + RING_GAP / 2, outer: outer - RING_GAP / 2, label: (inner + outer) / 2 };
  };

  // Pointer position → which ring (by radius) and sector (by angle, undoing
  // the ring's rotation), or null when outside the rings.
  const locate = (e: React.PointerEvent): { depth: number; index: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const r = Math.hypot(p.x, p.y);
    const depth = Math.floor((r - CENTER_HOLE) / band);
    if (depth < 0 || depth >= rings.length) return null;
    const ring = rings[depth]!;
    const count = ring.sectors.length;
    let theta = Math.atan2(p.x, -p.y) - ring.rotation;
    theta = ((theta % TAU) + TAU) % TAU;
    return { depth, index: Math.round(theta / (TAU / count)) % count };
  };

  const endDrag = (): void => {
    setDrag(null);
    setDropIndex(null);
  };

  return (
    <svg
      ref={svgRef}
      className={styles.pie}
      style={{ width: px, height: px }}
      viewBox={`-${view} -${view} ${2 * view} ${2 * view}`}
      role="group"
      aria-label="Menu preview"
      onPointerMove={(e) => {
        if (drag === null) return;
        const loc = locate(e);
        if (loc && loc.depth === drag.depth) setDropIndex(loc.index);
      }}
      onPointerUp={() => {
        if (drag === null) return;
        const { basePath, index } = drag;
        const to = dropIndex;
        endDrag();
        if (to !== null && to !== index) {
          moveSector(basePath, index, to);
          selectPath([...basePath, to]);
        } else {
          // No reorder → treat as a click: navigate to / select this wedge.
          selectPath([...basePath, index]);
        }
      }}
      onPointerCancel={endDrag}
    >
      {rings.map((ring, depth) => {
        const { inner, outer, label } = ringRadii(depth);
        const count = ring.sectors.length;
        const half = Math.PI / count;
        return ring.sectors.map((sector, i) => {
          const center = sectorCenterAngle(i, count) + ring.rotation;
          const d = describeWedgePath(outer, inner, center - half, center + half);
          const onPath = ring.selectedIndex === i;
          const dragging = drag !== null && drag.depth === depth && drag.index === i;
          const dropTarget =
            drag !== null && drag.depth === depth && dropIndex === i && dropIndex !== drag.index;
          const lx = Math.sin(center) * label;
          const ly = -Math.cos(center) * label;
          return (
            <g
              key={sectorKey(sector)}
              className={`${styles.wedgeGroup} ${dragging ? styles.dragging : ''}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                setDrag({ basePath: ring.basePath, index: i, depth });
                setDropIndex(i);
                svgRef.current?.setPointerCapture(e.pointerId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectPath([...ring.basePath, i]);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Select ${sector.label}`}
              aria-pressed={onPath}
            >
              <path
                d={d}
                className={`${styles.wedge} ${onPath ? styles.wedgeSelected : ''} ${
                  dropTarget ? styles.wedgeDropTarget : ''
                }`}
              />
              <text
                x={lx}
                y={ly}
                className={styles.label}
                style={{ fontSize: LABEL_FONT }}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {sector.label}
              </text>
            </g>
          );
        });
      })}

      {/* Centre cancel area — mirrors the live pie's release-to-dismiss
          target (and anchors the layout). Static for now. */}
      <circle className={styles.cancelCenter} cx={0} cy={0} r={CENTER_HOLE} />
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
