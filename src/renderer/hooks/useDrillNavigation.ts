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
  currentSectors,
  INITIAL_DRILL_STATE,
  drillReducer,
  resolvePuckFrame,
  type DrillAction,
  type DrillState,
} from '@/core/menu-nav';
import { type MenuConfig, type MenuSector } from '@/shared/menu';

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
  /** Fire the hovered sector's binding via its per-item activation input
   *  (#130 R2). Receives the resolved sector so App.tsx can mirror the
   *  leaf-commit path (close unless the sector is keepOpen, then invoke
   *  its binding). The drill-state reset stays the hook's job, like
   *  `onCommitCenter`. */
  onActivate: (sector: MenuSector | undefined) => void;
}): UseDrillNavigation {
  const { axes, menuConfig, menuOpen, onDismiss, onCommitCenter, onActivate } = opts;

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
  const wasActivateRef = useRef<boolean>(true);
  const wasExitRef = useRef<boolean>(true);
  const wasCommitRef = useRef<boolean>(true);
  const wasBackRef = useRef<boolean>(true);
  const wasDrillRef = useRef<boolean>(true);
  const wasCycleRef = useRef<boolean>(true);

  useEffect(() => {
    if (!menuOpen || !menuConfig) return;

    // The whole per-frame decision lives in the pure resolver; the hook
    // just feeds it the live state + rising-edge memory and applies the
    // outcome. `drillState` is read via `drillStateRef` (not the dep
    // array): axes tick often enough that the next frame picks up any
    // post-drill navigation, and depending on drillState here would
    // re-run on every reducer dispatch. `onDismiss`/`onCommitCenter` are
    // stable callbacks from App.tsx, listed so the effect always calls
    // the current ones.
    const { navigation, stickyChildIndex } = drillStateRef.current;
    const { outcome, edges } = resolvePuckFrame({
      menuConfig,
      axes,
      navigation,
      sticky: stickyChildIndex,
      edges: {
        activate: wasActivateRef.current,
        exit: wasExitRef.current,
        commit: wasCommitRef.current,
        back: wasBackRef.current,
        drill: wasDrillRef.current,
        cycle: wasCycleRef.current,
      },
    });
    // Persist the next rising-edge memory regardless of the outcome — a
    // gesture that was active but didn't fire (held past a previous
    // edge) must still be remembered so it doesn't re-fire next frame.
    wasActivateRef.current = edges.activate;
    wasExitRef.current = edges.exit;
    wasCommitRef.current = edges.commit;
    wasBackRef.current = edges.back;
    wasDrillRef.current = edges.drill;
    wasCycleRef.current = edges.cycle;

    switch (outcome.kind) {
      case 'activate': {
        // Per-item activation fires the hovered leaf's binding mid-gesture.
        // The hook resets its drill state unless the sector is keepOpen
        // (so a continuous action re-fires without reopening), mirroring
        // the keepOpen logic on MENU_COMMIT; App.tsx owns the window
        // hide + invoke.
        const sector = currentSectors(menuConfig, navigation)[outcome.index];
        if (!sector?.keepOpen) dispatch({ type: 'reset' });
        onActivate(sector);
        break;
      }
      case 'exitToCenter':
        // Per-item exit: deselect to the centre, pie stays open. No IPC —
        // a local selection change, like a "soft back" that lands on the
        // centre field instead of popping the ring.
        dispatch({ type: 'hover', index: null });
        break;
      case 'commitCenter':
        // Reset our own reducer state on the way out (the callback only
        // hides the window + fires the binding); the next MENU_OPEN
        // re-arms cleanly regardless.
        dispatch({ type: 'reset' });
        onCommitCenter();
        break;
      case 'back':
        if (outcome.mode === 'pop') {
          dispatch({ type: 'pop' });
        } else {
          dispatch({ type: 'reset' });
          onDismiss();
        }
        break;
      case 'drill':
        // child[0] aligns with the parent sector's angle thanks to the
        // outer-ring rotation, so landing sticky on 0 matches the user's
        // puck direction.
        dispatch({ type: 'drill', index: outcome.index, nextSticky: 0 });
        break;
      case 'hover':
        dispatch({ type: 'hover', index: outcome.index });
        break;
      case 'none':
        break;
    }
  }, [axes, menuConfig, menuOpen, onDismiss, onCommitCenter, onActivate]);

  return {
    drillState,
    dispatch,
    drillStateRef,
    resetTransientRefs: () => {
      // Reset to `true` (not `false`) so a still-deflected puck at
      // MENU_OPEN doesn't claim a phantom rising edge on frame 1.
      // See the useRef initialisation above for the full rationale.
      wasActivateRef.current = true;
      wasExitRef.current = true;
      wasCommitRef.current = true;
      wasBackRef.current = true;
      wasDrillRef.current = true;
      wasCycleRef.current = true;
    },
  };
}
