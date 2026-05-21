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
 *  - Edge-trigger refs for the four gestures that need rising-only
 *    semantics — center activation, TZ back/pop, lateral magnitude
 *    drill, tilt drill — so a sustained deflection fires once per
 *    gesture rather than cascading through nested levels
 *
 * The puck never fires actions itself: when a gesture commits the
 * center or dismisses the menu, the hook calls back into App.tsx
 * (`onCommitCenter` / `onDismiss`), which owns the IPC. The back/pop
 * gesture always dismisses at the top level and never fires a bound
 * center action — that stays reserved for the activation gesture and
 * the trigger-button commit, keeping "abort" and "center action" as
 * separate intents.
 *
 * App.tsx calls `useDrillNavigation` once and gets back the React
 * state plus a `resetTransientRefs` helper to invoke on MENU_OPEN.
 * Reset arms the rising-edge memories to `true` so a still-held
 * puck at open time doesn't fire any gesture on the first frame —
 * the user has to release past the threshold and re-engage before
 * a drill, pop, dismiss, or center activation can register.
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
  axisValue,
  DEFAULT_PIE_GEOMETRY,
  meetsActivation,
  resolveTzDeadzone,
  rotateAxes,
  shouldCancelOnZ,
  tzBackEngaged,
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
  /** Arm the edge-trigger refs to "already over" so a still-held
   *  puck at MENU_OPEN can't fire a cancel/drill on the first
   *  frame. The user has to release past each threshold and
   *  re-engage before the corresponding gesture registers. */
  resetTransientRefs: () => void;
};

export function useDrillNavigation(opts: {
  axes: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number };
  menuConfig: MenuConfig | null;
  /** Whether the menu is currently visible. The hook short-circuits
   *  when closed so the puck doesn't dispatch into nothing. */
  menuOpen: boolean;
  /** Close the menu with no action — the back/pop gesture's outcome at
   *  the top level, and the center field's outcome when it has no
   *  binding. The hook owns no IPC, so App.tsx supplies the actual
   *  hide/close. */
  onDismiss: () => void;
  /** Commit the center field: fire its binding, or dismiss when it has
   *  none. Invoked by the configured center activation gesture. Kept
   *  separate from `onDismiss` so the back gesture can never trigger a
   *  bound center action. */
  onCommitCenter: () => void;
}): UseDrillNavigation {
  const { axes, menuConfig, menuOpen, onDismiss, onCommitCenter } = opts;

  const [drillState, dispatch] = useReducer(drillReducer, INITIAL_DRILL_STATE);

  const drillStateRef = useRef<DrillState>(drillState);
  drillStateRef.current = drillState;

  // One rising-edge memory per gesture (center activation, TZ back,
  // lateral / tilt / twist drill). All start `true` so the first frame
  // after MENU_OPEN is never treated as a rising
  // edge: if the puck is already past the threshold at open time
  // (the user was mid-gesture when they triggered the menu), the
  // gesture has to physically dip back under the threshold and
  // re-engage before it fires. Without this, opening the menu with
  // a held puck would surprise the user with an immediate drill or
  // pop. `resetTransientRefs` re-asserts this on every MENU_OPEN
  // so a previous session's tail state can't carry over.
  const wasCancelingRef = useRef<boolean>(true);
  const wasActivatingRef = useRef<boolean>(true);
  const wasMagnitudeOverRef = useRef<boolean>(true);
  const wasTiltOverRef = useRef<boolean>(true);
  const wasTwistOverRef = useRef<boolean>(true);

  useEffect(() => {
    if (!menuOpen || !menuConfig) return;

    // Center activation first: a configured axis gesture commits the
    // center directly — firing its binding, or dismissing when it has
    // none. Rising-edge so a sustained deflection fires once, then has
    // to dip back under the threshold before re-firing. Checked ahead
    // of the back gesture: when both share the TZ axis, `tzBackEngaged`
    // already cedes the activation's half, but checking here first also
    // covers activations bound to a different axis.
    const activation = menuConfig.centerField?.activation;
    const activating = activation
      ? meetsActivation(
          axisValue(axes, activation.axis),
          activation.direction,
          activation.threshold,
        )
      : false;
    const activationRising = activating && !wasActivatingRef.current;
    wasActivatingRef.current = activating;
    if (activating) {
      if (activationRising) {
        // Reset our own reducer state on the way out (the callback only
        // hides the window + fires the binding); the next MENU_OPEN
        // re-arms cleanly regardless.
        dispatch({ type: 'reset' });
        onCommitCenter();
      }
      return;
    }

    // TZ back/pop next: a deliberate "back" deflection short-circuits
    // the lateral gestures so it isn't mistaken for "drill harder". At
    // the top level it dismisses — never firing the center binding,
    // which is reserved for the activation/commit paths so the back
    // gesture stays a pure escape hatch; drilled in it pops one level.
    // `tzBackEngaged` honours an optional TZ activation by taking the
    // opposite half of the axis, and routes the threshold through
    // `resolveTzDeadzone` so the user's `MenuConfig.tzDeadzone` override
    // still filters lateral-push cross-talk.
    const tzDeadzone = resolveTzDeadzone(menuConfig.tzDeadzone, DEFAULT_PIE_GEOMETRY.deadzone);
    const backing = tzBackEngaged(axes.tz, tzDeadzone, activation);
    const tzRising = backing && !wasCancelingRef.current;
    wasCancelingRef.current = backing;
    if (backing) {
      if (tzRising) {
        if (drillStateRef.current.navigation.length > 0) {
          dispatch({ type: 'pop' });
        } else {
          dispatch({ type: 'reset' });
          onDismiss();
        }
      }
      return;
    }

    // TZ cross-talk guard. Any TZ deflection past the deadzone suppresses
    // the lateral gestures — including the activation's *ceded* half,
    // which `tzBackEngaged` declined above but which didn't reach the
    // activation threshold either. Pushing a puck straight up/down
    // induces lateral cross-talk, so without this a not-yet-committed
    // activation push would spuriously hover (or, with magnitudeDrill on,
    // drill) a sector. Restores the pre-split "TZ always suppresses
    // lateral" rule using the same strict-greater test the back gesture
    // and activation share.
    if (shouldCancelOnZ(axes.tz, tzDeadzone)) return;

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

    // Three auto-drill gestures, same rising-edge semantics: lateral
    // magnitude (TX/TY push), tilt magnitude (RX/RY rotation), and
    // twist (RZ rotation, direction-agnostic via |rz|). Whichever rises
    // first fires the drill; all run unconditionally each frame so a
    // user with any combination enabled can use whichever they prefer.
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
    const twistRising = detectRisingEdge(
      autoDrillEnabled(menuConfig.twistDrill),
      Math.abs(axes.rz),
      menuConfig.twistDrill?.threshold ?? Infinity,
      wasTwistOverRef,
    );

    if ((lateralRising || tiltRising || twistRising) && sec !== null) {
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
    // identity short-circuits inside it. `onDismiss`/`onCommitCenter`
    // are stable callbacks from App.tsx; listed so the effect always
    // calls the current ones.
  }, [axes, menuConfig, menuOpen, onDismiss, onCommitCenter]);

  return {
    drillState,
    dispatch,
    drillStateRef,
    resetTransientRefs: () => {
      // Reset to `true` (not `false`) so a still-deflected puck at
      // MENU_OPEN doesn't claim a phantom rising edge on frame 1.
      // See the useRef initialisation above for the full rationale.
      wasCancelingRef.current = true;
      wasActivatingRef.current = true;
      wasMagnitudeOverRef.current = true;
      wasTiltOverRef.current = true;
      wasTwistOverRef.current = true;
    },
  };
}
