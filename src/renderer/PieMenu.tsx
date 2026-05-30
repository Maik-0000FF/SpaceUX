// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo, type CSSProperties } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { currentBranches, menuTreeDepth, navigationRingRotation } from '@/core/menu-nav';
import {
  DEFAULT_PIE_GEOMETRY,
  OUTER_RING_OUTER_RATIO,
  PLUGIN_BADGE_RATIO,
  axesToSector,
  clampPieAnchor,
  ringRadii,
  sectorCenterAngle,
  segmentIconFitPx,
  segmentLabelFontPx,
  SUBMENU_MARKER_DOT_RATIO,
  truncatePieLabel,
  type PieGeometryConfig,
} from '@/core/pie-geometry';
import { describeWedgePath } from '@/core/pie-path';
import {
  isCancelNode,
  resolveAxisInvert,
  resolveNavigation,
  type MenuConfig,
  type MenuNode,
} from '@/shared/menu';
import { type ShapeLayout } from '@/shared/shape-plugin-api';

const TAU = Math.PI * 2;

export type PieMenuProps = {
  axes: { tx: number; ty: number };
  /** Shape-plugin layout for the inner ring slot (#107 PR4). Computed
   *  by `useDrillNavigation` from the resolved shape model so this
   *  component and the hit-test path always read the same layout, and
   *  validated against the plugin's contract (`validateShapeLayout`).
   *  When non-null, the inner ring renders as plugin nodes instead of
   *  the wedge inner band. Optional so callers (screenshots, tests)
   *  that never render shapes can omit it. */
  innerShapeLayout?: ShapeLayout | null;
  /** Shape-plugin layout for the outer ring slot (#107 PR4). Same
   *  semantics as `innerShapeLayout` but for the outer band. The two
   *  layouts together let the planets pie render both the active ring
   *  and the breadcrumb / preview as orbital nodes simultaneously. */
  outerShapeLayout?: ShapeLayout | null;
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
   *  `[i]` means the user has drilled into `config.root.branches[i]`,
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
  /** Icon size as a fraction of the per-segment fit (1 = fills the wedge).
   *  From the pie appearance; the icon is a JS-computed SVG dimension, so it
   *  can't ride a CSS var like the label scale. */
  iconScale?: number;
  /** Overall pie size multiplier from the pie appearance (was the per-menu
   *  `config.scale`, #186 follow-up). Scales the rendered px size; 1 = default. */
  scale?: number;
  /** Ring-balance sliders (#182), 0..1 (0.5 = historical). `ringBalance` shifts
   *  the inner-pie / outer-ring split, `centerBalance` the centre-hole / inner
   *  split; both repartition the fixed footprint. */
  ringBalance?: number;
  centerBalance?: number;
  /** Active-plugin badge (#186): the app icon (data URI) of the plugin whose
   *  pie is active, shown decoratively in the bottom-left corner, or null. */
  badge?: string | null;
  /** Active-workbench badge (#229): the active FreeCAD workbench's icon (data
   *  URI), shown decoratively in the bottom-right corner, or null. */
  workbenchBadge?: string | null;
};

/**
 * Radial menu component.
 *
 * Pure presentational: takes the current axes plus the menu config
 * and renders the wheel with the appropriate sector highlighted.
 * The sector count is derived from config.root.branches.length —
 * there is no separate count knob. Selection maths live in
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
  iconScale = 1,
  scale = 1,
  ringBalance = 0.5,
  centerBalance = 0.5,
  badge = null,
  workbenchBadge = null,
  innerShapeLayout = null,
  outerShapeLayout = null,
}: PieMenuProps) {
  // Resolve ring roles from the navigation stack. At top level the
  // *inner* pie is the active selection target; once drilled in the
  // roles swap so the outer (larger) ring becomes active and the
  // inner pie demotes to a breadcrumb showing where the user came
  // from. The actual sector arrays are derived through the shared
  // `currentBranches` walker so App.tsx and PieMenu can't disagree
  // about which ring is which.
  const activeRing = useMemo(() => currentBranches(config, navigation), [config, navigation]);
  const isDrilled = navigation.length > 0;
  const parentRing = useMemo(
    () => (isDrilled ? currentBranches(config, navigation.slice(0, -1)) : null),
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
      // Hover highlight lights up at the hover (low) threshold; deadzone is
      // the open-submenu (high) threshold.
      deadzone: resolveNavigation(config).hoverDeadzone,
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
  // The footprint stays `radius * OUTER_RING_OUTER_RATIO` (size-slider driven,
  // balance-independent); the two balance sliders only repartition it among the
  // centre hole, inner pie, and outer ring (#182).
  const footprint = radius * OUTER_RING_OUTER_RATIO;
  const rings = ringRadii(footprint, ringBalance, centerBalance);
  const innerRadius = rings.cancel;
  const innerPieOuter = rings.innerOuter;

  // Preview ring (top-level only): when the user hovers a branch
  // sector in the active inner pie, fade in its children as a
  // dimmed, non-interactive outer ring so the user can see what's
  // there before they decide to drill in. At depth > 0 the outer
  // slot is taken by the active ring itself, so no preview is
  // possible without a third ring (deferred follow-up).
  const previewSectors =
    !isDrilled && activeSector !== null && activeSector !== undefined
      ? activeRing[activeSector]?.branches
      : undefined;

  // Pick which sectors fill the inner/outer visual slots based on
  // drill state. Variables read top-to-bottom in JSX below.
  const innerSectors: readonly MenuNode[] = isDrilled ? parentRing! : activeRing;
  const outerSectors: readonly MenuNode[] | undefined = isDrilled ? activeRing : previewSectors;
  // SVG viewport sizing is based on the *outermost* possible ring
  // even when the preview ring is currently invisible — that keeps
  // `clampPieAnchor` deterministic and prevents the menu from
  // jumping inward by ~120 px the moment the user happens to hover
  // a branch sector.
  const outerRingOuterRadius = rings.outerOuter;
  const outerRingInnerRadius = rings.outerInner;
  // Submenu-marker orbit + dot, and the SVG extent that reserves room for them
  // just outside the outer ring (#216). The viewport spans the marker extent
  // (not the outer ring) so the dots never clip; reserved unconditionally so
  // the size is deterministic whether or not any sector has a submenu.
  const markerOrbit = rings.markerOrbit;
  const markerDotRadius = footprint * SUBMENU_MARKER_DOT_RATIO;
  const svgExtent = markerOrbit + markerDotRadius;
  const viewportSize = svgExtent * 2;

  // Shape-plugin dispatch (#107 PR4). The caller (App.tsx via
  // `useDrillNavigation`) owns layout computation for both ring slots;
  // this component just renders what arrives. A non-null layout for a
  // slot means a shape plugin is the active layout for that band; null
  // falls back to the wedge default for that band. The two slots are
  // independent so the planets pie can show inner=active +
  // outer=preview-children simultaneously, just like the wedge default
  // does with breadcrumb + active.

  // User size multiplier. The `/ devicePixelRatio` is a compositor-specific
  // correction, NOT standard behaviour: under plain Chromium a fixed CSS
  // size already renders at a consistent physical size across DPRs. But on
  // this KDE Wayland setup with fractional scaling the overlay renders
  // *larger* at higher OS scaling, so we divide it back out to keep the
  // on-screen size steady (same fractional-scaling family as #71). Read at
  // render, not reactive — fine here since the overlay is recreated per
  // invocation. The viewBox stays `viewportSize`; only the rendered px size
  // and the clamp margin scale by this factor.
  const sizeFactor = scale / (window.devicePixelRatio || 1);
  const displaySize = viewportSize * sizeFactor;
  const clampRadius = svgExtent * sizeFactor;

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
      ? clampPieAnchor(position, clampRadius, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null;
  const style: CSSProperties = anchor
    ? {
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        width: displaySize,
        height: displaySize,
        transform: 'translate(-50%, -50%)',
      }
    : { width: displaySize, height: displaySize };

  // Center target. Active whenever no sector is selected (puck in
  // deadzone): committing in that state fires the center field's
  // binding, or silently dismisses when it has none. Highlighting the
  // centre tells the user "release now and the center wins". The
  // radius is a visual cue, not a hit-test — the selection logic is in
  // App.tsx. The label comes from `config.root.label`, falling back
  // to the historical ✕ glyph when it's empty/unset (icon parallels
  // sector icons and is ignored by the v0 renderer).
  const cancelActive = activeSector === null;
  // The centre itself is a cancel target when the root's action is the
  // built-in cancel → render it red persistently, like a cancel wedge.
  const rootCancel = isCancelNode(config.root);
  const centerLabel = config.root.label || '✕';

  // Depth dots: the first (leftmost) dot is the centre, then one dot per ring
  // level — so the row is 1 + the tree's deepest path. The active dot is the
  // centre when nothing is hovered at the top (you're "on" the centre), else
  // the current ring's dot (top ring = second dot). The centre dot turns red
  // when the centre is a cancel target.
  // Memoised: PieMenu re-renders every axes frame, but the tree shape only
  // changes when the config does.
  const dotCount = useMemo(() => 1 + menuTreeDepth(config), [config]);
  const atCentre = navigation.length === 0 && cancelActive;
  const activeDot = Math.min(atCentre ? 0 : navigation.length + 1, dotCount - 1);

  // Mid-radius of the outer ring band, used to position outer-ring
  // labels in the visual centre of each wedge. Pre-computed because
  // both the wedge map and the label map below need it.
  const outerLabelRadius = rings.outerLabel;
  const innerLabelRadius = rings.innerLabel;
  // Icon size is the per-segment fit (largest icon that fits a wedge without
  // crossing its edges) scaled by the appearance icon-scale — 100% fills the
  // segment, like the label scale. Computed per ring because the inner pie and
  // the thinner outer ring have different room, so their icons differ in size.
  const innerIconSize =
    segmentIconFitPx(innerLabelRadius, innerSectors.length, innerRadius, innerPieOuter) * iconScale;
  const outerIconSize =
    outerSectors !== undefined
      ? segmentIconFitPx(
          outerLabelRadius,
          outerSectors.length,
          outerRingInnerRadius,
          outerRingOuterRadius,
        ) * iconScale
      : 0;

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

  // When drilled in, the inner ring is the parent breadcrumb — rotate it by
  // the parent ring's own rotation so its sectors stay exactly where they sat
  // while it was the active ring. Without this the parent ring snaps back to
  // an unrotated layout the moment you drill a level deeper (the node you came
  // from jumps to 12 o'clock). Top level: the inner ring is the active pie, no
  // rotation.
  const innerRingRotation = isDrilled ? navigationRingRotation(config, navigation.slice(0, -1)) : 0;

  // Submenu markers (#216) track the *active* ring (inner at top level, outer
  // when drilled) and its rotation. Only drawn when that ring renders as
  // wedges: a shape plugin positions its nodes off `sectorCenterAngle`, so a
  // marker at the sector angle wouldn't line up with the node it marks (shape
  // plugins own their own affordances).
  const activeRingRotation = isDrilled ? outerRingRotation : 0;
  const activeRingIsWedge = isDrilled ? outerShapeLayout === null : innerShapeLayout === null;

  return (
    <div className="pie-menu" style={style}>
      <svg
        viewBox={`-${svgExtent} -${svgExtent} ${viewportSize} ${viewportSize}`}
        width={displaySize}
        height={displaySize}
      >
        {/* Inner ring. With the wedge default, this is the active
         *  selection target at top level and a dimmed breadcrumb once
         *  drilled (with the drilled-into sector marked "you came from
         *  here"). With a shape plugin's `innerShapeLayout`, the same
         *  band renders as orbital nodes: the active sectors at top
         *  level, the breadcrumb-of-parent-items when drilled. */}
        {innerShapeLayout !== null
          ? renderShapeRing({
              sectors: innerSectors,
              layout: innerShapeLayout,
              labelRadius: innerLabelRadius,
              iconSize: innerIconSize,
              // Active highlight only fires on the ring the puck is
              // currently navigating (the active ring). At top level
              // that's the inner ring; once drilled the inner is the
              // breadcrumb, so no live highlight.
              activeSector: !isDrilled ? activeSector : null,
              keyPrefix: 'inner-shape',
            })
          : innerSectors.map((node, i) => (
              <SectorWedge
                key={`inner-wedge-${i}`}
                index={i}
                sectorCount={innerSectors.length}
                outerRadius={innerPieOuter}
                innerRadius={innerRadius}
                active={!isDrilled && activeSector === i}
                cancel={isCancelNode(node)}
                breadcrumb={isDrilled}
                drilledInto={isDrilled && drilledIntoIndex === i}
                rotation={innerRingRotation}
              />
            ))}
        <circle
          className={`pie-cancel-center${cancelActive ? ' is-active' : ''}${rootCancel ? ' is-cancel' : ''}`}
          cx={0}
          cy={0}
          r={innerRadius}
        />
        <text
          className="pie-cancel-label"
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {centerLabel}
        </text>
        {/* Inner labels: skipped entirely when the inner ring is
            rendering as plugin nodes. renderShapeRing above already
            drew each label as part of the sector group, so a parallel
            wedge label map would double up. */}
        {innerShapeLayout !== null
          ? null
          : innerSectors.map((node, i) => (
              <SectorLabel
                key={`inner-label-${i}`}
                index={i}
                sectorCount={innerSectors.length}
                radius={innerLabelRadius}
                node={node}
                iconSize={innerIconSize}
                breadcrumb={isDrilled}
                rotation={innerRingRotation}
              />
            ))}
        {/* Outer ring. With the wedge default, this is the active
         *  selection target once drilled in, or a dimmed preview of
         *  the hovered branch's children at top level. With a shape
         *  plugin's `outerShapeLayout`, the same band renders as
         *  orbital nodes: the active sectors when drilled, the
         *  preview-of-children when hovering a branch at top level. */}
        {outerSectors !== undefined && outerSectors.length > 0 && (
          <g className="pie-outer-ring">
            {outerShapeLayout !== null ? (
              renderShapeRing({
                sectors: outerSectors,
                layout: outerShapeLayout,
                labelRadius: outerLabelRadius,
                iconSize: outerIconSize,
                // Active highlight only fires once drilled in (when
                // the outer ring is the active ring); at top level
                // the outer band is the preview, non-interactive.
                activeSector: isDrilled ? activeSector : null,
                keyPrefix: 'outer-shape',
              })
            ) : (
              <>
                {outerSectors.map((node, i) => (
                  <SectorWedge
                    key={`outer-wedge-${i}`}
                    index={i}
                    sectorCount={outerSectors.length}
                    outerRadius={outerRingOuterRadius}
                    innerRadius={outerRingInnerRadius}
                    active={isDrilled && activeSector === i}
                    cancel={isCancelNode(node)}
                    preview={!isDrilled}
                    rotation={outerRingRotation}
                  />
                ))}
                {outerSectors.map((node, i) => (
                  <SectorLabel
                    key={`outer-label-${i}`}
                    index={i}
                    sectorCount={outerSectors.length}
                    radius={outerLabelRadius}
                    node={node}
                    iconSize={outerIconSize}
                    preview={!isDrilled}
                    rotation={outerRingRotation}
                  />
                ))}
              </>
            )}
          </g>
        )}
        {/* Submenu markers (#216): a small dot on an orbit just outside the
          wedges for each active-ring sector that opens a submenu, so "drills
          deeper" vs "commits an action" is visible without navigating in.
          Decorative; only on the wedge layout (see activeRingIsWedge). */}
        {activeRingIsWedge && (
          <g className="pie-submenu-markers" aria-hidden="true">
            {activeRing.map((node, i) => {
              if (node.branches === undefined || node.branches.length === 0) return null;
              const angle = sectorCenterAngle(i, activeRing.length) + activeRingRotation;
              return (
                <circle
                  key={`submenu-marker-${i}`}
                  className="pie-submenu-marker"
                  cx={Math.sin(angle) * markerOrbit}
                  cy={-Math.cos(angle) * markerOrbit}
                  r={markerDotRadius}
                />
              );
            })}
          </g>
        )}
        {/* Active-plugin badge (#186): the app icon in the bottom-left corner
          outside the outer ring band. Sized off the pie geometry, so it scales
          with the pie size (not the item icon-scale). Decorative. */}
        {badge && (
          <image
            href={badge}
            x={-outerRingOuterRadius * 0.95}
            y={outerRingOuterRadius * 0.95 - outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            width={outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            height={outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: 'none' }}
            aria-hidden="true"
          />
        )}
        {/* Active-workbench badge (#229): the active workbench's icon, mirrored
          into the bottom-right corner. Same geometry-based size as the plugin
          badge. Decorative. */}
        {workbenchBadge && (
          <image
            href={workbenchBadge}
            x={outerRingOuterRadius * 0.95 - outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            y={outerRingOuterRadius * 0.95 - outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            width={outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            height={outerRingOuterRadius * PLUGIN_BADGE_RATIO}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: 'none' }}
            aria-hidden="true"
          />
        )}
      </svg>
      <div
        className="pie-depth-dots"
        // Dot size scales with the rendered pie so spacing stays proportional.
        style={{ ['--depth-dot-size']: `${displaySize * 0.02}px` } as CSSProperties}
        aria-hidden="true"
      >
        {Array.from({ length: dotCount }, (_, i) => {
          // Dot 0 is the centre — red when the centre is a cancel target.
          const cancel = i === 0 && rootCancel;
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

function SectorWedge({
  index,
  sectorCount,
  outerRadius,
  innerRadius,
  active,
  cancel = false,
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
  /** Bound to the built-in cancel action → render red (the abort target),
   *  matching the centre ✕. */
  cancel?: boolean;
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
    cancel && 'is-cancel',
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
  node,
  iconSize = 0,
  preview = false,
  breadcrumb = false,
  rotation = 0,
}: {
  index: number;
  sectorCount: number;
  radius: number;
  node: MenuNode;
  /** Edge length for the node's icon, in SVG units; 0 disables icons. */
  iconSize?: number;
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
  // With an icon, stack it above the label; without one, the label keeps
  // sitting on the radial point (no change for icon-less menus). When the
  // label is empty, centre the icon on the radial point instead of leaving a
  // gap where the label would be.
  const icon = iconSize > 0 && isRenderableIcon(node.icon) ? node.icon : null;
  const hasLabel = node.label.trim().length > 0;
  const iconTop = hasLabel ? y - iconSize : y - iconSize / 2;
  const labelY = icon !== null && hasLabel ? y + iconSize * 0.5 : y;
  // Truncate first, then size the font to the *displayed* length so a short
  // label fills its wedge.
  const text = truncatePieLabel(node.label);
  const fontPx = segmentLabelFontPx(radius, sectorCount, [...text].length);
  return (
    <>
      {icon !== null && (
        <image
          className="pie-icon"
          href={icon}
          x={x - iconSize / 2}
          y={iconTop}
          width={iconSize}
          height={iconSize}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      <text
        className={className}
        x={x}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="middle"
        // Auto-fit the label to the segment (shrinks as sectors grow), then
        // scale by the user's label-size fraction.
        style={{ fontSize: `calc(${fontPx}px * var(--pie-label-scale, 1))` }}
      >
        {text}
      </text>
    </>
  );
}

/**
 * Render one ring of sectors as a shape-plugin layout (#107 PR3c). Used
 * by the active ring (inner at top level, outer when drilled in) when
 * a `'shape'` plugin is the effective layout. The breadcrumb and
 * preview rings stay on the wedge code path.
 *
 * Each sector is one `<g>` group containing the plugin's `<circle>`
 * (the node body, positioned via `layout.nodes[i].cx,cy,r`), the node's
 * icon if any, and the label at `layout.labels[i].x,y`. Classes mirror
 * the wedge tokens (`pie-shape-node`, `is-active`, `is-cancel`) so the
 * theme colours apply automatically; a shape plugin gets the same
 * palette + opacity behaviour as the wedge default.
 */
function renderShapeRing(props: {
  sectors: readonly MenuNode[];
  layout: ShapeLayout;
  /** Pixel radius the labels would have used in the wedge map; passed
   *  to `segmentLabelFontPx` so the label's auto-fit matches the wedge
   *  default (a few pixels' difference in actual `<text>` position
   *  doesn't change the size). */
  labelRadius: number;
  iconSize: number;
  activeSector: number | null | undefined;
  keyPrefix: string;
}): React.ReactElement {
  const { sectors, layout, labelRadius, iconSize, activeSector, keyPrefix } = props;
  return (
    <>
      {sectors.map((node, i) => {
        const sn = layout.nodes[i]!;
        const sl = layout.labels[i]!;
        const active = activeSector === i;
        const cancel = isCancelNode(node);
        const hasIcon = iconSize > 0 && isRenderableIcon(node.icon);
        const labelText = truncatePieLabel(node.label);
        const className = ['pie-shape-node', active && 'is-active', cancel && 'is-cancel']
          .filter(Boolean)
          .join(' ');
        return (
          <g key={`${keyPrefix}-${i}`} className="pie-shape-group">
            <circle cx={sn.cx} cy={sn.cy} r={sn.r} className={className} />
            {hasIcon && (
              <image
                className="pie-icon"
                href={node.icon}
                x={sn.cx - iconSize / 2}
                y={node.label.trim().length > 0 ? sn.cy - iconSize : sn.cy - iconSize / 2}
                width={iconSize}
                height={iconSize}
                preserveAspectRatio="xMidYMid meet"
              />
            )}
            <text
              className="pie-label"
              x={sl.x}
              y={hasIcon ? sl.y + iconSize * 0.5 : sl.y}
              textAnchor={sl.anchor}
              dominantBaseline="middle"
              style={{
                fontSize: `calc(${segmentLabelFontPx(labelRadius, sectors.length, [...labelText].length)}px * var(--pie-label-scale, 1))`,
              }}
            >
              {labelText}
            </text>
          </g>
        );
      })}
    </>
  );
}
