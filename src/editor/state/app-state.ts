// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Editor UI state — not persisted, rebuilt every time the editor opens.
 *
 * `selectedPath` is the chain of sector indices from the root pie to
 * the currently selected sector (`[]` = nothing selected). PR Editor-2
 * only ever produces single-element paths (top-level selection); the
 * array shape is forward-compatible with the nested drill-in added in
 * PR Editor-5, so MenuList/MenuPreview/Properties don't have to change
 * their selection plumbing later.
 */
type AppState = {
  selectedPath: number[];
  /** Replace the current selection with `path`. */
  selectSector: (path: readonly number[]) => void;
  /** Clear the selection (back to "nothing selected"). */
  clearSelection: () => void;
};

export const useAppState = create<AppState>()(
  immer((set) => ({
    selectedPath: [],
    selectSector: (path) =>
      set((state) => {
        state.selectedPath = [...path];
      }),
    clearSelection: () =>
      set((state) => {
        state.selectedPath = [];
      }),
  })),
);
