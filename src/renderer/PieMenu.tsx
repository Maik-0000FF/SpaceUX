// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, type CSSProperties } from 'react';

import {
  DEFAULT_PIE_GEOMETRY,
  axesToSector,
  clampPieAnchor,
  sectorCenterAngle,
  type PieGeometryConfig,
} from '@/core/pie-geometry';
import { resolveAxisInvert, type MenuConfig, type MenuSector } from '@/shared/menu';

const TAU = Math.PI * 2;

/** Fraction of the outer radius taken up by the central cancel area.
 *  Used as the inner cut-out of every sector wedge so the wedges
 *  butt directly against the cancel circle instead of sitting on top
 *  of it. Single source of truth — bump in one place. */
const CANCEL_RADIUS_RATIO = 0.18;

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
  /** Force a specific sector to render as active, overriding the
   *  live axes-to-sector calculation. Used by App.tsx for sticky
   *  selection (the highlight persists when the puck returns to
   *  neutral so the user can confirm the choice without holding it).
   *  `null` means "no override, use live axes". */
  activeSector?: number | null;
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
export function PieMenu({
  axes,
  position,
  config,
  activeSector: overrideSector = null,
  geometryOverrides,
  radius = 240,
}: PieMenuProps) {
  const geometry = useMemo<PieGeometryConfig>(() => {
    // Per-axis sign comes from the menu config so the user can flip
    // whichever feels wrong without touching code. The resolver lives
    // in @/shared/menu so App.tsx (live selection) and this component
    // (rendering) cannot drift apart on the fallback default.
    const invert = resolveAxisInvert(config);
    return {
      ...DEFAULT_PIE_GEOMETRY,
      ...geometryOverrides,
      sectorCount: config.sectors.length,
      invertX: invert.x,
      invertY: invert.y,
    };
  }, [geometryOverrides, config]);

  // App owns the sticky-sector state so the highlight persists when
  // the user lets the puck snap back to neutral; we still compute
  // the live sector here for the rare callers that don't pass an
  // override (e.g. screenshots / future tests).
  //
  // The fall-through uses `=== undefined` rather than `??` on purpose:
  // `??` treats null the same as undefined and would fall back to
  // live axes when App.tsx explicitly passes `null` to signal cancel
  // mode (e.g. after a TZ deflection clears the sticky selection).
  // That would let the renderer light up a wedge while the commit
  // path silently dismisses — a UX/state divergence. With `=== undefined`,
  // a missing prop means "no override, use live axes" and an explicit
  // `null` means "no sector is active right now" (cancel target lights up).
  const computedSector = axesToSector(axes, geometry);
  const activeSector = overrideSector === undefined ? computedSector : overrideSector;
  const sectorCount = geometry.sectorCount;
  const innerRadius = radius * CANCEL_RADIUS_RATIO;
  const size = radius * 2;

  // Absolute positioning so the pie sits at the supplied window-
  // coords. Translating by -50% centres the SVG on the anchor point
  // regardless of size. Falls back to centre-of-viewport when
  // position is omitted (useful for screenshots and tests).
  //
  // The cursor coords get clamped through clampPieAnchor so the
  // full circle stays inside the visible viewport even when the
  // user triggers the menu right at a screen edge. Without the
  // clamp, opening with the cursor at (10, 10) with the default
  // 240-px radius would place the SVG's top-left at (-230, -230)
  // and the browser would clip the entire upper-left of the pie.
  const anchor =
    position !== undefined
      ? clampPieAnchor(position, radius, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null;
  const style: CSSProperties = anchor
    ? {
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        width: size,
        height: size,
        transform: 'translate(-50%, -50%)',
      }
    : { width: size, height: size };

  // Center-cancel target. Active whenever no sector is selected
  // (puck in deadzone): a commit in that state is a silent dismiss,
  // so highlighting the centre tells the user "release now and the
  // pie goes away with no action". The radius is a visual cue, not
  // a hit-test — the underlying selection logic is in App.tsx.
  const cancelActive = activeSector === null;

  return (
    <div className="pie-menu" style={style}>
      <svg viewBox={`-${radius} -${radius} ${size} ${size}`} width={size} height={size}>
        {config.sectors.map((_, i) => (
          <SectorWedge
            key={i}
            index={i}
            sectorCount={sectorCount}
            outerRadius={radius}
            innerRadius={innerRadius}
            active={activeSector === i}
          />
        ))}
        <circle
          className={`pie-cancel-center${cancelActive ? ' is-active' : ''}`}
          cx={0}
          cy={0}
          r={innerRadius}
        />
        <text
          className={`pie-cancel-label${cancelActive ? ' is-active' : ''}`}
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
        >
          ✕
        </text>
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
  outerRadius,
  innerRadius,
  active,
}: {
  index: number;
  sectorCount: number;
  outerRadius: number;
  innerRadius: number;
  active: boolean;
}) {
  const sectorWidth = TAU / sectorCount;
  // Half a sector either side of the centre so wedges meet edge-to-edge.
  const startAngle = sectorCenterAngle(index, sectorCount) - sectorWidth / 2;
  const endAngle = startAngle + sectorWidth;
  const d = describeWedgePath(outerRadius, innerRadius, startAngle, endAngle);
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
 * Build the SVG path for one annular (donut-slice) wedge from angle a
 * to angle b (radians, 12 o'clock = 0, clockwise positive). The path
 * traces the inner edge, lines out to the outer arc, sweeps the outer
 * arc, lines back to the inner edge, and sweeps the inner arc in
 * reverse — leaving a hole in the middle for the central cancel
 * target to nest into. The largeArc flag is set when the sweep
 * exceeds π so half-pies still render correctly.
 */
function describeWedgePath(rOuter: number, rInner: number, a: number, b: number): string {
  const sweep = b - a;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const sinA = Math.sin(a);
  const cosA = Math.cos(a);
  const sinB = Math.sin(b);
  const cosB = Math.cos(b);
  const oax = (sinA * rOuter).toFixed(3);
  const oay = (-cosA * rOuter).toFixed(3);
  const obx = (sinB * rOuter).toFixed(3);
  const oby = (-cosB * rOuter).toFixed(3);
  const iax = (sinA * rInner).toFixed(3);
  const iay = (-cosA * rInner).toFixed(3);
  const ibx = (sinB * rInner).toFixed(3);
  const iby = (-cosB * rInner).toFixed(3);
  return (
    `M ${iax} ${iay} ` +
    `L ${oax} ${oay} ` +
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${obx} ${oby} ` +
    `L ${ibx} ${iby} ` +
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iax} ${iay} ` +
    `Z`
  );
}
