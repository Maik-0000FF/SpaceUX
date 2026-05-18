// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo } from 'react';

import {
  DEFAULT_PIE_GEOMETRY,
  axesToSector,
  sectorCenterAngle,
  type PieGeometryConfig,
} from '@/core/pie-geometry';

const TAU = Math.PI * 2;

export type PieMenuProps = {
  axes: { tx: number; ty: number };
  /** Override the default geometry (sector count, deadzone, invert). */
  geometry?: Partial<PieGeometryConfig>;
  /** Outer radius in CSS pixels. */
  radius?: number;
};

/**
 * Radial menu component.
 *
 * Pure presentational: takes the current axes and renders the wheel
 * with the appropriate sector highlighted. Selection logic lives in
 * the core/pie-geometry module so the same maths can be unit-tested
 * without a DOM.
 *
 * The initial scaffold renders one sector per slot with a placeholder
 * label. Plugin-bound actions land in here once the editor / config
 * pipeline is in place.
 */
export function PieMenu({ axes, geometry, radius = 240 }: PieMenuProps) {
  const config = useMemo<PieGeometryConfig>(
    () => ({ ...DEFAULT_PIE_GEOMETRY, ...geometry }),
    [geometry],
  );

  const activeSector = axesToSector(axes, config);
  const sectors = Math.max(2, Math.floor(config.sectorCount));
  const size = radius * 2;

  return (
    <div className="pie-menu" style={{ width: size, height: size }}>
      <svg viewBox={`-${radius} -${radius} ${size} ${size}`} width={size} height={size}>
        {Array.from({ length: sectors }, (_, i) => (
          <SectorWedge
            key={i}
            index={i}
            sectorCount={sectors}
            radius={radius}
            active={activeSector === i}
          />
        ))}
        {Array.from({ length: sectors }, (_, i) => (
          <SectorLabel key={i} index={i} sectorCount={sectors} radius={radius * 0.62} />
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

function SectorLabel({ index, sectorCount, radius }: { index: number; sectorCount: number; radius: number }) {
  const angle = sectorCenterAngle(index, sectorCount);
  // The geometry convention places angle 0 at "12 o'clock"; SVG uses
  // the standard mathematical orientation with 0 along +X. Convert.
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  return (
    <text className="pie-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
      {index + 1}
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
