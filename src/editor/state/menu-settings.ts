// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Draft } from 'immer';
import isEqual from 'lodash/isEqual';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { MenuConfigSnapshot } from '@/shared/ipc';
import type { MenuConfig, MenuSector } from '@/shared/menu';

/**
 * The editor's working copy of the menu config plus the bookkeeping the
 * write-back loop and conflict handling need.
 *
 * `origin` tags who caused the last config change so the write-back
 * subscription (in App) can tell a user edit (`local` → save) apart
 * from a load / external-change adoption (`remote` → don't echo back).
 *
 * `dirty` is the conflict signal: it's set on every local edit and
 * cleared on a successful save (or when a remote snapshot is adopted).
 * An external change that arrives while `dirty` is true is a real
 * conflict — App stashes the on-disk snapshot in `conflict` and shows
 * the banner instead of silently overwriting the unsaved edits. When
 * `dirty` is false the editor is in sync, so an external change is
 * adopted directly.
 */
type MenuSettingsState = {
  config: MenuConfig | null;
  mtime: number | null;
  origin: 'remote' | 'local';
  /** Bumped each time a remote snapshot is adopted (load / external
   *  change / Reload), never on a local edit. Lets components that hold
   *  their own derived text state (the Config JSON editor) remount on an
   *  external adoption without remounting mid-typing. */
  remoteRev: number;
  /** Unsaved local edits exist. */
  dirty: boolean;
  /** On-disk snapshot that clashed with unsaved edits, or null. Non-null
   *  raises the banner: Reload adopts it, Overwrite writes over it. */
  conflict: MenuConfigSnapshot | null;
  saveError: string | null;
  /** Adopt a snapshot (initial load or external change with no unsaved
   *  edits). Clears dirty + conflict; origin = 'remote'. */
  setConfig: (snapshot: MenuConfigSnapshot) => void;
  /** Record a successful save: new baseline mtime, no longer dirty. */
  markSaved: (mtime: number) => void;
  /** Stash the on-disk snapshot that conflicts with unsaved edits. */
  setConflict: (external: MenuConfigSnapshot) => void;
  clearConflict: () => void;
  setSaveError: (saveError: string | null) => void;
  /** Mutate the sector at `path` in place (immer). Tags the change
   *  `local` and dirty so it is written back. No-op on a stale path. */
  updateSectorAt: (path: readonly number[], updater: (sector: Draft<MenuSector>) => void) => void;
  /** Append a new default leaf sector to the ring at `ringPath`
   *  (`[]` = top level). No-op if the path is stale. */
  addSector: (ringPath: readonly number[]) => void;
  /** Remove the sector at `index` within the ring at `ringPath`. No-op
   *  if it would empty the ring (the validator requires a non-empty
   *  menu / non-empty submenu) or the index/path is invalid. */
  deleteSector: (ringPath: readonly number[], index: number) => void;
  /** Reorder the ring at `ringPath` so the one at `from` ends up at
   *  `to`. No-op for invalid indices. */
  moveSector: (ringPath: readonly number[], from: number, to: number) => void;
};

/** Navigate to the children array (ring) at `ringPath` within an immer
 *  draft, or null if any segment isn't a branch. */
function draftRingAt(
  config: Draft<MenuConfig>,
  ringPath: readonly number[],
): Draft<MenuSector>[] | null {
  let ring: Draft<MenuSector>[] = config.sectors;
  for (const i of ringPath) {
    const next = ring[i]?.children;
    if (!next) return null;
    ring = next;
  }
  return ring;
}

export const useMenuSettings = create<MenuSettingsState>()(
  temporal(
    immer((set) => ({
      config: null,
      mtime: null,
      origin: 'remote',
      remoteRev: 0,
      dirty: false,
      conflict: null,
      saveError: null,
      setConfig: (snapshot) =>
        set((state) => {
          state.config = snapshot.config;
          state.mtime = snapshot.mtime;
          state.origin = 'remote';
          state.remoteRev += 1;
          state.dirty = false;
          state.conflict = null;
          state.saveError = null;
        }),
      markSaved: (mtime) =>
        set((state) => {
          state.mtime = mtime;
          state.dirty = false;
          state.saveError = null;
        }),
      setConflict: (external) =>
        set((state) => {
          state.conflict = external;
        }),
      clearConflict: () =>
        set((state) => {
          state.conflict = null;
        }),
      setSaveError: (saveError) =>
        set((state) => {
          state.saveError = saveError;
        }),
      updateSectorAt: (path, updater) =>
        set((state) => {
          if (!state.config || path.length === 0) return;
          let ring: Draft<MenuSector>[] = state.config.sectors;
          for (let k = 0; k < path.length - 1; k++) {
            const children = ring[path[k]!]?.children;
            if (!children) return; // stale path — nothing to update
            ring = children;
          }
          const target = ring[path[path.length - 1]!];
          if (!target) return;
          updater(target);
          state.origin = 'local';
          state.dirty = true;
        }),
      addSector: (ringPath) =>
        set((state) => {
          if (!state.config) return;
          const ring = draftRingAt(state.config, ringPath);
          if (!ring) return;
          ring.push({ label: 'New item' });
          state.origin = 'local';
          state.dirty = true;
        }),
      deleteSector: (ringPath, index) =>
        set((state) => {
          if (!state.config) return;
          const ring = draftRingAt(state.config, ringPath);
          if (!ring || ring.length <= 1) return; // keep the ring non-empty
          if (index < 0 || index >= ring.length) return;
          ring.splice(index, 1);
          state.origin = 'local';
          state.dirty = true;
        }),
      moveSector: (ringPath, from, to) =>
        set((state) => {
          if (!state.config) return;
          const ring = draftRingAt(state.config, ringPath);
          if (!ring) return;
          if (from < 0 || from >= ring.length) return;
          if (to < 0 || to >= ring.length || from === to) return;
          const [moved] = ring.splice(from, 1);
          ring.splice(to, 0, moved!);
          state.origin = 'local';
          state.dirty = true;
        }),
    })),
    {
      // Only the document (config) is undoable; the UI bookkeeping
      // (dirty, conflict, mtime, origin, remoteRev, saveError) is not.
      partialize: (state) => ({ config: state.config }),
      // Deep equality so a no-op edit (same values) adds no history entry.
      equality: (a, b) => isEqual(a, b),
      // Cap history so a long editing session can't grow unbounded.
      limit: 100,
    },
  ),
);
