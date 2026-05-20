// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { sectorCenterAngle } from '@/core/pie-geometry';
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
 * that sector. Drilling into a submenu is done from the list/properties
 * (the "›" button / "Open submenu"); the breadcrumb navigates back.
 */
export function MenuPreview() {
  const config = useMenuSettings((s) => s.config);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectSector = useAppState((s) => s.selectSector);
  const sectors = config ? ringSectors(config, viewPath) : [];

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
        const selected = selectedIndex === i;
        // 12 o'clock = 0, clockwise positive: x = sin·r, y = -cos·r.
        const lx = Math.sin(center) * LABEL_RADIUS;
        const ly = -Math.cos(center) * LABEL_RADIUS;
        return (
          // tabIndex + onKeyDown keep the wedges keyboard-operable; the
          // focus ring itself is suppressed in CSS (.wedgeGroup).
          <g
            key={sectorKey(sector)}
            className={styles.wedgeGroup}
            onClick={() => selectSector(i)}
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
