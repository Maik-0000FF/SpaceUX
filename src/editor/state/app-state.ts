// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Editor UI state — not persisted, rebuilt every time the editor opens.
 *
 * Navigation is modelled as a *view path* plus a *selected index*:
 *  - `viewPath` is the chain of sector indices to the ring currently
 *    shown in the list/preview (`[]` = the top-level pie). Drilling into
 *    a submenu pushes its index; the breadcrumb pops back.
 *  - `selectedIndex` is the selected sector *within* that ring, or null.
 *
 * The full path to the selected sector is `[...viewPath, selectedIndex]`
 * (see `selectedPath` in selectors). Keeping the two apart means a ring
 * can be viewed with nothing selected, and selection indices stay simple.
 */
type AppState = {
  viewPath: number[];
  selectedIndex: number | null;
  /** Select the sector at `index` within the current ring. */
  selectSector: (index: number) => void;
  /** Clear the selection (keeps the current ring in view). */
  clearSelection: () => void;
  /** Descend into the submenu at `index` of the current ring. Clears the
   *  selection — the new ring starts with nothing selected. */
  drillInto: (index: number) => void;
  /** Breadcrumb navigation: truncate the view path to `depth` levels
   *  (0 = top-level). Clears the selection. */
  drillTo: (depth: number) => void;
};

export const useAppState = create<AppState>()(
  immer((set) => ({
    viewPath: [],
    selectedIndex: null,
    selectSector: (index) =>
      set((state) => {
        state.selectedIndex = index;
      }),
    clearSelection: () =>
      set((state) => {
        state.selectedIndex = null;
      }),
    drillInto: (index) =>
      set((state) => {
        state.viewPath.push(index);
        state.selectedIndex = null;
      }),
    drillTo: (depth) =>
      set((state) => {
        state.viewPath = state.viewPath.slice(0, depth);
        state.selectedIndex = null;
      }),
  })),
);
