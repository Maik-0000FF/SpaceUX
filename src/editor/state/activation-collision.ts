// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detect when a per-node activation input shadows a global navigation
 * gesture (#130 R2). The runtime resolves activation ahead of the global
 * gestures, so a collision means the per-item input *wins* for that item
 * — useful, but worth flagging in the editor so the user knows they've
 * overridden the global behaviour there (e.g. binding TZ− to activate
 * shadows the global TZ back).
 *
 * Pure and React-free so the overlap rules are unit-testable.
 */

import type { GestureBinding, InputBinding, MenuNavigation } from '@/shared/menu';

/** Global gestures checked for collisions, with display labels. All four
 *  matter: a hovered item's activation can shadow back, the centre
 *  commit, a drill, or a cycle step on the same input. */
const GLOBAL_GESTURE_LABELS = {
  drillIn: 'Drill in',
  back: 'Back',
  cycle: 'Cycle',
  commitCenter: 'Commit center',
} as const;

type GlobalGestureKey = keyof typeof GLOBAL_GESTURE_LABELS;

/** Whether two inputs fire off the same physical trigger. Axes overlap
 *  when they share an axis and a direction (`both` overlaps either half).
 *  Different kinds never collide. */
function inputsCollide(a: InputBinding, b: InputBinding): boolean {
  if (a.kind === 'button' && b.kind === 'button') return a.button === b.button;
  if (a.kind === 'axis' && b.kind === 'axis') {
    return (
      a.axis === b.axis &&
      (a.direction === 'both' || b.direction === 'both' || a.direction === b.direction)
    );
  }
  if (a.kind === 'magnitude' && b.kind === 'magnitude') return a.source === b.source;
  return false;
}

/**
 * Labels of the global gestures a node's activation collides with —
 * empty when there's no overlap (or no activation). The editor surfaces
 * these as a "wins for this item" warning.
 */
export function activationCollisions(
  activation: GestureBinding | undefined,
  navigation: MenuNavigation,
): string[] {
  if (!activation || activation.inputs.length === 0) return [];
  const hits: string[] = [];
  for (const key of Object.keys(GLOBAL_GESTURE_LABELS) as GlobalGestureKey[]) {
    const globalInputs = navigation[key].inputs;
    const collides = activation.inputs.some((ai) =>
      globalInputs.some((gi) => inputsCollide(ai, gi)),
    );
    if (collides) hits.push(GLOBAL_GESTURE_LABELS[key]);
  }
  return hits;
}
