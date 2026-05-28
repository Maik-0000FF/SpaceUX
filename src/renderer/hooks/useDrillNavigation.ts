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
 * (`onCommitCenter` / `onDismiss`), which owns the IPC. The back gesture
 * walks toward the centre (#147): drilled in it pops a level; at the top
 * level it focuses the centre (a soft "exit to centre", pie stays open);
 * only from the centre itself does it dismiss. It never fires the bound
 * centre action — that stays reserved for the commitCenter gesture and
 * the trigger-button commit, keeping "navigate" and "centre action" as
 * separate intents.
 *
 * App.tsx calls `useDrillNavigation` once and gets back the React
 * state plus a `resetTransientRefs` helper to invoke on MENU_OPEN.
 * Reset arms the rising-edge memories to `true` so a still-held
 * puck at open time doesn't fire any gesture on the first frame —
 * the user has to release past the threshold and re-engage before
 * a drill, pop, dismiss, or center activation can register.
 */

import { useEffect, useMemo, useReducer, useRef, type Dispatch, type RefObject } from 'react';

import {
  currentBranches,
  INITIAL_DRILL_STATE,
  drillReducer,
  resolvePuckFrame,
  type DrillAction,
  type DrillState,
} from '@/core/menu-nav';
import { type MenuConfig, type MenuNode } from '@/shared/menu';
import {
  validateShapeLayout,
  type ShapeLayout,
  type ShapePluginModule,
  type ShapePuckAxes,
  type ShapeRingRadii,
  type ShapeRingSlot,
} from '@/shared/shape-plugin-api';

/** Build one ring slot's shape layout for the host, or null on any
 *  failure path (no module, no ring, layout threw, layout output
 *  rejected). Kept module-local so the inner + outer memos can call
 *  it without diverging on edge-case handling. */
function buildRingLayout(
  module: ShapePluginModule,
  ringRadii: ShapeRingRadii,
  sectorCount: number,
  ring: ShapeRingSlot,
): ShapeLayout | null {
  if (sectorCount === 0) return null;
  let raw: unknown;
  try {
    raw = module.layout(sectorCount, ringRadii, ring);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[shape] layout(${ring}) threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const validated = validateShapeLayout(raw, sectorCount);
  if (!validated.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[shape] layout(${ring}) rejected: ${validated.reason}`);
    return null;
  }
  return validated.layout;
}

/**
 * Defensive wrap around a shape plugin's `hitTest`. Catches throws and
 * normalises the return so a buggy plugin can't (a) spam the gesture
 * loop with errors at 60Hz or (b) leak a non-integer / out-of-range
 * sector index into the downstream sticky-selection logic. Any
 * abnormal return folds to `null` (no sector hovered), matching the
 * wedge default's `aimed === null` short-circuit. Exported (with the
 * leading underscore convention) so tests can pin the behaviour
 * without a React harness; production callers go through the hook
 * below.
 */
export function _safeShapeHitTest(
  module: ShapePluginModule,
  ringRadii: ShapeRingRadii,
  layout: ShapeLayout,
  axes: ShapePuckAxes,
): number | null {
  let r: unknown;
  try {
    r = module.hitTest(axes, ringRadii, layout);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[shape] hitTest() threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (r === null) return null;
  // Bound-check against the layout's node count: the plugin already
  // committed to the sector count when it produced the layout, so this
  // is the natural source of truth (and means callers don't have to
  // plumb the count separately).
  const sectorCount = layout.nodes.length;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r >= sectorCount) return null;
  return r;
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
  /** Shape-plugin layout for the inner ring slot (#107 PR4). Inner
   *  is the active ring at top level, and the breadcrumb of parent
   *  items once drilled in. `null` when no shape plugin is active,
   *  the module isn't loaded yet, the slot's ring is empty, or the
   *  plugin's `layout()` output failed validation. */
  innerShapeLayout: ShapeLayout | null;
  /** Shape-plugin layout for the outer ring slot (#107 PR4). Outer
   *  is the active ring when drilled in, and the preview of the
   *  hovered branch's children at top level. Same null semantics as
   *  innerShapeLayout. */
  outerShapeLayout: ShapeLayout | null;
};

export function useDrillNavigation(opts: {
  axes: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number };
  /** Currently-held device buttons (`buttons[i]` true while button i is
   *  down), so button-bound gesture inputs fire. A change re-runs the
   *  frame even when the puck is idle. */
  buttons: readonly boolean[];
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
  onActivate: (node: MenuNode | undefined) => void;
  /** Active shape-plugin context (#107 PR3c). When set, the hook
   *  computes the plugin's `layout(sectorCount, ringRadii)` (cached
   *  per sectorCount) and passes the corresponding `hitTest` to
   *  `resolvePuckFrame`, replacing the wedge-default sector resolution.
   *  Omit (or pass `null`) for the wedge default. */
  shapeContext?: { module: ShapePluginModule; ringRadii: ShapeRingRadii } | null;
}): UseDrillNavigation {
  const { axes, buttons, menuConfig, menuOpen, onDismiss, onCommitCenter, onActivate } = opts;
  const shapeContext = opts.shapeContext ?? null;

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

  // Shape-plugin layouts for the inner + outer ring slots (#107 PR4).
  // Both rings render simultaneously when a shape plugin is active so
  // the planets-style pie keeps the wedge default's "active ring +
  // breadcrumb / preview" layering (just rendered as orbital nodes
  // instead of slices). Each ring's layout is memoed independently so
  // drilling, hovering a new branch, or swapping the plugin only
  // recomputes the slots that actually changed. Computed in the hook
  // (not in PieMenu) so the gesture-loop hit-test reads the same
  // ShapeLayout object the renderer paints — no parallel call site
  // that could drift on a non-pure plugin.
  const isDrilled = drillState.navigation.length > 0;
  const innerSectorCount = useMemo(() => {
    if (menuConfig === null) return 0;
    // At top level, the inner ring is the active ring. Once drilled,
    // it's the parent ring (the breadcrumb).
    const path = isDrilled ? drillState.navigation.slice(0, -1) : drillState.navigation;
    return currentBranches(menuConfig, path).length;
  }, [menuConfig, drillState.navigation, isDrilled]);
  const outerSectorCount = useMemo(() => {
    if (menuConfig === null) return 0;
    if (isDrilled) {
      // Drilled: outer ring carries the active items.
      return currentBranches(menuConfig, drillState.navigation).length;
    }
    // Top level: outer ring previews the children of the currently
    // hovered branch, mirroring the wedge default's preview band.
    // No hovered sector => no outer ring.
    const sticky = drillState.stickyChildIndex;
    if (sticky === null) return 0;
    const ring = currentBranches(menuConfig, drillState.navigation);
    const hovered = ring[sticky];
    return hovered?.branches?.length ?? 0;
  }, [menuConfig, drillState.navigation, drillState.stickyChildIndex, isDrilled]);
  const innerShapeLayout = useMemo<ShapeLayout | null>(() => {
    if (shapeContext === null) return null;
    return buildRingLayout(shapeContext.module, shapeContext.ringRadii, innerSectorCount, 'inner');
  }, [shapeContext, innerSectorCount]);
  const outerShapeLayout = useMemo<ShapeLayout | null>(() => {
    if (shapeContext === null) return null;
    return buildRingLayout(shapeContext.module, shapeContext.ringRadii, outerSectorCount, 'outer');
  }, [shapeContext, outerSectorCount]);
  // The hit-test runs against whichever layout the active ring uses.
  const activeShapeLayout = isDrilled ? outerShapeLayout : innerShapeLayout;

  useEffect(() => {
    if (!menuOpen || !menuConfig) return;

    // Build the optional shape hit-test closure. The wedge default is
    // active when this stays undefined; resolvePuckFrame's signature
    // tolerates both paths.
    let hitTest:
      | ((axesArg: {
          tx: number;
          ty: number;
          tz: number;
          rx: number;
          ry: number;
          rz: number;
        }) => number | null)
      | undefined;
    if (shapeContext !== null && activeShapeLayout !== null) {
      const { module, ringRadii } = shapeContext;
      const layoutLocal = activeShapeLayout;
      // Route through `_safeShapeHitTest` so a buggy plugin can't spam
      // the gesture loop with throws or feed NaN / negative indices
      // into the downstream sticky-selection logic.
      hitTest = (axesArg) => _safeShapeHitTest(module, ringRadii, layoutLocal, axesArg);
    }

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
      buttons,
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
      hitTest,
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
        const node = currentBranches(menuConfig, navigation)[outcome.index];
        if (!node?.keepOpen) dispatch({ type: 'reset' });
        onActivate(node);
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
        // Land at the child ring's centre (no selection) so entering a
        // submenu works exactly like entering the top ring from the centre:
        // you aim or twist onto an item. Continuous aiming (push/tilt)
        // re-hovers from the live puck on the next frame; a twist style
        // steps in from the centre, same as the first ring.
        dispatch({ type: 'drill', index: outcome.index, nextSticky: null });
        break;
      case 'hover':
        dispatch({ type: 'hover', index: outcome.index });
        break;
      case 'none':
        break;
    }
  }, [
    axes,
    buttons,
    menuConfig,
    menuOpen,
    onDismiss,
    onCommitCenter,
    onActivate,
    shapeContext,
    activeShapeLayout,
  ]);

  return {
    drillState,
    dispatch,
    drillStateRef,
    innerShapeLayout,
    outerShapeLayout,
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
