// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Owner of the pie menu's puck-driven navigation state.
 *
 * Wraps the reducer + the per-frame puck-handling effect into a
 * single hook so App.tsx only sees the IPC layer. Encapsulates:
 *
 *  - `drillReducer` state (`navigation`, `stickyChildIndex`)
 *  - A ref mirror so the commit listener can read the latest state
 *    without re-subscribing on every frame
 *  - Edge-trigger refs for the three gestures that need
 *    rising-only semantics — TZ-cancel/pop, lateral magnitude
 *    drill, tilt drill — so a sustained deflection fires once per
 *    gesture rather than cascading through nested levels
 *
 * App.tsx calls `useDrillNavigation` once and gets back the React
 * state plus a `resetTransientRefs` helper to invoke on MENU_OPEN
 * (so a stale "puck already past threshold" carryover from the
 * previous session can't fire on the first frame of the new one).
 */

import { useEffect, useReducer, useRef, type Dispatch, type RefObject } from 'react';

import {
  INITIAL_DRILL_STATE,
  currentSectors,
  drillReducer,
  navigationRingRotation,
  type DrillAction,
  type DrillState,
} from '@/core/menu-nav';
import {
  axesMagnitude,
  axesToSector,
  DEFAULT_PIE_GEOMETRY,
  rotateAxes,
  shouldCancelOnZ,
} from '@/core/pie-geometry';
import { resolveAxisInvert, type MenuAutoDrill, type MenuConfig } from '@/shared/menu';

/** Per-frame edge detector for the auto-drill gestures (lateral
 *  magnitude, tilt). Returns `true` once when `value` crosses
 *  `threshold` from below, then stays `false` until it dips back
 *  under. Mutates `prevRef` so each call hands the next frame the
 *  "was over" memory it needs.
 *
 *  Threshold comparison is `>=` (matches the per-frame check the
 *  original inline lateral-magnitude code used). Not reused for the
 *  TZ-cancel path because `shouldCancelOnZ` is strict-greater and
 *  changing the boundary there would be a separately-considered
 *  semantic tweak — kept inline below to preserve behaviour. */
function detectRisingEdge(
  enabled: boolean,
  value: number,
  threshold: number,
  prevRef: RefObject<boolean>,
): boolean {
  const over = enabled && value >= threshold;
  const rising = over && !prevRef.current;
  prevRef.current = over;
  return rising;
}

/** True when the field is present AND its `enabled` flag is `true`.
 *  Saves the call site from threading the optionality check by
 *  hand. */
function autoDrillEnabled(config: MenuAutoDrill | undefined): boolean {
  return config?.enabled === true;
}

export type UseDrillNavigation = {
  drillState: DrillState;
  dispatch: Dispatch<DrillAction>;
  /** Live reference to the latest state — for callers (the commit
   *  listener) that read inside a long-lived closure and can't
   *  re-subscribe per frame. */
  drillStateRef: RefObject<DrillState>;
  /** Clear the edge-trigger refs. Call on MENU_OPEN so a held
   *  puck from the previous session doesn't immediately fire a
   *  cancel / drill on the first frame of the new one. */
  resetTransientRefs: () => void;
};

export function useDrillNavigation(opts: {
  axes: { tx: number; ty: number; tz: number; rx: number; ry: number };
  menuConfig: MenuConfig | null;
  /** Whether the menu is currently visible. The hook short-circuits
   *  when closed so the puck doesn't dispatch into nothing. */
  menuOpen: boolean;
}): UseDrillNavigation {
  const { axes, menuConfig, menuOpen } = opts;

  const [drillState, dispatch] = useReducer(drillReducer, INITIAL_DRILL_STATE);

  const drillStateRef = useRef<DrillState>(drillState);
  drillStateRef.current = drillState;

  // Three rising-edge memories, one per gesture. All start `false`
  // so the first frame of a fresh menu can't claim "rising edge"
  // for a still-held puck — `resetTransientRefs` restores this on
  // MENU_OPEN.
  const wasCancelingRef = useRef<boolean>(false);
  const wasMagnitudeOverRef = useRef<boolean>(false);
  const wasTiltOverRef = useRef<boolean>(false);

  useEffect(() => {
    if (!menuOpen || !menuConfig) return;

    // TZ first: cancel/pop short-circuits before the lateral
    // gestures, so a deliberate "back" deflection isn't mistaken
    // for "drill harder". Inlined (rather than going through
    // `detectRisingEdge`) so both the gate and the rising-edge use
    // the same strict-greater comparison from `shouldCancelOnZ`.
    const canceling = shouldCancelOnZ(axes.tz, DEFAULT_PIE_GEOMETRY.deadzone);
    const tzRising = canceling && !wasCancelingRef.current;
    wasCancelingRef.current = canceling;
    if (canceling) {
      if (tzRising) {
        if (drillStateRef.current.navigation.length > 0) {
          dispatch({ type: 'pop' });
        } else {
          dispatch({ type: 'hover', index: null });
        }
      }
      return;
    }

    const navigation = drillStateRef.current.navigation;
    const current = currentSectors(menuConfig, navigation);
    const invert = resolveAxisInvert(menuConfig);

    // Rotate the lateral axes so the puck-to-sector mapping respects
    // the visual rotation of the drilled-in outer ring. Top-level
    // returns 0 from the shared rotation helper, leaving the axes
    // unchanged for the inner-pie case.
    const ringRotation = navigationRingRotation(menuConfig, navigation);
    const rotated = rotateAxes({ tx: axes.tx, ty: axes.ty }, -ringRotation);

    const rawSec = axesToSector(rotated, {
      ...DEFAULT_PIE_GEOMETRY,
      sectorCount: current.length,
      invertX: invert.x,
      invertY: invert.y,
    });
    // axesToSector clamps internal sectorCount to a minimum of 2,
    // so a 1-child ring can return index 1 — nowhere to render.
    // Clamp out so sticky always lands on an existing sector.
    const sec = rawSec === null ? null : rawSec % current.length;

    // Two auto-drill gestures, same rising-edge semantics: lateral
    // magnitude (TX/TY push) and tilt magnitude (RX/RY rotation).
    // Whichever rises first fires the drill; both run unconditionally
    // each frame so a user with both enabled can use either.
    const lateralRising = detectRisingEdge(
      autoDrillEnabled(menuConfig.magnitudeDrill),
      axesMagnitude({ tx: axes.tx, ty: axes.ty }),
      menuConfig.magnitudeDrill?.threshold ?? Infinity,
      wasMagnitudeOverRef,
    );
    const tiltRising = detectRisingEdge(
      autoDrillEnabled(menuConfig.tiltDrill),
      Math.hypot(axes.rx, axes.ry),
      menuConfig.tiltDrill?.threshold ?? Infinity,
      wasTiltOverRef,
    );

    if ((lateralRising || tiltRising) && sec !== null) {
      const hovered = current[sec];
      if (hovered?.children) {
        // child[0] aligns with the parent sector's angle thanks to
        // the outer-ring rotation, so landing sticky on 0 matches
        // the user's puck direction.
        dispatch({ type: 'drill', index: sec, nextSticky: 0 });
        return;
      }
    }

    if (sec !== null) dispatch({ type: 'hover', index: sec });
    // `drillState.navigation` is read via `drillStateRef`, not the
    // dep array. axes ticks frequently enough that the next frame
    // picks up any post-drill navigation; adding drillState here
    // would re-run on every reducer dispatch and defeat the
    // identity short-circuits inside it.
  }, [axes, menuConfig, menuOpen]);

  return {
    drillState,
    dispatch,
    drillStateRef,
    resetTransientRefs: () => {
      wasCancelingRef.current = false;
      wasMagnitudeOverRef.current = false;
      wasTiltOverRef.current = false;
    },
  };
}
