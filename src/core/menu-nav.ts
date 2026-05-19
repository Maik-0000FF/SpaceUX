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
import type { MenuConfig, MenuSector } from '../shared/menu';

export type DrillState = {
  navigation: number[];
  stickyChildIndex: number | null;
};

export const INITIAL_DRILL_STATE: DrillState = {
  navigation: [],
  stickyChildIndex: null,
};

export type DrillAction =
  /** MENU_OPEN: reset to a clean slate so a previous session's
   *  leftover doesn't carry over. */
  | { type: 'open' }
  /** Puck-to-sector resolution. `index = null` means the puck is in
   *  the deadzone or TZ-cancelled — no sector is sticky. */
  | { type: 'hover'; index: number | null }
  /** TZ rising edge: drill out one level. No-op at depth 0 so the
   *  caller doesn't have to gate the dispatch. */
  | { type: 'pop' }
  /** Commit on a branch sector: push that sector's index onto the
   *  navigation stack and reset selection in the new ring. */
  | { type: 'drill'; index: number };

/**
 * Pure state transition. Returns a new state when something changes,
 * the same reference when nothing changes — the latter lets React
 * skip the re-render under `useReducer`.
 */
export function drillReducer(state: DrillState, action: DrillAction): DrillState {
  switch (action.type) {
    case 'open':
      // Fast path: avoid producing a fresh object on every menu open
      // when the previous close already cleared the state.
      if (state.navigation.length === 0 && state.stickyChildIndex === null) return state;
      return INITIAL_DRILL_STATE;
    case 'hover':
      if (state.stickyChildIndex === action.index) return state;
      return { ...state, stickyChildIndex: action.index };
    case 'pop':
      if (state.navigation.length === 0) return state;
      return {
        navigation: state.navigation.slice(0, -1),
        stickyChildIndex: null,
      };
    case 'drill':
      return {
        navigation: [...state.navigation, action.index],
        stickyChildIndex: null,
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
export function currentSectors(config: MenuConfig, navigation: number[]): MenuSector[] {
  let level: MenuSector[] = config.sectors;
  for (const i of navigation) {
    const next = level[i]?.children;
    if (!next || next.length === 0) return config.sectors;
    level = next;
  }
  return level;
}
