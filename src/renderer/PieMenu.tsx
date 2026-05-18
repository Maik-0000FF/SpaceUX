// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, type CSSProperties } from 'react';

import {
  DEFAULT_PIE_GEOMETRY,
  axesToSector,
  sectorCenterAngle,
  type PieGeometryConfig,
} from '@/core/pie-geometry';
import type { MenuConfig, MenuSector } from '@/shared/menu';

const TAU = Math.PI * 2;

export type PieMenuProps = {
  axes: { tx: number; ty: number };
  /** Anchor point in renderer-window coords. The pie centre sits at
   *  this point so the menu opens "at the cursor" wherever the user
   *  triggered it. Omit to fall back to viewport-centre. */
  position?: { x: number; y: number };
  /** Validated menu config from main. The sector count + per-sector
   *  labels are read from here; bindings are inspected at commit
   *  time by App.tsx (not by this component). */
  config: MenuConfig;
  /** Override the geometry knobs that aren't derived from the config
   *  (deadzone, invert). Sector count always comes from the config. */
  geometryOverrides?: Omit<Partial<PieGeometryConfig>, 'sectorCount'>;
  /** Outer radius in CSS pixels. */
  radius?: number;
};

/**
 * Radial menu component.
 *
 * Pure presentational: takes the current axes plus the menu config
 * and renders the wheel with the appropriate sector highlighted.
 * The sector count is derived from config.sectors.length — there is
 * no separate count knob. Selection maths live in
 * core/pie-geometry so the same code can be unit-tested without a
 * DOM; what *happens* on selection lives in App.tsx (it looks up
 * the binding and asks main to invoke the action).
 */
export function PieMenu({ axes, position, config, geometryOverrides, radius = 240 }: PieMenuProps) {
  const geometry = useMemo<PieGeometryConfig>(
    () => ({
      ...DEFAULT_PIE_GEOMETRY,
      ...geometryOverrides,
      sectorCount: config.sectors.length,
    }),
    [geometryOverrides, config.sectors.length],
  );

  const activeSector = axesToSector(axes, geometry);
  const sectorCount = geometry.sectorCount;
  const size = radius * 2;

  // Absolute positioning so the pie sits at the supplied window-
  // coords. Translating by -50% centres the SVG on (position.x,
  // position.y) regardless of size. Falls back to centre-of-viewport
  // when position is omitted (useful for screenshots and tests).
  const style: CSSProperties = position
    ? {
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: size,
        height: size,
        transform: 'translate(-50%, -50%)',
      }
    : { width: size, height: size };

  return (
    <div className="pie-menu" style={style}>
      <svg viewBox={`-${radius} -${radius} ${size} ${size}`} width={size} height={size}>
        {config.sectors.map((_, i) => (
          <SectorWedge
            key={i}
            index={i}
            sectorCount={sectorCount}
            radius={radius}
            active={activeSector === i}
          />
        ))}
        {config.sectors.map((sector, i) => (
          <SectorLabel
            key={i}
            index={i}
            sectorCount={sectorCount}
            radius={radius * 0.62}
            sector={sector}
          />
        ))}
      </svg>
    </div>
  );
}

function SectorWedge({
  index,
  sectorCount,
  radius,
  active,
}: {
  index: number;
  sectorCount: number;
  radius: number;
  active: boolean;
}) {
  const sectorWidth = TAU / sectorCount;
  // Half a sector either side of the centre so wedges meet edge-to-edge.
  const startAngle = sectorCenterAngle(index, sectorCount) - sectorWidth / 2;
  const endAngle = startAngle + sectorWidth;
  const d = describeWedgePath(radius, startAngle, endAngle);
  return <path className={`pie-wedge${active ? ' is-active' : ''}`} d={d} />;
}

function SectorLabel({
  index,
  sectorCount,
  radius,
  sector,
}: {
  index: number;
  sectorCount: number;
  radius: number;
  sector: MenuSector;
}) {
  const angle = sectorCenterAngle(index, sectorCount);
  // The geometry convention places angle 0 at "12 o'clock"; SVG uses
  // the standard mathematical orientation with 0 along +X. Convert.
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  return (
    <text className="pie-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
      {sector.label}
    </text>
  );
}

/**
 * Build the SVG path for one wedge from angle a to angle b (radians,
 * 12 o'clock = 0, clockwise positive). Uses the standard SVG arc
 * trick: move to centre, line out to the start point, arc along the
 * outer circumference, line back to centre, close. The largeArc flag
 * is set when the sweep exceeds π so half-pies render correctly.
 */
function describeWedgePath(r: number, a: number, b: number): string {
  const sweep = b - a;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const ax = Math.sin(a) * r;
  const ay = -Math.cos(a) * r;
  const bx = Math.sin(b) * r;
  const by = -Math.cos(b) * r;
  return `M 0 0 L ${ax.toFixed(3)} ${ay.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${bx.toFixed(3)} ${by.toFixed(3)} Z`;
}
