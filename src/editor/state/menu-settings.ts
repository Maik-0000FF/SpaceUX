// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Draft } from 'immer';
import isEqual from 'lodash/isEqual';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { ConfigChangeCause, MenuConfigSnapshot } from '@/shared/ipc';
import {
  MAX_MENU_DEPTH,
  MAX_PIE_SCALE,
  MIN_PIE_SCALE,
  type MenuConfig,
  type MenuNavigation,
  type MenuNode,
  type TriggerMode,
} from '@/shared/menu';

import { eqPath, isPrefix, nodeHeight } from './move-targets';
import { defaultItemLabel, nextNodeId } from './node-keys';

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
  /** Why the conflicting change happened (external file edit vs device /
   *  profile switch), or null when there's no conflict. Drives the banner
   *  wording (#113, PR 3c-2). */
  conflictCause: ConfigChangeCause | null;
  saveError: string | null;
  /** Adopt a snapshot (initial load or external change with no unsaved
   *  edits). Clears dirty + conflict; origin = 'remote'. */
  setConfig: (snapshot: MenuConfigSnapshot) => void;
  /** Record a successful save: new baseline mtime, no longer dirty. */
  markSaved: (mtime: number) => void;
  /** Stash the on-disk snapshot that conflicts with unsaved edits, with
   *  the cause for the banner wording. */
  setConflict: (external: MenuConfigSnapshot, cause: ConfigChangeCause) => void;
  clearConflict: () => void;
  setSaveError: (saveError: string | null) => void;
  /** Mutate the node at `path` in place (immer). Tags the change
   *  `local` and dirty so it is written back. No-op on a stale path. */
  updateNodeAt: (path: readonly number[], updater: (node: Draft<MenuNode>) => void) => void;
  /** Append a new default leaf node to the ring at `ringPath`
   *  (`[]` = top level). No-op if the path is stale. */
  addNode: (ringPath: readonly number[]) => void;
  /** Remove the node at `index` within the ring at `ringPath`. No-op
   *  if it would empty the ring (the validator requires a non-empty
   *  menu / non-empty submenu) or the index/path is invalid. */
  deleteNode: (ringPath: readonly number[], index: number) => void;
  /** Reorder the ring at `ringPath` so the one at `from` ends up at
   *  `to`. No-op for invalid indices. */
  moveNode: (ringPath: readonly number[], from: number, to: number) => void;
  /** Move the node at `fromPath` to the end of the ring at `toRingPath`
   *  (a different ring). No-op for a cycle (target inside the moved
   *  subtree), an empty-root result, the same ring, a target too deep for
   *  the moved subtree (MAX_MENU_DEPTH), or invalid paths. If the source
   *  submenu is emptied by the move, its parent becomes a leaf. */
  moveNodeBetween: (fromPath: readonly number[], toRingPath: readonly number[]) => void;
  /** Set the puck button (zero-based) that opens the pie. */
  setTriggerButton: (button: number) => void;
  /** Set what the trigger button does once the pie is open (toggle/open). */
  setTriggerMode: (mode: TriggerMode) => void;
  /** Set the pie size multiplier (clamped to [MIN_PIE_SCALE, MAX_PIE_SCALE]). */
  setScale: (scale: number) => void;
  /** Set the root (centre) label; an empty/blank value clears it (the
   *  renderer falls back to ✕). */
  setRootLabel: (label: string) => void;
  /** Set the root's (centre's) commit action. `null` removes it (commit
   *  becomes a silent dismiss); a string sets (or creates) `action.id`,
   *  preserving any existing per-action config. An empty string is kept
   *  as `{ id: '' }` — distinct from `null` — so the editor's "action
   *  mode" stays mounted while the user retypes, mirroring the node
   *  editor. */
  setRootAction: (id: string | null) => void;
  /** Set (or clear, with `undefined`) the root action's per-action
   *  config. No-op when the root has no action. */
  setRootActionConfig: (config: Record<string, unknown> | undefined) => void;
  /** Replace the whole navigation block (gesture↔input bindings). The
   *  editor builds the new value immutably and hands it in. */
  setNavigation: (navigation: MenuNavigation) => void;
};

/** Return a copy of `config` with an editor-only stable id (see
 *  MenuNode.id) on every node under the root, recursively. Adopted
 *  configs arrive without ids; this gives the tree/list a reorder- and
 *  edit-stable identity. Pure — never mutates the input (the adopted
 *  snapshot may be a shared object, e.g. DEFAULT_MENU_CONFIG). The root
 *  node itself is not assigned an id (it isn't a list/tree row). */
function withNodeIds(config: MenuConfig): MenuConfig {
  const tag = (node: MenuNode): MenuNode => ({
    ...node,
    id: node.id ?? nextNodeId(),
    ...(node.branches ? { branches: node.branches.map(tag) } : {}),
  });
  return {
    ...config,
    root: { ...config.root, branches: (config.root.branches ?? []).map(tag) },
  };
}

/** Navigate to the branches array (ring) at `ringPath` within an immer
 *  draft, or null if any segment isn't a submenu. */
function draftRingAt(
  config: Draft<MenuConfig>,
  ringPath: readonly number[],
): Draft<MenuNode>[] | null {
  const top = config.root.branches;
  if (!top) return null;
  let ring: Draft<MenuNode>[] = top;
  for (const i of ringPath) {
    const next = ring[i]?.branches;
    if (!next) return null;
    ring = next;
  }
  return ring;
}

/** Navigate to the node at a full index path within an immer draft. */
function draftNodeAt(config: Draft<MenuConfig>, path: readonly number[]): Draft<MenuNode> | null {
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
      conflictCause: null,
      saveError: null,
      setConfig: (snapshot) =>
        set((state) => {
          state.config = withNodeIds(snapshot.config);
          state.mtime = snapshot.mtime;
          state.origin = 'remote';
          state.remoteRev += 1;
          state.dirty = false;
          state.conflict = null;
          state.conflictCause = null;
          state.saveError = null;
        }),
      markSaved: (mtime) =>
        set((state) => {
          state.mtime = mtime;
          state.dirty = false;
          state.saveError = null;
        }),
      setConflict: (external, cause) =>
        set((state) => {
          state.conflict = external;
          state.conflictCause = cause;
        }),
      clearConflict: () =>
        set((state) => {
          state.conflict = null;
          state.conflictCause = null;
        }),
      setSaveError: (saveError) =>
        set((state) => {
          state.saveError = saveError;
        }),
      updateNodeAt: (path, updater) =>
        set((state) => {
          if (!state.config || path.length === 0) return;
          const top = state.config.root.branches;
          if (!top) return;
          let ring: Draft<MenuNode>[] = top;
          for (let k = 0; k < path.length - 1; k++) {
            const branches = ring[path[k]!]?.branches;
            if (!branches) return; // stale path — nothing to update
            ring = branches;
          }
          const target = ring[path[path.length - 1]!];
          if (!target) return;
          updater(target);
          state.origin = 'local';
          state.dirty = true;
        }),
      addNode: (ringPath) =>
        set((state) => {
          if (!state.config) return;
          const ring = draftRingAt(state.config, ringPath);
          if (!ring) return;
          // 1-based tree path of the appended node → a unique, position-
          // showing default label (e.g. "Item 3.1").
          ring.push({ label: defaultItemLabel([...ringPath, ring.length]), id: nextNodeId() });
          state.origin = 'local';
          state.dirty = true;
        }),
      deleteNode: (ringPath, index) =>
        set((state) => {
          if (!state.config) return;
          const ring = draftRingAt(state.config, ringPath);
          if (!ring) return;
          if (index < 0 || index >= ring.length) return;
          // The top-level ring (ringPath []) can be emptied down to just the
          // centre; a deeper submenu ring keeps ≥1 item (an empty submenu is
          // meaningless — delete the submenu node in its parent instead).
          if (ringPath.length > 0 && ring.length <= 1) return;
          ring.splice(index, 1);
          state.origin = 'local';
          state.dirty = true;
        }),
      moveNode: (ringPath, from, to) =>
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
      moveNodeBetween: (fromPath, toRingPath) =>
        set((state) => {
          if (!state.config || fromPath.length === 0) return;
          if (isPrefix(fromPath, toRingPath)) return; // target inside the subtree (cycle)
          const fromRingPath = fromPath.slice(0, -1);
          if (eqPath(fromRingPath, toRingPath)) return; // same ring → use moveNode
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
          if (toRingPath.length + nodeHeight(fromRing[fromIndex] as MenuNode) > MAX_MENU_DEPTH) {
            return;
          }
          const [moved] = fromRing.splice(fromIndex, 1);
          toRing.push(moved!);
          // A submenu emptied by the move drops its level: parent → leaf.
          if (fromRing.length === 0 && fromRingPath.length > 0) {
            const parent = draftNodeAt(state.config, fromRingPath);
            if (parent) delete parent.branches;
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
      setTriggerMode: (mode) =>
        set((state) => {
          if (!state.config) return;
          state.config.triggerMode = mode;
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
      setRootLabel: (label) =>
        set((state) => {
          if (!state.config) return;
          // The root label is required by the type but may be empty; an
          // empty/blank value normalises to '' (renderer falls back to ✕).
          // Whitespace-only collapses to '' so the renderer shows the ✕
          // glyph; a real label is kept verbatim (no trimming).
          state.config.root.label = label.trim() === '' ? '' : label;
          state.origin = 'local';
          state.dirty = true;
        }),
      setRootAction: (id) =>
        set((state) => {
          if (!state.config) return;
          const root = state.config.root;
          if (id === null) delete root.action;
          else if (root.action) root.action.id = id;
          else root.action = { id };
          state.origin = 'local';
          state.dirty = true;
        }),
      setRootActionConfig: (config) =>
        set((state) => {
          const action = state.config?.root.action;
          if (!action) return; // config is meaningless without an action
          if (config === undefined) delete action.config;
          else action.config = config;
          state.origin = 'local';
          state.dirty = true;
        }),
      setNavigation: (navigation) =>
        set((state) => {
          if (!state.config) return;
          state.config.navigation = navigation;
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
