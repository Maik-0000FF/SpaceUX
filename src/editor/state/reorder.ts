// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Translate a drop-line insertion index into the `to` argument for
 * `moveNode`.
 *
 * The list draws a drop-line at `insertAt` — the gap (0..length) the
 * dragged item would land in. `moveNode` splices the item out of
 * `from` first, so when dragging downward (`from < insertAt`) the
 * surviving slots shift left by one and the insertion index has to be
 * decremented to compensate.
 *
 * Returns null when the move is a no-op: dropping into the item's own
 * slot (`insertAt === from`) or into the gap right after it
 * (`insertAt === from + 1`) both leave the order unchanged.
 */
export function moveTarget(from: number, insertAt: number): number | null {
  const to = from < insertAt ? insertAt - 1 : insertAt;
  return to === from ? null : to;
}

/**
 * Which sibling of the drag `ring` the row at `path` belongs to.
 *
 * The tree is flattened, so an expanded branch's descendants sit between
 * sibling rows. A reorder is confined to one ring, but the pointer can hover
 * a descendant of a sibling (not just the sibling row itself). This maps any
 * row inside the drag ring's subtree back to the owning sibling index, so the
 * descendant rows can drive the drop affordance too (no dead zone over a
 * subtree). Returns null when `path` is the ring itself or lives outside it.
 */
export function dropOwnerSibling(path: readonly number[], ring: readonly number[]): number | null {
  if (path.length <= ring.length) return null;
  for (let k = 0; k < ring.length; k++) if (path[k] !== ring[k]) return null;
  return path[ring.length]!;
}

/**
 * Insertion gap (0..ringLen) the drop-line should mark for a pointer over the
 * row at `path`, or null when the row isn't part of the drag `ring`.
 *
 * Hovering the sibling row itself splits at its midpoint (`below`): top half
 * inserts before it, bottom half after it. Hovering one of its descendants
 * always means "after this sibling" — the pointer has moved past the sibling
 * row into its subtree, so the item lands after the whole block.
 */
export function dropGapForRow(
  path: readonly number[],
  ring: readonly number[],
  below: boolean,
): number | null {
  const owner = dropOwnerSibling(path, ring);
  if (owner === null) return null;
  const isSiblingRow = path.length === ring.length + 1;
  if (!isSiblingRow) return owner + 1;
  return below ? owner + 1 : owner;
}
