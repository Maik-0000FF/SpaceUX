// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, type CSSProperties } from 'react';

import { currentSectors, navigationRingRotation } from '@/core/menu-nav';
import {
  DEFAULT_PIE_GEOMETRY,
  axesToSector,
  clampPieAnchor,
  sectorCenterAngle,
  type PieGeometryConfig,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import { resolveAxisInvert, type MenuConfig, type MenuSector } from '@/shared/menu';

const TAU = Math.PI * 2;

/** Fraction of the outer radius taken up by the central cancel area.
 *  Used as the inner cut-out of every sector wedge so the wedges
 *  butt directly against the cancel circle instead of sitting on top
 *  of it. Single source of truth — bump in one place. */
const CANCEL_RADIUS_RATIO = 0.18;

/** Inner edge of the outer preview ring, expressed as a multiple of
 *  the inner pie's outer radius. A small `>1` value leaves a visible
 *  gap between the two rings so the user sees them as distinct
 *  layers instead of one continuous band. */
const OUTER_RING_INNER_RATIO = 1.04;

/** Outer edge of the outer preview ring, also a multiple of the
 *  inner pie's outer radius. Sets the overall pie footprint: the
 *  SVG viewport always reserves this much space whether the outer
 *  ring is currently visible or not, so the menu's clamp position
 *  doesn't jump when the user moves onto/off a branch sector. */
const OUTER_RING_OUTER_RATIO = 1.5;

export type PieMenuProps = {
  axes: { tx: number; ty: number };
  /** Anchor point in renderer-window coords. The pie centre sits at
   *  this point so the menu opens "at the cursor" wherever the user
   *  triggered it. Omit to fall back to viewport-centre. */
  position?: { x: number; y: number };
  /** Validated menu config from main, full tree. The component
   *  derives both the active ring and (when drilled in) the parent
   *  ring from this + `navigation`; bindings are inspected at
   *  commit time by App.tsx, not here. */
  config: MenuConfig;
  /** Drill path through the config tree. Empty at top level.
   *  `[i]` means the user has drilled into `config.sectors[i]`,
   *  `[i, j]` into its grandchild, and so on. Determines which ring
   *  is the active selection target and which is the breadcrumb. */
  navigation?: readonly number[];
  /** Force a specific sector in the *active* ring to render as
   *  highlighted, overriding the live axes-to-sector calculation.
   *  `null` means "no override, use live axes" — used by App.tsx
   *  for sticky selection. */
  activeSector?: number | null;
  /** Override the geometry knobs that aren't derived from the config
   *  (deadzone, invert). Sector count always comes from the active
   *  ring. */
  geometryOverrides?: Omit<Partial<PieGeometryConfig>, 'sectorCount'>;
  /** Outer radius of the inner pie band in CSS pixels. The outer
   *  ring band extends past this by `OUTER_RING_OUTER_RATIO`. The
   *  SVG viewport always reserves space for both rings whether or
   *  not the outer ring is currently rendered, so `clampPieAnchor`
   *  stays deterministic. */
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
  navigation = [],
  activeSector: overrideSector = null,
  geometryOverrides,
  radius = 240,
}: PieMenuProps) {
  // Resolve ring roles from the navigation stack. At top level the
  // *inner* pie is the active selection target; once drilled in the
  // roles swap so the outer (larger) ring becomes active and the
  // inner pie demotes to a breadcrumb showing where the user came
  // from. The actual sector arrays are derived through the shared
  // `currentSectors` walker so App.tsx and PieMenu can't disagree
  // about which ring is which.
  const activeRing = useMemo(() => currentSectors(config, navigation), [config, navigation]);
  const isDrilled = navigation.length > 0;
  const parentRing = useMemo(
    () => (isDrilled ? currentSectors(config, navigation.slice(0, -1)) : null),
    [config, navigation, isDrilled],
  );
  const drilledIntoIndex = isDrilled ? navigation[navigation.length - 1]! : null;

  const geometry = useMemo<PieGeometryConfig>(() => {
    // Per-axis sign comes from the menu config so the user can flip
    // whichever feels wrong without touching code. The resolver lives
    // in @/shared/menu so App.tsx (live selection) and this component
    // (rendering) cannot drift apart on the fallback default.
    const invert = resolveAxisInvert(config);
    return {
      ...DEFAULT_PIE_GEOMETRY,
      ...geometryOverrides,
      sectorCount: activeRing.length,
      invertX: invert.x,
      invertY: invert.y,
    };
  }, [geometryOverrides, config, activeRing]);

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
  const innerRadius = radius * CANCEL_RADIUS_RATIO;

  // Preview ring (top-level only): when the user hovers a branch
  // sector in the active inner pie, fade in its children as a
  // dimmed, non-interactive outer ring so the user can see what's
  // there before they decide to drill in. At depth > 0 the outer
  // slot is taken by the active ring itself, so no preview is
  // possible without a third ring (deferred follow-up).
  const previewSectors =
    !isDrilled && activeSector !== null && activeSector !== undefined
      ? activeRing[activeSector]?.children
      : undefined;

  // Pick which sectors fill the inner/outer visual slots based on
  // drill state. Variables read top-to-bottom in JSX below.
  const innerSectors: readonly MenuSector[] = isDrilled ? parentRing! : activeRing;
  const outerSectors: readonly MenuSector[] | undefined = isDrilled ? activeRing : previewSectors;
  // SVG viewport sizing is based on the *outermost* possible ring
  // even when the preview ring is currently invisible — that keeps
  // `clampPieAnchor` deterministic and prevents the menu from
  // jumping inward by ~120 px the moment the user happens to hover
  // a branch sector.
  const outerRingOuterRadius = radius * OUTER_RING_OUTER_RATIO;
  const outerRingInnerRadius = radius * OUTER_RING_INNER_RATIO;
  const viewportSize = outerRingOuterRadius * 2;

  // Absolute positioning so the pie sits at the supplied window-
  // coords. Translating by -50% centres the SVG on the anchor point
  // regardless of size. Falls back to centre-of-viewport when
  // position is omitted (useful for screenshots and tests).
  //
  // The cursor coords get clamped through clampPieAnchor so the
  // full pie (inner + room for the outer preview ring) stays inside
  // the visible viewport even when the user triggers the menu right
  // at a screen edge. Clamping against the outer-ring radius rather
  // than the inner one is what guarantees a freshly-fading-in
  // preview ring won't ever land off-screen.
  const anchor =
    position !== undefined
      ? clampPieAnchor(position, outerRingOuterRadius, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null;
  const style: CSSProperties = anchor
    ? {
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        width: viewportSize,
        height: viewportSize,
        transform: 'translate(-50%, -50%)',
      }
    : { width: viewportSize, height: viewportSize };

  // Center-cancel target. Active whenever no sector is selected
  // (puck in deadzone): a commit in that state is a silent dismiss,
  // so highlighting the centre tells the user "release now and the
  // pie goes away with no action". The radius is a visual cue, not
  // a hit-test — the underlying selection logic is in App.tsx.
  const cancelActive = activeSector === null;

  // Mid-radius of the outer ring band, used to position outer-ring
  // labels in the visual centre of each wedge. Pre-computed because
  // both the wedge map and the label map below need it.
  const outerLabelRadius = ((OUTER_RING_INNER_RATIO + OUTER_RING_OUTER_RATIO) / 2) * radius;
  const innerLabelRadius = radius * 0.62;

  // Rotational alignment for the outer ring: spin it so its first
  // sector centres on whichever parent sector spawned it. Without
  // this the outer ring's "12 o'clock" is unrelated to where the
  // user is pushing — e.g. drilling from 6 o'clock landed the
  // user's hover at the top of the new ring, visually disconnected
  // from the parent. With the offset the user's gesture flows
  // continuously from parent to child.
  //
  // Drilled case goes through `navigationRingRotation` (shared with
  // App.tsx's axes-rotation) so the renderer and the puck-mapper
  // can't disagree about where sector 0 is. Top-level preview is
  // a different shape (the "parent" is the currently-hovered branch
  // in the active ring, not a navigation entry) and stays inlined.
  let outerRingRotation = 0;
  if (isDrilled) {
    outerRingRotation = navigationRingRotation(config, navigation);
  } else if (activeSector !== null && activeSector !== undefined && previewSectors) {
    outerRingRotation = sectorCenterAngle(activeSector, activeRing.length);
  }

  return (
    <div className="pie-menu" style={style}>
      <svg
        viewBox={`-${outerRingOuterRadius} -${outerRingOuterRadius} ${viewportSize} ${viewportSize}`}
        width={viewportSize}
        height={viewportSize}
      >
        {/* Inner ring: active selection target at top level, dimmed
         *  breadcrumb once drilled in (with the drilled-into sector
         *  marked as "you came from here"). */}
        {innerSectors.map((_, i) => (
          <SectorWedge
            key={`inner-wedge-${i}`}
            index={i}
            sectorCount={innerSectors.length}
            outerRadius={radius}
            innerRadius={innerRadius}
            active={!isDrilled && activeSector === i}
            breadcrumb={isDrilled}
            drilledInto={isDrilled && drilledIntoIndex === i}
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
        {innerSectors.map((sector, i) => (
          <SectorLabel
            key={`inner-label-${i}`}
            index={i}
            sectorCount={innerSectors.length}
            radius={innerLabelRadius}
            sector={sector}
            breadcrumb={isDrilled}
          />
        ))}
        {/* Outer ring: active selection target once drilled in, or
         *  preview of the hovered branch's children at top level.
         *  Either way it's the *larger* concentric band — the only
         *  thing that changes is opacity + whether it's interactive. */}
        {outerSectors !== undefined && outerSectors.length > 0 && (
          <g className="pie-outer-ring">
            {outerSectors.map((_, i) => (
              <SectorWedge
                key={`outer-wedge-${i}`}
                index={i}
                sectorCount={outerSectors.length}
                outerRadius={outerRingOuterRadius}
                innerRadius={outerRingInnerRadius}
                active={isDrilled && activeSector === i}
                preview={!isDrilled}
                rotation={outerRingRotation}
              />
            ))}
            {outerSectors.map((sector, i) => (
              <SectorLabel
                key={`outer-label-${i}`}
                index={i}
                sectorCount={outerSectors.length}
                radius={outerLabelRadius}
                sector={sector}
                preview={!isDrilled}
                rotation={outerRingRotation}
              />
            ))}
          </g>
        )}
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
  preview = false,
  breadcrumb = false,
  drilledInto = false,
  rotation = 0,
}: {
  index: number;
  sectorCount: number;
  outerRadius: number;
  innerRadius: number;
  active: boolean;
  /** Dimmed outer-ring style for a top-level branch preview.
   *  Mutually exclusive with `breadcrumb`. */
  preview?: boolean;
  /** Dimmed inner-ring style when the user has drilled in. The
   *  inner pie is no longer interactive but stays visible so the
   *  user can see what they drilled from. */
  breadcrumb?: boolean;
  /** Slightly less dimmed style for the single breadcrumb sector
   *  the user drilled *into* — a "you came from here" marker.
   *  Only meaningful in combination with `breadcrumb`. */
  drilledInto?: boolean;
  /** Rotation offset (radians) applied to every wedge's centre
   *  angle. Used to spin the outer ring so its sector 0 lines up
   *  with the parent sector that spawned it. */
  rotation?: number;
}) {
  const sectorWidth = TAU / sectorCount;
  // Half a sector either side of the centre so wedges meet edge-to-edge.
  const startAngle = sectorCenterAngle(index, sectorCount) + rotation - sectorWidth / 2;
  const endAngle = startAngle + sectorWidth;
  const d = describeWedgePath(outerRadius, innerRadius, startAngle, endAngle);
  const className = [
    'pie-wedge',
    active && 'is-active',
    preview && 'is-preview',
    breadcrumb && 'is-breadcrumb',
    breadcrumb && drilledInto && 'is-drilled-into',
  ]
    .filter(Boolean)
    .join(' ');
  return <path className={className} d={d} />;
}

function SectorLabel({
  index,
  sectorCount,
  radius,
  sector,
  preview = false,
  breadcrumb = false,
  rotation = 0,
}: {
  index: number;
  sectorCount: number;
  radius: number;
  sector: MenuSector;
  /** Match the wedge it belongs to. */
  preview?: boolean;
  /** Match the wedge it belongs to. */
  breadcrumb?: boolean;
  /** Match the wedge it belongs to. */
  rotation?: number;
}) {
  const angle = sectorCenterAngle(index, sectorCount) + rotation;
  // The geometry convention places angle 0 at "12 o'clock"; SVG uses
  // the standard mathematical orientation with 0 along +X. Convert.
  const x = Math.sin(angle) * radius;
  const y = -Math.cos(angle) * radius;
  const className = ['pie-label', preview && 'is-preview', breadcrumb && 'is-breadcrumb']
    .filter(Boolean)
    .join(' ');
  return (
    <text className={className} x={x} y={y} textAnchor="middle" dominantBaseline="middle">
      {sector.label}
    </text>
  );
}
