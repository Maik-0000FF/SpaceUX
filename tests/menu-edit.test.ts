// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  actionTargetKind,
  addNode,
  applyActionPick,
  deleteOrCollapseNode,
  isDefaultItemLabel,
  moveNode,
  moveNodeBetween,
  moveTargetRings,
  nextSelectionAfterDelete,
  nodeHeight,
  quoteCommandPath,
  setNodeKind,
  uniqueItemLabel,
} from '../src/core/menu-edit';
import {
  BUILTIN_ACTION,
  DEFAULT_MENU_CONFIG,
  MAX_MENU_DEPTH,
  builtinAction,
} from '../src/shared/menu';
import type { MenuConfig, MenuNode } from '../src/shared/menu';

const cfg = (branches: MenuNode[], rootLabel = 'Centre'): MenuConfig => ({
  ...DEFAULT_MENU_CONFIG,
  root: { label: rootLabel, branches },
});
const CANCEL = builtinAction(BUILTIN_ACTION.CANCEL);
const EXEC = builtinAction(BUILTIN_ACTION.EXEC);
// First top-level branch of a config (the only one the tests build).
const b0 = (c: MenuConfig): MenuNode => c.root.branches![0]!;

describe('applyActionPick (#457 shared edit)', () => {
  it('sets the id on a node with no action, leaving the input untouched', () => {
    const before = cfg([{ label: 'A' }]);
    const after = applyActionPick(before, [0], EXEC);
    expect(b0(after).action).toEqual({ id: EXEC });
    expect(b0(before).action).toBeUndefined(); // pure
  });

  it('drops a stale config + auto-icon when the action id changes', () => {
    const before = cfg([
      { label: 'A', action: { id: EXEC, config: { command: 'x' } }, icon: 'i', iconAuto: true },
    ]);
    const node = b0(applyActionPick(before, [0], 'plugin/other'));
    expect(node.action).toEqual({ id: 'plugin/other' });
    expect(node.icon).toBeUndefined();
    expect(node.iconAuto).toBeUndefined();
  });

  it('keeps the config (and a manual icon) when the same id is re-picked', () => {
    const before = cfg([
      { label: 'A', action: { id: EXEC, config: { command: 'x' } }, icon: 'manual' },
    ]);
    const node = b0(applyActionPick(before, [0], EXEC));
    expect(node.action).toEqual({ id: EXEC, config: { command: 'x' } });
    expect(node.icon).toBe('manual');
  });

  it('fills a default label with "Cancel" but never clobbers a custom one', () => {
    expect(b0(applyActionPick(cfg([{ label: '' }]), [0], CANCEL)).label).toBe('Cancel');
    expect(b0(applyActionPick(cfg([{ label: 'Quit' }]), [0], CANCEL)).label).toBe('Quit');
  });

  it('edits the centre (root) at the empty path', () => {
    const after = applyActionPick(cfg([{ label: 'A' }]), [], CANCEL);
    expect(after.root.action).toEqual({ id: CANCEL });
  });
});

describe('setNodeKind (#457 Type toggle)', () => {
  it('action -> submenu seeds a child and drops the leaf-only fields', () => {
    const before = cfg([{ label: 'A', action: { id: EXEC }, keepOpen: true }]);
    const node = b0(setNodeKind(before, [0], 'submenu'));
    expect(node.action).toBeUndefined();
    expect(node.keepOpen).toBeUndefined();
    expect(node.branches).toHaveLength(1);
    expect(node.branches![0]!.label).toBe('Item 1.1');
  });

  it('submenu -> action drops the whole subtree', () => {
    const before = cfg([{ label: 'A', branches: [{ label: 'A1' }, { label: 'A2' }] }]);
    expect(b0(setNodeKind(before, [0], 'action')).branches).toBeUndefined();
  });

  it('is a no-op (and pure) when the node is already that kind', () => {
    const before = cfg([{ label: 'A', branches: [{ label: 'A1' }] }]);
    const after = setNodeKind(before, [0], 'submenu');
    expect(b0(after).branches).toHaveLength(1);
    expect(b0(before).branches).toHaveLength(1);
  });
});

describe('actionTargetKind (#457 Browse / path check)', () => {
  it('maps the two built-in path actions, and null otherwise', () => {
    expect(actionTargetKind(EXEC)).toBe('exec');
    expect(actionTargetKind(builtinAction(BUILTIN_ACTION.OPEN_FILE))).toBe('open-file');
    expect(actionTargetKind(CANCEL)).toBeNull();
    expect(actionTargetKind('plugin/whatever')).toBeNull();
  });
});

describe('quoteCommandPath (#457 exec target)', () => {
  it('quotes only a path with whitespace, picking a quote the path lacks', () => {
    expect(quoteCommandPath('/usr/bin/foo')).toBe('/usr/bin/foo');
    expect(quoteCommandPath('/a b/foo')).toBe('"/a b/foo"');
    expect(quoteCommandPath('/a "b/foo')).toBe("'/a \"b/foo'");
  });
});

describe('addNode (#457 tree edit)', () => {
  it('appends a child to the top-level ring with a unique label, purely', () => {
    const before = cfg([{ label: 'A' }]);
    const after = addNode(before, []);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['A', 'Item 1']);
    expect(before.root.branches!.length).toBe(1);
  });
  it('appends into a submenu at ringPath with the nested label scheme', () => {
    const after = addNode(cfg([{ label: 'A', branches: [{ label: 'A1' }] }]), [0]);
    expect(b0(after).branches!.map((n) => n.label)).toEqual(['A1', 'Item 1.1']);
  });
});

describe('deleteOrCollapseNode + nextSelectionAfterDelete (#457 tree edit)', () => {
  it('removes a sibling from a multi-item ring, purely', () => {
    const before = cfg([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    const after = deleteOrCollapseNode(before, [], 1);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['A', 'C']);
    expect(before.root.branches!.length).toBe(3);
  });
  it('collapses a submenu to a leaf when its last child is deleted', () => {
    const after = deleteOrCollapseNode(cfg([{ label: 'A', branches: [{ label: 'A1' }] }]), [0], 0);
    expect(b0(after).branches).toBeUndefined();
    expect(b0(after).label).toBe('A');
  });
  it('lets the root ring empty down to the centre', () => {
    expect(deleteOrCollapseNode(cfg([{ label: 'A' }]), [], 0).root.branches).toEqual([]);
  });
  it('selects the clamped slot, or the parent when the ring is now empty', () => {
    const two = deleteOrCollapseNode(cfg([{ label: 'A' }, { label: 'B' }]), [], 1);
    expect(nextSelectionAfterDelete(two, [], 1)).toEqual([0]);
    const collapsed = deleteOrCollapseNode(
      cfg([{ label: 'A', branches: [{ label: 'A1' }] }]),
      [0],
      0,
    );
    expect(nextSelectionAfterDelete(collapsed, [0], 0)).toEqual([0]);
  });
});

describe('moveNode (#457 MenuList part B, within-ring reorder)', () => {
  it('reorders the ring, purely', () => {
    const before = cfg([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    const after = moveNode(before, [], 0, 2);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['B', 'C', 'A']);
    expect(before.root.branches!.map((n) => n.label)).toEqual(['A', 'B', 'C']);
  });

  it('reorders inside a submenu ring', () => {
    const before = cfg([{ label: 'A', branches: [{ label: 'A1' }, { label: 'A2' }] }]);
    const after = moveNode(before, [0], 1, 0);
    expect(b0(after).branches!.map((n) => n.label)).toEqual(['A2', 'A1']);
  });

  it('returns the input by identity on a no-op or invalid index', () => {
    const before = cfg([{ label: 'A' }, { label: 'B' }]);
    expect(moveNode(before, [], 1, 1)).toBe(before); // no-op
    expect(moveNode(before, [], 2, 0)).toBe(before); // from out of range
    expect(moveNode(before, [], 0, 2)).toBe(before); // to out of range
    expect(moveNode(before, [3], 0, 1)).toBe(before); // stale ring path
  });
});

describe('moveNodeBetween (#457 MenuList part B, cross-ring move)', () => {
  // [A (leaf), B (leaf), C (branch -> [C1, C2])]
  const tree = (): MenuConfig =>
    cfg([
      { label: 'A' },
      { label: 'B' },
      { label: 'C', branches: [{ label: 'C1' }, { label: 'C2' }] },
    ]);

  it('moves a node into another ring at the insertion index, purely', () => {
    const before = tree();
    const { config: after, movedPath } = moveNodeBetween(before, [1], [2], 1);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['A', 'C']);
    expect(after.root.branches![1]!.branches!.map((n) => n.label)).toEqual(['C1', 'B', 'C2']);
    // C shifted 2 -> 1 in the root ring once B was spliced out.
    expect(movedPath).toEqual([1, 1]);
    expect(before.root.branches!.length).toBe(3);
  });

  it('does not shift the target ring when it sits before the source slot', () => {
    // Move C2 ([2, 1]) up to the top level before A.
    const { config: after, movedPath } = moveNodeBetween(tree(), [2, 1], [], 0);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['C2', 'A', 'B', 'C']);
    expect(movedPath).toEqual([0]);
  });

  it('clamps the insertion index and appends when omitted', () => {
    expect(moveNodeBetween(tree(), [0], [2], 99).movedPath).toEqual([1, 2]);
    expect(moveNodeBetween(tree(), [0], [2]).movedPath).toEqual([1, 2]);
  });

  it('collapses a source submenu emptied by the move', () => {
    const before = cfg([{ label: 'A', branches: [{ label: 'A1' }] }, { label: 'B' }]);
    const { config: after, movedPath } = moveNodeBetween(before, [0, 0], [], 2);
    expect(after.root.branches!.map((n) => n.label)).toEqual(['A', 'B', 'A1']);
    expect(b0(after).branches).toBeUndefined(); // A is a leaf again
    expect(movedPath).toEqual([2]);
  });

  it('rejects a cycle, the same ring, and a stale path (input identity)', () => {
    const before = tree();
    expect(moveNodeBetween(before, [2], [2, 0], 0).config).toBe(before); // own subtree
    expect(moveNodeBetween(before, [0], [], 2).config).toBe(before); // same ring
    expect(moveNodeBetween(before, [5], [2], 0).config).toBe(before); // stale from
    expect(moveNodeBetween(before, [0], [9, 9], 0).config).toBe(before); // stale target
    expect(moveNodeBetween(before, [2], [2, 0], 0).movedPath).toEqual([2]); // selection stays
  });
});

describe('moveTargetRings (#457 MenuList part B, drag validation)', () => {
  // A (leaf), B (branch) -> [B0 (leaf), B1 (branch) -> [B1a (leaf)]]
  const tree = (): MenuConfig =>
    cfg([
      { label: 'A' },
      {
        label: 'B',
        branches: [{ label: 'B0' }, { label: 'B1', branches: [{ label: 'B1a' }] }],
      },
    ]);

  it('offers other rings for a leaf, excluding its own ring', () => {
    expect(moveTargetRings(tree(), [0])).toEqual([[1], [1, 1]]);
  });

  it('excludes the current ring and the moved subtree (no cycle)', () => {
    expect(moveTargetRings(tree(), [1])).toEqual([]);
  });

  it('lets a nested leaf move up to the top level or a sibling submenu', () => {
    expect(moveTargetRings(tree(), [1, 0])).toEqual([[], [1, 1]]);
  });
});

describe('move guards: depth cap + the root never empties', () => {
  // A branch chain of exactly `height` levels below the returned node.
  const chain = (height: number): MenuNode =>
    height === 0 ? { label: `L` } : { label: `D${height}`, branches: [chain(height - 1)] };
  // Top node [0] carries the deepest legal subtree (its lowest ring sits at
  // ring-path length MAX_MENU_DEPTH), next to a height-1 branch and a leaf.
  const deep = (): MenuConfig =>
    cfg([chain(MAX_MENU_DEPTH), { label: 'M', branches: [{ label: 'M1' }] }, { label: 'F' }]);
  // The deepest ring's path: [0, 0, ..., 0] of length MAX_MENU_DEPTH.
  const deepestRing = Array.from({ length: MAX_MENU_DEPTH }, () => 0);

  it('moveNodeBetween rejects a target too deep for the moved subtree', () => {
    const before = deep();
    // M (height 1) into the deepest ring: MAX_MENU_DEPTH + 1 over the cap.
    const res = moveNodeBetween(before, [1], deepestRing, 0);
    expect(res.config).toBe(before);
    expect(res.movedPath).toEqual([1]);
  });

  it('moveNodeBetween accepts a leaf exactly at the cap', () => {
    // F (height 0) into the deepest ring: MAX_MENU_DEPTH + 0 = the cap.
    const res = moveNodeBetween(deep(), [2], deepestRing, 0);
    expect(res.movedPath).toEqual([...deepestRing, 0]);
  });

  it('moveTargetRings excludes over-deep rings per the moved height', () => {
    const c = deep();
    const forBranch = moveTargetRings(c, [1]); // M, height 1
    const forLeaf = moveTargetRings(c, [2]); // F, height 0
    expect(forBranch).not.toContainEqual(deepestRing);
    expect(forLeaf).toContainEqual(deepestRing);
  });

  it('never lets the last top-level node leave the root ring', () => {
    // With one top-level branch, every other ring lies inside its own subtree,
    // so the cycle guard already rejects the move and the root cannot empty
    // (the explicit root guard in moveNodeBetween stays as defence in depth).
    const single = cfg([{ label: 'A', branches: [{ label: 'A1' }] }]);
    const res = moveNodeBetween(single, [0], [0], 0);
    expect(res.config).toBe(single);
    expect(res.movedPath).toEqual([0]);
    expect(moveTargetRings(single, [0])).toEqual([]);
  });
});

describe('nodeHeight', () => {
  it('is 0 for a leaf and counts the deepest descendant otherwise', () => {
    const c = cfg([
      { label: 'A', action: { id: EXEC } },
      {
        label: 'B',
        branches: [
          { label: 'B0', action: { id: EXEC } },
          { label: 'B1', branches: [{ label: 'B1a', action: { id: EXEC } }] },
        ],
      },
    ]);
    expect(nodeHeight(c.root.branches![0]!)).toBe(0); // A
    expect(nodeHeight(c.root.branches![1]!)).toBe(2); // B -> B1 -> B1a
  });
});

describe('uniqueItemLabel', () => {
  it('uses the next free number for the ring (one past the highest)', () => {
    expect(uniqueItemLabel([], [])).toBe('Item 1');
    expect(uniqueItemLabel([], ['Item 1'])).toBe('Item 2');
    // Gaps don't matter: it goes past the highest, never reusing a number a
    // sibling still holds (the post-deletion collision the path index had).
    expect(uniqueItemLabel([], ['Item 1', 'Item 3'])).toBe('Item 4');
  });

  it('prefixes with the 1-based ring path for deeper rings', () => {
    expect(uniqueItemLabel([2], [])).toBe('Item 3.1');
    expect(uniqueItemLabel([0], ['Item 1.1', 'Item 1.2'])).toBe('Item 1.3');
  });

  it('ignores user-renamed siblings when numbering', () => {
    expect(uniqueItemLabel([], ['Volume', 'Files'])).toBe('Item 1');
    expect(uniqueItemLabel([0], ['C0'])).toBe('Item 1.1');
  });
});

describe('isDefaultItemLabel', () => {
  it('treats empty, "New item", and the path scheme as still-default', () => {
    expect(isDefaultItemLabel('')).toBe(true);
    expect(isDefaultItemLabel('New item')).toBe(true);
    expect(isDefaultItemLabel('Item 1')).toBe(true);
    expect(isDefaultItemLabel('Item 3.1.2')).toBe(true);
  });

  it('treats a customised label as not default', () => {
    expect(isDefaultItemLabel('Volume')).toBe(false);
    expect(isDefaultItemLabel('Item')).toBe(false); // no number
    expect(isDefaultItemLabel('Item 1.')).toBe(false); // trailing dot
    expect(isDefaultItemLabel('My Item 1')).toBe(false);
  });
});
