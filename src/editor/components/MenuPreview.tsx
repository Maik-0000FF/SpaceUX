// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { sectorCenterAngle } from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';

import styles from './MenuPreview.module.scss';

// Preview geometry, in viewBox units. Static for PR Editor-2 — no drag,
// no hover-drill. Reuses the renderer's wedge-path and sector-angle
// helpers so the preview matches the live pie's layout exactly.
const OUTER_RADIUS = 130;
const INNER_RADIUS = 52;
const LABEL_RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2;

/**
 * Centre stage: a static SVG rendering of the top-level pie. Clicking a
 * wedge selects that sector (mirroring MenuList). Selection is shown by
 * highlighting the wedge. Interactivity beyond click-select — drag to
 * reorder (PR Editor-4), drill into submenus (PR Editor-5) — is out of
 * scope here.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const selectedPath = useAppState((s) => s.selectedPath);
  const selectSector = useAppState((s) => s.selectSector);
  const sectors = config?.sectors ?? [];

  if (sectors.length === 0) {
    return <p className={styles.empty}>{config ? 'No sectors to preview.' : ''}</p>;
  }

  const count = sectors.length;
  const half = Math.PI / count;

  return (
    <svg className={styles.pie} viewBox="-150 -150 300 300" role="group" aria-label="Menu preview">
      {sectors.map((sector, i) => {
        const center = sectorCenterAngle(i, count);
        const d = describeWedgePath(OUTER_RADIUS, INNER_RADIUS, center - half, center + half);
        const selected = selectedPath.length === 1 && selectedPath[0] === i;
        // 12 o'clock = 0, clockwise positive (same convention as the
        // path helper): x = sin·r, y = -cos·r.
        const lx = Math.sin(center) * LABEL_RADIUS;
        const ly = -Math.cos(center) * LABEL_RADIUS;
        return (
          <g
            key={i}
            className={styles.wedgeGroup}
            onClick={() => selectSector([i])}
            role="button"
            aria-label={`Select ${sector.label}`}
            aria-pressed={selected}
          >
            <path d={d} className={`${styles.wedge} ${selected ? styles.wedgeSelected : ''}`} />
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
