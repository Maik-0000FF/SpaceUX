// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure menu-config edit transforms (#457): the editor calls them as core
 * methods over D-Bus, so the action-pick + node-kind logic lives ONCE. Each
 * transform takes the working config + a node path (index array from the root
 * ring, `[]` = the root/centre) and returns a NEW config (the input is never
 * mutated); the caller persists it via SetMenuConfig. Path resolution mirrors
 * the renderer: `path[k]` indexes `branches` at depth k.
 */

import {
  BUILTIN_ACTION,
  builtinAction,
  MAX_MENU_DEPTH,
  type MenuConfig,
  type MenuNode,
} from '../shared/menu.js';

/** Whether a label still looks auto-generated (never customised): empty, the
 *  legacy "New item", or the "Item <n.n…>" path scheme. Lets {@link
 *  cancelLabelFor} fill a name onto an untouched node without clobbering one the
 *  user set. */
export function isDefaultItemLabel(label: string): boolean {
  return label === '' || label === 'New item' || /^Item \d+(\.\d+)*$/.test(label);
}

/**
 * Default label for a freshly-added node: "Item " + the 1-based path of its ring
 * (just "Item " at the top level) + the next free number in that ring, one past
 * the highest "Item <prefix>N" already present so a new item never collides with
 * a sibling even after deletions reshuffle indices. User-renamed siblings are
 * ignored for numbering.
 */
export function uniqueItemLabel(
  ringPath: readonly number[],
  siblingLabels: readonly string[],
): string {
  const prefix = ringPath.map((i) => i + 1).join('.');
  const head = prefix ? `Item ${prefix}.` : 'Item ';
  let max = 0;
  for (const label of siblingLabels) {
    if (label.startsWith(head)) {
      const rest = label.slice(head.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
    }
  }
  return `${head}${max + 1}`;
}

/**
 * Suggested label when an action is picked onto a node, or `null` to leave it
 * as-is. Picking the built-in Cancel onto a node whose label is still
 * auto-generated fills in "Cancel" so the wedge is labelled without typing; a
 * custom label is never clobbered. The label stays editable afterwards.
 */
export function cancelLabelFor(actionId: string, currentLabel: string): string | null {
  const isCancel = actionId === builtinAction(BUILTIN_ACTION.CANCEL);
  return isCancel && isDefaultItemLabel(currentLabel) ? 'Cancel' : null;
}

/** The action kind that takes a filesystem target, or null. The two built-in
 *  path actions: `exec` runs the target as a command, `open-file` hands it to the
 *  desktop default app. Used to decide the Browse button + the path check. */
export function actionTargetKind(actionId: string): 'exec' | 'open-file' | null {
  if (actionId === builtinAction(BUILTIN_ACTION.EXEC)) return 'exec';
  if (actionId === builtinAction(BUILTIN_ACTION.OPEN_FILE)) return 'open-file';
  return null;
}

/** The action kind that can auto-resolve an icon, or null. A superset of
 *  {@link actionTargetKind}: the two path actions plus `key-combo`, whose icon
 *  comes from its keysym (#511) rather than a filesystem target. Drives the
 *  icon/label auto-fill, not the Browse button or path check (those stay
 *  file-only via `actionTargetKind`). */
export function actionFillKind(actionId: string): 'exec' | 'open-file' | 'key-combo' | null {
  if (actionId === builtinAction(BUILTIN_ACTION.KEY_COMBO)) return 'key-combo';
  return actionTargetKind(actionId);
}

/**
 * Quote a picked file path so the exec tokenizer keeps it as one token (it
 * honours "…"/'…' but has no backslash escapes). Only quotes when the path has
 * whitespace, and picks a quote char the path doesn't contain. Shared so the
 * Browse-for-file target is shell-safe identically everywhere.
 */
export function quoteCommandPath(p: string): string {
  if (!/\s/.test(p)) return p;
  if (!p.includes('"')) return `"${p}"`;
  if (!p.includes("'")) return `'${p}'`;
  return `"${p}"`;
}

/** The node at `path` in `config` (`[]` = root), or null if the path is stale. */
export function nodeAt(config: MenuConfig, path: readonly number[]): MenuNode | null {
  let node: MenuNode = config.root;
  for (const i of path) {
    const branches = node.branches;
    if (!branches || i < 0 || i >= branches.length) return null;
    node = branches[i]!;
  }
  return node;
}

/**
 * Apply a dropdown action pick to the node at `path` (a leaf or the centre):
 * set (or create) the action id, drop a config that belonged to a DIFFERENT
 * action's schema (a stale `command` left on an open-file action can't survive;
 * re-picking the same id keeps the config), drop an icon that was auto-resolved
 * for the old action's target (a manually chosen icon — no `iconAuto` — is
 * kept), and fill a still-default label with "Cancel" when Cancel is picked.
 * Returns a new config; the original is untouched.
 */
export function applyActionPick(
  config: MenuConfig,
  path: readonly number[],
  actionId: string,
): MenuConfig {
  const copy = structuredClone(config);
  const node = nodeAt(copy, path);
  if (!node) return config;
  if (node.action) {
    if (node.action.id !== actionId) {
      delete node.action.config;
      if (node.iconAuto) {
        delete node.icon;
        delete node.iconAuto;
      }
    }
    node.action.id = actionId;
  } else {
    node.action = { id: actionId };
  }
  const auto = cancelLabelFor(actionId, node.label ?? '');
  if (auto !== null) node.label = auto;
  return copy;
}

/**
 * Convert the node at `path` between a leaf (action) and a submenu (#457 Type
 * toggle). To 'submenu': seed one default child (so the ring isn't empty) and
 * drop the leaf-only `action`/`keepOpen`. To 'action': drop the `branches`
 * subtree (the caller confirms the discard first). A no-op if the node is
 * already that kind. Returns a new config; the original is untouched.
 */
export function setNodeKind(
  config: MenuConfig,
  path: readonly number[],
  kind: 'action' | 'submenu',
): MenuConfig {
  const copy = structuredClone(config);
  const node = nodeAt(copy, path);
  if (!node) return config;
  if (kind === 'submenu') {
    if (node.branches === undefined) {
      node.branches = [{ label: uniqueItemLabel(path, []) }];
      delete node.action;
      delete node.keepOpen;
    }
  } else {
    delete node.branches;
  }
  return copy;
}

/**
 * Add a child to the ring at `ringPath` (`[]` = the top-level ring), with a
 * unique default "Item …" label. Pure: returns the new config; the editor
 * selects the appended node (the ring's new last index).
 */
export function addNode(config: MenuConfig, ringPath: readonly number[]): MenuConfig {
  const copy = structuredClone(config);
  const parent = nodeAt(copy, ringPath);
  if (!parent) return config;
  const ring = parent.branches ?? (parent.branches = []);
  ring.push({
    label: uniqueItemLabel(
      ringPath,
      ring.map((n) => n.label),
    ),
  });
  return copy;
}

/**
 * Append a fully-specified leaf (label + optional icon + action) to the ring at
 * `ringPath` — the command palette adds a catalog command this way (#76 D2b).
 * Pure; returns the input by identity on a stale path.
 */
export function addItem(
  config: MenuConfig,
  ringPath: readonly number[],
  item: Pick<MenuNode, 'label' | 'icon' | 'action'>,
): MenuConfig {
  const copy = structuredClone(config);
  const parent = nodeAt(copy, ringPath);
  // No target, or the path names an action leaf: branches beside an action
  // would be invalid (the validator rejects it at write time); refuse by
  // identity like every other stale-path case.
  if (!parent || parent.action) return config;
  const ring = parent.branches ?? (parent.branches = []);
  ring.push({
    label: item.label,
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.action ? { action: item.action } : {}),
  });
  return copy;
}

/**
 * Delete the node at `ringPath`[`index`], or collapse its parent submenu when it
 * was the submenu's LAST child (an empty submenu is invalid, so the parent
 * becomes a plain leaf again). The root ring may empty down to the centre. Pure.
 */
export function deleteOrCollapseNode(
  config: MenuConfig,
  ringPath: readonly number[],
  index: number,
): MenuConfig {
  const copy = structuredClone(config);
  const parent = nodeAt(copy, ringPath);
  const ring = parent?.branches;
  if (!parent || !ring || index < 0 || index >= ring.length) return config;
  if (ringPath.length > 0 && ring.length <= 1) {
    delete parent.branches;
  } else {
    ring.splice(index, 1);
  }
  return copy;
}

/**
 * Where the selection lands after `deleteOrCollapseNode(ringPath, index)`: the
 * same slot clamped to the shrunk ring, or the parent itself when the ring is
 * now empty (a collapsed submenu / the emptied root). Shared so the delete and
 * the post-delete selection can't drift.
 */
export function nextSelectionAfterDelete(
  config: MenuConfig,
  ringPath: readonly number[],
  index: number,
): number[] {
  const parent = nodeAt(config, ringPath);
  const remaining = parent?.branches?.length ?? 0;
  if (remaining === 0) return [...ringPath];
  return [...ringPath, Math.min(index, remaining - 1)];
}

/** `prefix` is a (non-strict) prefix of `path`. */
export function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => v === path[i]);
}

/** Two index paths are equal. */
export function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Nesting height of a node: 0 for a leaf, 1 + deepest branch otherwise. */
export function nodeHeight(node: MenuNode): number {
  if (!node.branches || node.branches.length === 0) return 0;
  return 1 + Math.max(...node.branches.map(nodeHeight));
}

/**
 * Reorder the ring at `ringPath` so the node at `from` ends up at `to`
 * (#56/#457 MenuList part B). Pure; returns the input config unchanged on an
 * invalid index or a no-op (`from === to`), so callers can detect the no-op by
 * identity.
 */
export function moveNode(
  config: MenuConfig,
  ringPath: readonly number[],
  from: number,
  to: number,
): MenuConfig {
  const copy = structuredClone(config);
  const ring = nodeAt(copy, ringPath)?.branches;
  if (!ring) return config;
  if (from < 0 || from >= ring.length) return config;
  if (to < 0 || to >= ring.length || from === to) return config;
  const [moved] = ring.splice(from, 1);
  ring.splice(to, 0, moved!);
  return copy;
}

/**
 * Move the node at `fromPath` into the ring at `toRingPath` (a different ring),
 * inserting before `toIndex` (clamped; appended when omitted), the cross-ring
 * counterpart of {@link moveNode} (#55/#457 MenuList part B). Rejected (input
 * config returned, `movedPath` = `fromPath`) for a cycle (target inside the
 * moved subtree), the same ring, an emptied root, a target too deep for the
 * moved subtree (MAX_MENU_DEPTH), or a stale path. If the source submenu is
 * emptied by the move, its parent collapses to a leaf. `movedPath` is the moved
 * node's path in the returned config (the source splice can shift an ancestor
 * index of the target ring), so callers must re-select via this, not the inputs.
 */
export function moveNodeBetween(
  config: MenuConfig,
  fromPath: readonly number[],
  toRingPath: readonly number[],
  toIndex?: number,
): { config: MenuConfig; movedPath: number[] } {
  const rejected = { config, movedPath: [...fromPath] };
  if (fromPath.length === 0) return rejected;
  if (isPrefix(fromPath, toRingPath)) return rejected; // target inside the subtree (cycle)
  const fromRingPath = fromPath.slice(0, -1);
  if (eqPath(fromRingPath, toRingPath)) return rejected; // same ring → use moveNode
  const fromIndex = fromPath[fromPath.length - 1]!;

  const copy = structuredClone(config);
  // Resolve both ring references before mutating: splicing the source doesn't
  // invalidate the target array reference, even if it shifts indices in a
  // shared ancestor ring.
  const fromRing = nodeAt(copy, fromRingPath)?.branches;
  const toRing = nodeAt(copy, toRingPath)?.branches;
  if (!fromRing || !toRing) return rejected;
  if (fromIndex < 0 || fromIndex >= fromRing.length) return rejected;
  if (fromRingPath.length === 0 && fromRing.length <= 1) return rejected; // don't empty root
  // Don't let the moved subtree exceed the nesting cap at its new home.
  if (toRingPath.length + nodeHeight(fromRing[fromIndex]!) > MAX_MENU_DEPTH) return rejected;

  const [moved] = fromRing.splice(fromIndex, 1);
  const insertAt =
    toIndex === undefined ? toRing.length : Math.max(0, Math.min(toIndex, toRing.length));
  toRing.splice(insertAt, 0, moved!);
  // A submenu emptied by the move drops its level: parent → leaf.
  if (fromRing.length === 0 && fromRingPath.length > 0) {
    const parent = nodeAt(copy, fromRingPath);
    if (parent) delete parent.branches;
  }
  // The moved node's new path: the target ring path, with the segment that runs
  // through the source ring decremented when the splice shifted it (the target
  // ring sat after the removed node in a shared ancestor ring).
  const ringAfter = [...toRingPath];
  if (
    fromRingPath.length < ringAfter.length &&
    isPrefix(fromRingPath, ringAfter) &&
    ringAfter[fromRingPath.length]! > fromIndex
  ) {
    ringAfter[fromRingPath.length]! -= 1;
  }
  return { config: copy, movedPath: [...ringAfter, insertAt] };
}

/**
 * Every ring the node at `fromPath` may be moved into (#55/#457): the top level
 * and each submenu ring, minus its own ring (a no-op there; that's a reorder,
 * {@link moveNode}), minus its own subtree (a cycle), and minus any ring too
 * deep to hold the moved subtree without exceeding MAX_MENU_DEPTH. The editor
 * fetches this once at drag start and gates the drop-line with it, so no drop
 * affordance shows for a move the transform would reject.
 */
export function moveTargetRings(config: MenuConfig, fromPath: readonly number[]): number[][] {
  if (fromPath.length === 0) return [];
  const moved = nodeAt(config, fromPath);
  if (!moved) return [];
  const height = nodeHeight(moved);
  const fromRing = fromPath.slice(0, -1);

  const targets: number[][] = [];
  const visit = (nodes: readonly MenuNode[], ringPath: number[]): void => {
    const eligible =
      !eqPath(ringPath, fromRing) && // not the current ring (no-op)
      !isPrefix(fromPath, ringPath) && // not inside the moved subtree (cycle)
      ringPath.length + height <= MAX_MENU_DEPTH; // fits the depth cap
    if (eligible) targets.push([...ringPath]);
    nodes.forEach((node, i) => {
      if (node.branches && node.branches.length > 0) visit(node.branches, [...ringPath, i]);
    });
  };
  visit(config.root.branches ?? [], []);
  return targets;
}
