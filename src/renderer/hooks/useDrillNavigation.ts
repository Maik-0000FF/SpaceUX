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
 *  - Edge-trigger refs for the gestures that need rising-only
 *    semantics — center activation, TZ back/pop, the lateral / tilt /
 *    twist drills, and the twist cycle — so a sustained deflection
 *    fires once per gesture rather than cascading through nested levels
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
  resolveTwistFrame,
  type DrillAction,
  type DrillState,
} from '@/core/menu-nav';
import {
  axesToSector,
  backAxisEngaged,
  cycleStepFromInputs,
  DEFAULT_PIE_GEOMETRY,
  gestureActive,
  rotateAxes,
  type GestureFrame,
} from '@/core/pie-geometry';
import { resolveAxisInvert, resolveNavigation, type MenuConfig } from '@/shared/menu';

/** Rising-edge detector for a boolean gesture: `true` once when
 *  `active` flips false→true, then stays `false` until it goes inactive
 *  again. Mutates `prevRef` to carry the "was active" memory. */
function risingEdge(active: boolean, prevRef: RefObject<boolean>): boolean {
  const rising = active && !prevRef.current;
  prevRef.current = active;
  return rising;
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

  // One rising-edge memory per gesture (commit-center, back, drill,
  // cycle). All start `true` so the first frame after MENU_OPEN is
  // never treated as a rising edge: if the puck is already past a
  // threshold at open time (the user was mid-gesture when they
  // triggered the menu), the gesture has to physically dip back under
  // its threshold and re-engage before it fires. Without this, opening
  // the menu with a held puck would surprise the user with an immediate
  // drill or pop. `resetTransientRefs` re-asserts this on every
  // MENU_OPEN so a previous session's tail state can't carry over.
  const wasCommitRef = useRef<boolean>(true);
  const wasBackRef = useRef<boolean>(true);
  const wasDrillRef = useRef<boolean>(true);
  const wasCycleRef = useRef<boolean>(true);

  useEffect(() => {
    if (!menuOpen || !menuConfig) return;

    const nav = resolveNavigation(menuConfig);
    // Button states aren't plumbed to the hook yet, so button-bound
    // inputs are inert for now (no migrated config uses them); axis +
    // magnitude inputs drive everything. A later PR feeds real button
    // state here.
    const frame: GestureFrame = { axes, buttons: [] };

    // Commit-center first: its gesture commits the center directly —
    // firing the binding, or dismissing when it has none. Rising-edge so
    // a sustained deflection fires once. Checked ahead of back so a
    // shared axis resolves to commit when its half is engaged.
    const committing = gestureActive(nav.commitCenter, frame);
    const commitRising = risingEdge(committing, wasCommitRef);
    if (committing) {
      if (commitRising) {
        // Reset our own reducer state on the way out (the callback only
        // hides the window + fires the binding); the next MENU_OPEN
        // re-arms cleanly regardless.
        dispatch({ type: 'reset' });
        onCommitCenter();
      }
      return;
    }

    // Back/pop next: a deliberate "back" gesture short-circuits the
    // lateral gestures so it isn't mistaken for "drill harder". At the
    // top level it dismisses — never firing the center binding, which is
    // reserved for the commit/activation paths so back stays a pure
    // escape hatch; drilled in it pops one level.
    const backing = gestureActive(nav.back, frame);
    const backRising = risingEdge(backing, wasBackRef);
    if (backing) {
      if (backRising) {
        if (drillStateRef.current.navigation.length > 0) {
          dispatch({ type: 'pop' });
        } else {
          dispatch({ type: 'reset' });
          onDismiss();
        }
      }
      return;
    }

    // Cross-talk guard: a deflection on the back gesture's axis (in
    // either sense) suppresses lateral selection, even the half a split
    // cedes to commit-center that hasn't reached its threshold yet.
    // Pushing the puck straight along that axis induces lateral
    // cross-talk; this keeps it from spuriously hovering/drilling.
    if (backAxisEngaged(nav.back, axes)) return;

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

    // Drill gesture: any of its inputs (lateral/tilt/twist magnitude,
    // a split axis, …) firing drills into the hovered branch. One
    // rising-edge over the combined gesture — a held drill fires once.
    const drillRising = risingEdge(gestureActive(nav.drillIn, frame), wasDrillRef);

    // Cycle: a directional axis input steps the selection one sector.
    // Rising-edge so a held twist steps once. Shares an axis with drill
    // via a threshold split — keep the cycle threshold below the drill
    // threshold so a gentle twist steps and a firmer one drills (a fast
    // twist past both steps then drills the just-stepped sector via
    // `drillTarget`).
    const cycleStepRaw = cycleStepFromInputs(nav.cycle.inputs, axes);
    const cycleOver = cycleStepRaw !== 0;
    const cycleStep = cycleOver && !wasCycleRef.current ? cycleStepRaw : 0;
    // Mark the edge consumed every frame the cycle axis is over its
    // threshold — even one made while aiming laterally under
    // `priority: 'lateral'`, where `resolveTwistFrame` drops the step.
    wasCycleRef.current = cycleOver;

    // Resolve this frame's hover + drill target from the pure helper, so
    // the priority and sticky-drill-fallback rules stay unit-tested.
    const sticky = drillStateRef.current.stickyChildIndex;
    const { hoverIndex, drillTarget } = resolveTwistFrame({
      sec,
      sticky,
      cycleStep,
      priority: nav.cycle.priority,
      count: current.length,
      // Only axis inputs can actually step; a button/magnitude-only
      // cycle binding mustn't gate the sticky-drill fallback.
      cycleEnabled: nav.cycle.inputs.some((input) => input.kind === 'axis'),
    });

    if (drillRising && drillTarget !== null) {
      const hovered = current[drillTarget];
      if (hovered?.children) {
        // child[0] aligns with the parent sector's angle thanks to
        // the outer-ring rotation, so landing sticky on 0 matches
        // the user's puck direction.
        dispatch({ type: 'drill', index: drillTarget, nextSticky: 0 });
        return;
      }
    }

    if (hoverIndex !== null) dispatch({ type: 'hover', index: hoverIndex });
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
      wasCommitRef.current = true;
      wasBackRef.current = true;
      wasDrillRef.current = true;
      wasCycleRef.current = true;
    },
  };
}
