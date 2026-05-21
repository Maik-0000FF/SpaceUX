// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Draft } from 'immer';
import isEqual from 'lodash/isEqual';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { MenuConfigSnapshot } from '@/shared/ipc';
import {
  MAX_MENU_DEPTH,
  MAX_PIE_SCALE,
  MIN_PIE_SCALE,
  type AxisActivation,
  type MenuCenter,
  type MenuConfig,
  type MenuSector,
} from '@/shared/menu';

import { eqPath, isPrefix, sectorHeight } from './move-targets';
import { nextSectorId } from './sector-keys';

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
  /** Move the sector at `fromPath` to the end of the ring at `toRingPath`
   *  (a different ring). No-op for a cycle (target inside the moved
   *  subtree), an empty-root result, the same ring, a target too deep for
   *  the moved subtree (MAX_MENU_DEPTH), or invalid paths. If the source
   *  submenu is emptied by the move, its parent becomes a leaf. */
  moveSectorBetween: (fromPath: readonly number[], toRingPath: readonly number[]) => void;
  /** Set the puck button (zero-based) that opens the pie. */
  setTriggerButton: (button: number) => void;
  /** Set the pie size multiplier (clamped to [MIN_PIE_SCALE, MAX_PIE_SCALE]). */
  setScale: (scale: number) => void;
  /** Set the center field's label; an empty/blank value clears it (the
   *  renderer falls back to ✕). Prunes an emptied centerField. */
  setCenterLabel: (label: string) => void;
  /** Set the center field's binding. `null` removes it (commit becomes
   *  a silent dismiss) and prunes an emptied centerField; a string sets
   *  (or creates) `binding.action`, preserving any existing per-action
   *  config. An empty string is kept as `{ action: '' }` — distinct
   *  from `null` — so the editor's "action mode" stays mounted while
   *  the user retypes, mirroring the sector editor. */
  setCenterBinding: (action: string | null) => void;
  /** Set (or clear, with `undefined`) the center binding's per-action
   *  config. No-op when the center has no binding. */
  setCenterActionConfig: (config: Record<string, unknown> | undefined) => void;
  /** Set the center field's axis activation, or clear it with `null`
   *  (commit reverts to trigger-button only). Prunes an emptied
   *  centerField. */
  setCenterActivation: (activation: AxisActivation | null) => void;
};

/** Return a copy of `config` with an editor-only stable id (see
 *  MenuSector.id) on every sector, recursively. Adopted configs arrive
 *  without ids; this gives the tree/list a reorder- and edit-stable
 *  identity. Pure — never mutates the input (the adopted snapshot may be
 *  a shared object, e.g. DEFAULT_MENU_CONFIG). */
function withSectorIds(config: MenuConfig): MenuConfig {
  const tag = (sector: MenuSector): MenuSector => ({
    ...sector,
    id: sector.id ?? nextSectorId(),
    ...(sector.children ? { children: sector.children.map(tag) } : {}),
  });
  return { ...config, sectors: config.sectors.map(tag) };
}

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

/** Ensure a `centerField` object exists on the draft and return it. */
function ensureCenter(config: Draft<MenuConfig>): Draft<MenuCenter> {
  if (!config.centerField) config.centerField = {};
  return config.centerField;
}

/** Drop an all-empty `centerField` (no label/icon/binding/activation)
 *  from the draft, so the working copy matches what the validator
 *  persists — it normalises `{}` to "no center field". Keeps undo
 *  history and the on-disk diff free of meaningless empty objects. */
function pruneCenter(config: Draft<MenuConfig>): void {
  const c = config.centerField;
  if (
    c &&
    c.label === undefined &&
    c.icon === undefined &&
    c.binding === undefined &&
    c.activation === undefined
  ) {
    delete config.centerField;
  }
}

/** Navigate to the sector at a full index path within an immer draft. */
function draftSectorAt(
  config: Draft<MenuConfig>,
  path: readonly number[],
): Draft<MenuSector> | null {
  if (path.length === 0) return null;
  const ring = draftRingAt(config, path.slice(0, -1));
  return ring?.[path[path.length - 1]!] ?? null;
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
          state.config = withSectorIds(snapshot.config);
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
          ring.push({ label: 'New item', id: nextSectorId() });
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
      moveSectorBetween: (fromPath, toRingPath) =>
        set((state) => {
          if (!state.config || fromPath.length === 0) return;
          if (isPrefix(fromPath, toRingPath)) return; // target inside the subtree (cycle)
          const fromRingPath = fromPath.slice(0, -1);
          if (eqPath(fromRingPath, toRingPath)) return; // same ring → use moveSector
          const fromIndex = fromPath[fromPath.length - 1]!;
          // Resolve both ring references before mutating: splicing the source
          // doesn't invalidate the target array reference, even if it shifts
          // indices in a shared ancestor ring.
          const fromRing = draftRingAt(state.config, fromRingPath);
          const toRing = draftRingAt(state.config, toRingPath);
          if (!fromRing || !toRing) return;
          if (fromIndex < 0 || fromIndex >= fromRing.length) return;
          if (fromRingPath.length === 0 && fromRing.length <= 1) return; // don't empty root
          // Don't let the moved subtree exceed the nesting cap at its new home.
          if (
            toRingPath.length + sectorHeight(fromRing[fromIndex] as MenuSector) >
            MAX_MENU_DEPTH
          ) {
            return;
          }
          const [moved] = fromRing.splice(fromIndex, 1);
          toRing.push(moved!);
          // A submenu emptied by the move drops its level: parent → leaf.
          if (fromRing.length === 0 && fromRingPath.length > 0) {
            const parent = draftSectorAt(state.config, fromRingPath);
            if (parent) delete parent.children;
          }
          state.origin = 'local';
          state.dirty = true;
        }),
      setTriggerButton: (button) =>
        set((state) => {
          if (!state.config) return;
          state.config.triggerButton = button;
          state.origin = 'local';
          state.dirty = true;
        }),
      setScale: (scale) =>
        set((state) => {
          if (!state.config) return;
          state.config.scale = Math.min(MAX_PIE_SCALE, Math.max(MIN_PIE_SCALE, scale));
          state.origin = 'local';
          state.dirty = true;
        }),
      setCenterLabel: (label) =>
        set((state) => {
          if (!state.config) return;
          const center = ensureCenter(state.config);
          if (label.trim() === '') delete center.label;
          else center.label = label;
          pruneCenter(state.config);
          state.origin = 'local';
          state.dirty = true;
        }),
      setCenterBinding: (action) =>
        set((state) => {
          if (!state.config) return;
          const center = ensureCenter(state.config);
          if (action === null) delete center.binding;
          else if (center.binding) center.binding.action = action;
          else center.binding = { action };
          pruneCenter(state.config);
          state.origin = 'local';
          state.dirty = true;
        }),
      setCenterActionConfig: (config) =>
        set((state) => {
          const binding = state.config?.centerField?.binding;
          if (!binding) return; // config is meaningless without a binding
          if (config === undefined) delete binding.config;
          else binding.config = config;
          state.origin = 'local';
          state.dirty = true;
        }),
      setCenterActivation: (activation) =>
        set((state) => {
          if (!state.config) return;
          const center = ensureCenter(state.config);
          if (activation === null) delete center.activation;
          else center.activation = activation;
          pruneCenter(state.config);
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
