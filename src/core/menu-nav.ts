// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure state-machine helpers for navigating nested menus.
 *
 * The renderer uses `useReducer(drillReducer, INITIAL_DRILL_STATE)`
 * to track which submenu the user has drilled into and which sector
 * within that submenu is currently sticky. Both helpers below are
 * framework-free and deterministic — vitest can pin every transition
 * without a renderer harness.
 *
 * Conventions:
 *   - `navigation` is a path of zero-based node indices, deepest
 *     last. `[]` = top level, `[0]` = inside `root.branches[0].branches`,
 *     `[0, 2]` = inside `root.branches[0].branches[2].branches`, and so on.
 *   - `stickyChildIndex` is the user's currently-selected node
 *     *inside the current ring* (the ring resolved by `currentBranches`).
 *   - Commit and TZ-cancel are handled by the caller (they trigger
 *     side effects like firing an action or closing the menu);
 *     the reducer only mutates the navigation/selection state.
 */

// Relative import: src/core/ is shared between the renderer tsconfig
// (which has the `@/shared/*` path alias) and the main-process
// tsconfig.electron.json (which doesn't). Sticking to relative keeps
// this module buildable under both without duplicating the alias.
import {
  aimAxes,
  axesMagnitude,
  axesToSector,
  backAxisEngaged,
  cycleStepFromInputs,
  DEFAULT_PIE_GEOMETRY,
  gestureActive,
  rotateAxes,
  sectorCenterAngle,
  type GestureFrame,
  type SixAxes,
} from './pie-geometry';
import {
  DEFAULT_TRIGGER_MODE,
  isCancelNode,
  resolveAxisInvert,
  resolveNavigation,
} from '../shared/menu';
import type { MenuConfig, MenuNode, TwistCyclePriority } from '../shared/menu';

export type DrillState = {
  navigation: number[];
  stickyChildIndex: number | null;
};

export const INITIAL_DRILL_STATE: DrillState = {
  navigation: [],
  stickyChildIndex: null,
};

export type DrillAction =
  /** Reset to initial. Dispatched both on MENU_OPEN (start clean
   *  so a previous session's leftover can't fire) and on
   *  menu-close paths (silent-dismiss, leaf-commit). The name says
   *  what the transition *is* — every call site is a "clear all
   *  drill state and selection back to scratch", regardless of
   *  whether that's because we're opening or tearing down. */
  | { type: 'reset' }
  /** Puck-to-sector resolution. `index = null` means the puck is in
   *  the deadzone or TZ-cancelled — no sector is sticky. */
  | { type: 'hover'; index: number | null }
  /** TZ rising edge: drill out one level. No-op at depth 0 so the
   *  caller doesn't have to gate the dispatch. */
  | { type: 'pop' }
  /** Commit on a branch sector: push that sector's index onto the
   *  navigation stack and set the selection in the new ring.
   *  `nextSticky` lets the caller carry the parent's sticky position
   *  into the deeper ring (clamped to the children's range) so a
   *  drill-in done while the puck has already returned to the
   *  deadzone shows a sensible default highlight instead of the
   *  red cancel target. Pass `null` to start the new ring with no
   *  selection. */
  | { type: 'drill'; index: number; nextSticky: number | null };

/**
 * Pure state transition. Returns a new state when something changes,
 * the same reference when nothing changes — the latter lets React
 * skip the re-render under `useReducer`.
 */
export function drillReducer(state: DrillState, action: DrillAction): DrillState {
  switch (action.type) {
    case 'reset':
      // Fast path: avoid producing a fresh object on every reset
      // when the state is already clean.
      if (state.navigation.length === 0 && state.stickyChildIndex === null) return state;
      return INITIAL_DRILL_STATE;
    case 'hover':
      if (state.stickyChildIndex === action.index) return state;
      return { ...state, stickyChildIndex: action.index };
    case 'pop':
      if (state.navigation.length === 0) return state;
      return {
        navigation: state.navigation.slice(0, -1),
        // Land sticky on the popped index — the sector we drilled
        // into now appears highlighted in the parent ring, giving
        // the user a clear "you came from here" cue instead of the
        // red cancel target the user complained about. Falls back
        // to `null` only when the navigation is empty (can't happen
        // given the guard above, but the optional access satisfies
        // strict array-index typing).
        stickyChildIndex: state.navigation[state.navigation.length - 1] ?? null,
      };
    case 'drill':
      return {
        navigation: [...state.navigation, action.index],
        stickyChildIndex: action.nextSticky,
      };
  }
}

/**
 * Walk the navigation path through the config tree and return the
 * node list of the current ring. Falls back to the top-level
 * branches if any intermediate step doesn't resolve to a submenu —
 * e.g. if the config was hot-reloaded mid-drill and the path is now
 * stale, the caller still sees a valid ring rather than `undefined`.
 *
 * Pure: no React, no DOM, no I/O. Tested in isolation.
 */
export function currentBranches(config: MenuConfig, navigation: readonly number[]): MenuNode[] {
  const top = config.root.branches ?? [];
  let level: MenuNode[] = top;
  for (const i of navigation) {
    const next = level[i]?.branches;
    // The `!next` branch fires on real-world stale paths (hot-reload
    // turned a submenu into a leaf). The `length === 0` branch is
    // belt-and-braces: the on-disk validator already rejects empty
    // `branches` arrays, but in-memory MenuConfig literals (e.g. in
    // tests) can bypass that gate, and a 0-length ring would render
    // as a hole with no way out.
    if (!next || next.length === 0) return top;
    level = next;
  }
  return level;
}

/**
 * Step the highlighted sector index by `step` (+1 = next/clockwise,
 * -1 = previous), wrapping at the ring's ends — the index maths behind
 * the twist-cycle gesture.
 *
 * From "nothing selected" (`current === null`) a forward step lands on
 * the first sector and a backward step on the last, so the user enters
 * the ring at the natural end for their twist direction. `step === 0`
 * is a no-op that keeps the current selection. `count < 1` yields 0
 * (defensive — the validator forbids empty rings, but in-memory configs
 * can bypass that).
 */
export function cycleNodeIndex(current: number | null, step: -1 | 0 | 1, count: number): number {
  if (count < 1) return 0;
  if (step === 0) return current ?? 0;
  if (current === null) return step > 0 ? 0 : count - 1;
  return (((current + step) % count) + count) % count;
}

/** What a single puck frame resolves to for the twist-cycle gesture:
 *  which sector to highlight, and which one an auto-drill would commit. */
export type TwistFrame = {
  /** Sector to hover this frame, or `null` for "no change" (the sticky
   *  selection persists). */
  hoverIndex: number | null;
  /** Sector an auto-drill (lateral / tilt / twist) commits this frame,
   *  or `null` for "nothing to drill". */
  drillTarget: number | null;
};

/**
 * Resolve one puck frame's selection for the twist-cycle gesture,
 * factored out of the renderer hook so the priority and drill-target
 * rules are unit-testable without a DOM. The rising-edge gating that
 * turns a sustained twist into a single `cycleStep` stays at the call
 * site (it needs a ref); everything downstream of that is pure.
 *
 *   - A cycle step applies when it fired AND either the puck isn't
 *     aimed laterally (`priority: 'lateral'`) or twist is configured to
 *     win (`priority: 'twist'`); it steps from the current sticky.
 *     Otherwise lateral aiming sets the hover, and a centred puck with
 *     no step leaves the selection unchanged (`hoverIndex = null`).
 *   - `drillTarget` is the live selection, falling back to the sticky
 *     **only when twist-cycle is enabled** — so configs without it keep
 *     the historical "a drill needs a laterally-aimed sector" behaviour
 *     and don't silently start drilling a stale sticky from centre.
 */
export function resolveTwistFrame(opts: {
  /** Laterally-aimed sector this frame, or `null` (in the deadzone). */
  sec: number | null;
  /** Current sticky selection. */
  sticky: number | null;
  /** Twist-cycle step this frame: `+1`/`-1` after the rising edge, else `0`. */
  cycleStep: -1 | 0 | 1;
  /** Resolves a step that collides with lateral aiming. Only consulted
   *  when `cycleStep !== 0`. */
  priority: TwistCyclePriority;
  /** Active ring size, for the wrap. */
  count: number;
  /** Whether the cycle gesture is bound — gates the sticky drill fallback. */
  cycleEnabled: boolean;
}): TwistFrame {
  const { sec, sticky, cycleStep, priority, count, cycleEnabled } = opts;
  const cycleApplies = cycleStep !== 0 && (priority === 'twist' || sec === null);
  const hoverIndex = cycleApplies ? cycleNodeIndex(sticky, cycleStep, count) : sec;
  const drillTarget = hoverIndex ?? (cycleEnabled ? sticky : null);
  return { hoverIndex, drillTarget };
}

/**
 * Rotation (radians) the outer ring uses so its sector 0 lines up
 * with the parent sector the user drilled in from. Returns 0 for
 * the top-level case (no parent) — the inner pie is the active
 * selection target there and uses no rotation.
 *
 * Shared by the renderer (rotates the visible wedges + labels) and
 * the puck-to-sector mapper in App.tsx (rotates the axes by
 * `-offset` so the gesture flows continuously from the parent into
 * the drilled-in ring). Centralising the formula here is the only
 * way to keep those two sites from silently disagreeing about which
 * sector the user is pointing at after a drill.
 */
export function navigationRingRotation(config: MenuConfig, navigation: readonly number[]): number {
  if (navigation.length === 0) return 0;
  const parentRing = currentBranches(config, navigation.slice(0, -1));
  const drilledIntoIndex = navigation[navigation.length - 1]!;
  return sectorCenterAngle(drilledIntoIndex, parentRing.length);
}

/**
 * Branches of the currently-hovered node in the active ring, or
 * `undefined` if no node is hovered or the hovered node is a
 * leaf. The renderer reads this to decide whether (and what) to
 * draw as the concentric outer preview ring.
 *
 * Pure: no React, no DOM. Pinned in tests so the renderer-side
 * trigger for the outer ring is decoupled from React-rendering
 * test infrastructure.
 */
export function previewBranches(
  config: MenuConfig,
  drillState: DrillState,
): MenuNode[] | undefined {
  if (drillState.stickyChildIndex === null) return undefined;
  const ring = currentBranches(config, drillState.navigation);
  return ring[drillState.stickyChildIndex]?.branches;
}

/** Rising-edge memory for the gestures that fire once per engagement
 *  (commit-center, back/pop, drill, twist-cycle). `true` means the
 *  gesture was active on the previous frame, so a still-held deflection
 *  doesn't re-fire. Mirrors the four refs the renderer hook used to
 *  hold; carried in and out of {@link resolvePuckFrame} so the decision
 *  logic is pure and the hook only stores the result. */
export type PuckEdges = {
  /** Per-item activation of the hovered leaf (#130 R2). Checked first so
   *  a per-item input wins over a colliding global gesture. */
  activate: boolean;
  /** Per-item exit-to-centre of the hovered sector (#130 R3). Like
   *  `activate`, checked ahead of the global gestures. */
  exit: boolean;
  commit: boolean;
  back: boolean;
  drill: boolean;
  cycle: boolean;
};

/** What one puck frame resolves to — the single side-effecting action
 *  the renderer should take this frame. Mirrors the dispatches/callbacks
 *  the hook performed inline:
 *   - `activate`: fire the hovered leaf's binding (per-item activation).
 *   - `exitToCenter`: deselect to the centre (per-item exit; pie stays open).
 *   - `commitCenter`: reset state + fire the centre binding (or dismiss).
 *   - `back`: `pop` one level, or `dismiss` at the top.
 *   - `drill`: drill into the branch at `index`.
 *   - `hover`: set the sticky selection to `index`.
 *   - `none`: do nothing this frame. */
export type PuckOutcome =
  | { kind: 'activate'; index: number }
  | { kind: 'exitToCenter' }
  | { kind: 'commitCenter' }
  | { kind: 'back'; mode: 'pop' | 'dismiss' }
  | { kind: 'drill'; index: number }
  | { kind: 'hover'; index: number }
  | { kind: 'none' };

/**
 * Resolve one puck frame to an outcome + the next rising-edge memory —
 * the whole per-frame navigation decision, lifted out of the renderer's
 * `useDrillNavigation` effect so it is pure and unit-testable (the
 * effect now just applies the outcome). Behaviour is a verbatim
 * extraction of the previous inline logic: same gesture priority
 * (commit-center → back → lateral/drill/cycle), same cross-talk guard,
 * and the same partial edge-update on early return — a gesture that
 * short-circuits the frame leaves the later gestures' memory untouched,
 * exactly as the separate refs did.
 *
 * Pure: no React, no DOM. The caller owns the IPC side effects the
 * outcome describes; this function only decides.
 */
export function resolvePuckFrame(args: {
  menuConfig: MenuConfig;
  axes: SixAxes;
  /** Current drill path (`drillState.navigation`). */
  navigation: readonly number[];
  /** Current sticky selection (`drillState.stickyChildIndex`). */
  sticky: number | null;
  /** Currently-held device buttons (`buttons[i]` true while button i is
   *  down). Drives button-bound inputs; omit for axis-only callers. */
  buttons?: readonly boolean[];
  /** Rising-edge memory from the previous frame. */
  edges: PuckEdges;
}): { outcome: PuckOutcome; edges: PuckEdges } {
  const { menuConfig, axes, navigation, sticky } = args;
  // Copy so the caller's memory is only updated via the returned value.
  const edges: PuckEdges = { ...args.edges };
  const nav = resolveNavigation(menuConfig);
  const frame: GestureFrame = { axes, buttons: args.buttons ?? [] };

  const current = currentBranches(menuConfig, navigation);

  // Per-item activation first (#130 R2): if the hovered leaf binds an
  // activation input and it rises, fire that node's action. Checked
  // ahead of every global gesture so a per-item input wins over a
  // colliding global one (e.g. binding TZ− to activate this item beats
  // the global TZ back — direction-aware, since back's other half stays
  // free as the way out). Only a leaf that actually fires something
  // qualifies (the validator already enforces this; the guard keeps
  // in-memory configs honest).
  const hovered = sticky !== null ? current[sticky] : undefined;
  // A hovered leaf with an action can be activated mid-gesture by either
  // route, sharing the one `activate` edge + outcome:
  //   - the leaf's own per-item `activation` binding (#130 R2), or
  //   - the menu-level `activate` gesture (#160) — the style-friendly way
  //     to fire every leaf from one input without per-item bindings.
  // Per-item still wins on a shared input (it's the first operand). Only a
  // leaf that fires something qualifies (action present, no branches) — the
  // validator enforces this for per-item; the guard keeps in-memory honest.
  const isActivatableLeaf = hovered?.action !== undefined && hovered.branches === undefined;
  const perItemActivation =
    isActivatableLeaf && hovered?.activation !== undefined ? hovered.activation : undefined;
  const activating =
    isActivatableLeaf &&
    ((perItemActivation !== undefined && gestureActive(perItemActivation, frame)) ||
      gestureActive(nav.activate, frame));
  const activateRising = activating && !edges.activate;
  edges.activate = activating;
  if (activating) {
    return {
      outcome: activateRising ? { kind: 'activate', index: sticky! } : { kind: 'none' },
      edges,
    };
  }

  // Per-item exit next (#130 R3): the hovered sector's own way back to the
  // centre (deselect, pie stays open). Like activation, checked ahead of
  // the global gestures so a per-item input wins on a shared one — e.g. the
  // alternative way out when an activation has shadowed the global back.
  const exiting = hovered?.exit !== undefined && gestureActive(hovered.exit, frame);
  const exitRising = exiting && !edges.exit;
  edges.exit = exiting;
  if (exiting) {
    // Exit deselects (nulls sticky), so next frame this short-circuit is
    // gone — no hovered sector — and a still-held input would fall through
    // to the lower-priority globals, whose edge memory this early return
    // never touched (the R1 partial-update). With the default TZ-both back,
    // that dismisses the menu one frame after the deselect — the opposite
    // of "pie stays open". So fold the globals' current activity into the
    // returned edges: a sustained input then claims no rising edge next
    // frame; a real release + re-press is a fresh gesture. (Unlike commit
    // and a top-level back, exit keeps the menu open, so it's the one path
    // that must carry the held-input state forward.)
    edges.commit = gestureActive(nav.commitCenter, frame);
    edges.back = gestureActive(nav.back, frame);
    edges.drill = gestureActive(nav.drillIn, frame);
    edges.cycle = cycleStepFromInputs(nav.cycle.inputs, axes) !== 0;
    return { outcome: exitRising ? { kind: 'exitToCenter' } : { kind: 'none' }, edges };
  }

  // Commit-center next: checked ahead of back so a shared axis resolves
  // to commit when its half is engaged. Rising-edge → a sustained
  // deflection fires once. Only fires when the centre is the active target
  // (no sector hovered) — committing the centre while a sector is selected
  // would wrongly fire the centre's action (e.g. close on a cancel centre)
  // from a sector. The edge is tracked regardless so a gesture held across
  // the sector→centre transition doesn't fire on arrival; a fresh press at
  // the centre is required.
  const committing = gestureActive(nav.commitCenter, frame);
  const commitRising = committing && !edges.commit;
  edges.commit = committing;
  if (committing && sticky === null) {
    return { outcome: commitRising ? { kind: 'commitCenter' } : { kind: 'none' }, edges };
  }

  // Back next: a deliberate back gesture short-circuits the lateral
  // gestures so it isn't mistaken for "drill harder". Drilled in, it pops
  // one level. At the top level it walks INTO the centre (the tree root)
  // rather than dismissing outright (#147): from a hovered sector it
  // focuses the centre (pie stays open, like a per-item exit); from the
  // centre itself (nothing hovered) it dismisses — but only as a *fallback*
  // escape: when the centre is bound to cancel AND that cancel is reachable
  // another way (the trigger in toggle mode, or a bound commitCenter), back
  // doesn't double up the close path — it just rests on the centre. If no
  // such path exists (open mode + cancel centre + unbound commitCenter),
  // back keeps dismissing so the pie can never soft-lock.
  const backing = gestureActive(nav.back, frame);
  const backRising = backing && !edges.back;
  edges.back = backing;
  if (backing) {
    if (!backRising) return { outcome: { kind: 'none' }, edges };
    if (navigation.length > 0) return { outcome: { kind: 'back', mode: 'pop' }, edges };
    if (sticky !== null) {
      // Focus the centre, pie stays open. Like the per-item exit this nulls
      // sticky, so next frame the short-circuit is gone and a still-held
      // back would fall through to dismiss — fold the globals' current
      // activity into the edges so a sustained back claims no rising edge.
      edges.commit = gestureActive(nav.commitCenter, frame);
      edges.drill = gestureActive(nav.drillIn, frame);
      edges.cycle = cycleStepFromInputs(nav.cycle.inputs, axes) !== 0;
      return { outcome: { kind: 'exitToCenter' }, edges };
    }
    // At the centre. Suppress the redundant back-dismiss only when a cancel
    // centre is actually closable another way — the trigger in toggle mode,
    // or a bound commitCenter. Otherwise keep back as the guaranteed escape
    // so open mode + a cancel centre + unbound commitCenter can't strand the
    // pie with no way out.
    const centreClosable =
      (menuConfig.triggerMode ?? DEFAULT_TRIGGER_MODE) === 'toggle' ||
      nav.commitCenter.inputs.length > 0;
    if (isCancelNode(menuConfig.root) && centreClosable) {
      return { outcome: { kind: 'none' }, edges };
    }
    return { outcome: { kind: 'back', mode: 'dismiss' }, edges };
  }

  // Cross-talk guard: a deflection on the back axis (either sense)
  // suppresses lateral selection, even the half a split cedes to commit
  // that hasn't reached its threshold yet.
  if (backAxisEngaged(nav.back, axes)) {
    return { outcome: { kind: 'none' }, edges };
  }

  // An empty ring (the top-level ring can be emptied down to just the centre)
  // has nothing to aim at, drill, or cycle — short-circuit before the sector
  // maths so a 0-length ring can't produce a NaN index. The centre gestures
  // above (commit / back) still close it.
  if (current.length === 0) {
    return { outcome: { kind: 'none' }, edges };
  }

  const invert = resolveAxisInvert(menuConfig);

  // Resolve the configured aim source (#159 — push / tilt / both / twist,
  // no longer hardwired to TX/TY). The 2D sources are rotated so the
  // puck-to-sector mapping respects the visual rotation of the drilled-in
  // outer ring (0 at the top level); `twist` has no lateral pointer
  // (aimAxes → null) so no sector comes from deflection — the cycle/twist
  // step below drives the selection alone.
  const ringRotation = navigationRingRotation(menuConfig, navigation);
  const aimed = aimAxes(nav.aim, axes);
  // Hover threshold (low end of the aim band): the aimed sector lights up
  // once the aim passes nav.hoverDeadzone, immediately and the same at every
  // depth. axesToSector returns null below it.
  const rawSec =
    aimed === null
      ? null
      : axesToSector(rotateAxes(aimed, -ringRotation), {
          ...DEFAULT_PIE_GEOMETRY,
          sectorCount: current.length,
          deadzone: nav.hoverDeadzone,
          invertX: invert.x,
          invertY: invert.y,
        });
  // axesToSector clamps internal sectorCount to a minimum of 2, so a
  // 1-child ring can return index 1 — clamp out so sticky always lands
  // on an existing sector.
  const sec = rawSec === null ? null : rawSec % current.length;

  // Open submenu ("drill"): firmly aiming past nav.deadzone (the high end of
  // the aim band) opens the hovered branch — the aim subsumes the drill
  // gesture for the 2D aim sources, so a style needn't bind a separate input.
  // A bound drillIn input also descends, for twist styles where there's no
  // aim magnitude.
  //
  // Schmitt-triggered to stop a cascade through submenus that line up on one
  // axis: it fires above the open threshold (nav.deadzone) but only re-arms
  // once the aim eases back below the lower hover threshold (or the bound
  // input releases). A spring-loaded puck overshooting near the open
  // threshold then can't produce a fresh rising edge — each level needs a
  // deliberate ease-back, the intermediate step.
  const drillGesture = gestureActive(nav.drillIn, frame);
  const aimMagnitude = aimed === null ? 0 : axesMagnitude(aimed);
  const descendActive = aimMagnitude > nav.deadzone || drillGesture;
  const drillRising = descendActive && !edges.drill;
  // `edges.drill` carries the "consumed" state: set when a drill fires, held
  // until the aim falls back below the hover threshold (and any bound input
  // releases), which re-arms it.
  edges.drill = drillRising || (edges.drill && (aimMagnitude > nav.hoverDeadzone || drillGesture));

  // Cycle: a directional axis input steps the selection one sector.
  // Rising-edge so a held twist steps once. Mark the edge consumed every
  // frame the cycle axis is over its threshold — even one made while
  // aiming laterally under `priority: 'lateral'`, where resolveTwistFrame
  // drops the step.
  const cycleStepRaw = cycleStepFromInputs(nav.cycle.inputs, axes);
  const cycleOver = cycleStepRaw !== 0;
  const cycleStep = cycleOver && !edges.cycle ? cycleStepRaw : 0;
  edges.cycle = cycleOver;

  const { hoverIndex, drillTarget } = resolveTwistFrame({
    sec,
    sticky,
    cycleStep,
    priority: nav.cycle.priority,
    count: current.length,
    // Only axis inputs can actually step; a button/magnitude-only cycle
    // binding mustn't gate the sticky-drill fallback.
    cycleEnabled: nav.cycle.inputs.some((input) => input.kind === 'axis'),
  });

  if (drillRising && drillTarget !== null) {
    const hovered = current[drillTarget];
    if (hovered?.branches) {
      return { outcome: { kind: 'drill', index: drillTarget }, edges };
    }
  }

  if (hoverIndex !== null) {
    return { outcome: { kind: 'hover', index: hoverIndex }, edges };
  }
  return { outcome: { kind: 'none' }, edges };
}
