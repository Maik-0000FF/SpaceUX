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
 *   - `navigation` is a path of zero-based sector indices, deepest
 *     last. `[]` = top level, `[0]` = inside `sectors[0].children`,
 *     `[0, 2]` = inside `sectors[0].children[2].children`, and so on.
 *   - `stickyChildIndex` is the user's currently-selected sector
 *     *inside the current ring* (the ring resolved by `currentSectors`).
 *   - Commit and TZ-cancel are handled by the caller (they trigger
 *     side effects like firing an action or closing the menu);
 *     the reducer only mutates the navigation/selection state.
 */

// Relative import: src/core/ is shared between the renderer tsconfig
// (which has the `@/shared/*` path alias) and the main-process
// tsconfig.electron.json (which doesn't). Sticking to relative keeps
// this module buildable under both without duplicating the alias.
import { sectorCenterAngle } from './pie-geometry';
import type { MenuConfig, MenuSector, TwistCyclePriority } from '../shared/menu';

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
 * sector list of the current ring. Falls back to the top-level
 * sectors if any intermediate step doesn't resolve to a branch —
 * e.g. if the config was hot-reloaded mid-drill and the path is now
 * stale, the caller still sees a valid ring rather than `undefined`.
 *
 * Pure: no React, no DOM, no I/O. Tested in isolation.
 */
export function currentSectors(config: MenuConfig, navigation: readonly number[]): MenuSector[] {
  let level: MenuSector[] = config.sectors;
  for (const i of navigation) {
    const next = level[i]?.children;
    // The `!next` branch fires on real-world stale paths (hot-reload
    // turned a branch into a leaf). The `length === 0` branch is
    // belt-and-braces: the on-disk validator already rejects empty
    // `children` arrays, but in-memory MenuConfig literals (e.g. in
    // tests) can bypass that gate, and a 0-length ring would render
    // as a hole with no way out.
    if (!next || next.length === 0) return config.sectors;
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
export function cycleSectorIndex(current: number | null, step: -1 | 0 | 1, count: number): number {
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
  /** Whether `twistCycle` is enabled — gates the sticky drill fallback. */
  cycleEnabled: boolean;
}): TwistFrame {
  const { sec, sticky, cycleStep, priority, count, cycleEnabled } = opts;
  const cycleApplies = cycleStep !== 0 && (priority === 'twist' || sec === null);
  const hoverIndex = cycleApplies ? cycleSectorIndex(sticky, cycleStep, count) : sec;
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
  const parentRing = currentSectors(config, navigation.slice(0, -1));
  const drilledIntoIndex = navigation[navigation.length - 1]!;
  return sectorCenterAngle(drilledIntoIndex, parentRing.length);
}

/**
 * Children of the currently-hovered sector in the active ring, or
 * `undefined` if no sector is hovered or the hovered sector is a
 * leaf. The renderer reads this to decide whether (and what) to
 * draw as the concentric outer preview ring.
 *
 * Pure: no React, no DOM. Pinned in tests so the renderer-side
 * trigger for the outer ring is decoupled from React-rendering
 * test infrastructure.
 */
export function previewChildren(
  config: MenuConfig,
  drillState: DrillState,
): MenuSector[] | undefined {
  if (drillState.stickyChildIndex === null) return undefined;
  const ring = currentSectors(config, drillState.navigation);
  return ring[drillState.stickyChildIndex]?.children;
}
