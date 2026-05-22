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
