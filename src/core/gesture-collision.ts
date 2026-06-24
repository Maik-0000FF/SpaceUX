// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detect when a per-node gesture binding shadows a global navigation
 * gesture (#130 R2/R3). The runtime resolves the per-item activation and
 * exit ahead of the global gestures, so a collision means the per-item
 * input *wins* for that item — useful, but worth flagging in the editor so
 * the user knows they've overridden the global behaviour there (e.g.
 * binding TZ− to activate or exit shadows the global TZ back).
 *
 * Pure, so the overlap rules are unit-testable.
 */

import {
  inputConflictKeys,
  navigationConflicts,
  type GestureBinding,
  type InputBinding,
  type MenuNavigation,
  type NavGestureName,
} from '../shared/menu.js';

import { inputLabel } from './nav-input.js';

/** Plain-language label per navigation gesture, the single source the editor
 *  draws on: the shadow note, the conflict note, and the NavigationSettings
 *  sub-headings all read from here so they can't drift. */
export const NAV_GESTURE_LABELS: Record<NavGestureName, string> = {
  // Firing the hovered leaf's action, the menu-wide activate gesture (#160).
  activate: 'Activate item',
  // The centre's own commit (#129), beside its label/action.
  commitCenter: 'Activate center',
  // Just "Go back": back pops a level and walks to the centre (#147).
  back: 'Go back',
  drillIn: 'Open submenu',
  cycle: 'Step through items',
};

/** Global gestures a per-item binding can shadow (activate is per-item itself,
 *  so it isn't in this set). The runtime resolves a per-item input ahead of
 *  these, so it wins for that item. */
const SHADOWED_GESTURES: NavGestureName[] = ['drillIn', 'back', 'cycle', 'commitCenter'];

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
 * Labels of the global gestures a per-node binding (activation or exit)
 * collides with — empty when there's no overlap (or no binding). The
 * editor surfaces these as a "wins for this item" warning.
 */
export function gestureShadows(
  binding: GestureBinding | undefined,
  navigation: MenuNavigation,
): string[] {
  if (!binding || binding.inputs.length === 0) return [];
  const hits: string[] = [];
  for (const key of SHADOWED_GESTURES) {
    const globalInputs = navigation[key].inputs;
    const collides = binding.inputs.some((bi) => globalInputs.some((gi) => inputsCollide(bi, gi)));
    if (collides) hits.push(NAV_GESTURE_LABELS[key]);
  }
  return hits;
}

/** The largest analog threshold among the gestures the user relies on to move
 *  through the menu: the aim deadzones plus the drill / back / cycle inputs.
 *  It's the best proxy for "a deflection the user can comfortably reach" we
 *  have until axes are normalised to a common range (#162). */
function reachableThreshold(navigation: MenuNavigation): number {
  const thresholds = [navigation.deadzone, navigation.hoverDeadzone];
  for (const key of ['drillIn', 'back', 'cycle'] as const) {
    for (const input of navigation[key].inputs) {
      if (input.kind === 'axis' || input.kind === 'magnitude') thresholds.push(input.threshold);
    }
  }
  return Math.max(...thresholds);
}

/** The highest analog (axis/magnitude) threshold in a binding, or 0 when it
 *  has none (e.g. a button-only binding has no threshold to reach). */
function maxBindingThreshold(binding: GestureBinding | undefined): number {
  let max = 0;
  for (const input of binding?.inputs ?? []) {
    if (input.kind === 'axis' || input.kind === 'magnitude') max = Math.max(max, input.threshold);
  }
  return max;
}

/**
 * Heuristic reachability hint (#393): a commit/fire binding (a centre commit or
 * a per-item activation/exit) whose analog threshold is set *firmer* than every
 * navigation gesture the user moves with may be too firm to ever trigger, the
 * silent never-fire that has no runtime signal. Returns `{ threshold, reference
 * }` when the binding exceeds that reach, else null.
 *
 * Only a hint: without per-axis ranges (#162) thresholds on different axes
 * aren't strictly comparable, so the reference is an approximation and the
 * editor copy stays soft.
 */
export function unreachableThresholdHint(
  binding: GestureBinding | undefined,
  navigation: MenuNavigation,
): { threshold: number; reference: number } | null {
  const threshold = maxBindingThreshold(binding);
  if (threshold === 0) return null;
  const reference = reachableThreshold(navigation);
  return threshold > reference ? { threshold, reference } : null;
}

/** A navigation input that collides with one or more other gestures (#105),
 *  with everything the editor needs to explain it in place. */
export interface InputConflict {
  /** Plain-language labels of the gestures this input must beat to fire. */
  gestures: string[];
  /** Readable shared trigger, e.g. "Press down (TZ−)". */
  trigger: string;
  /** Concrete resolution: the threshold to drop below to take priority, else a
   *  distinct-input hint when no threshold can separate them (a button clash). */
  fix: string;
}

/**
 * Conflict detail for gesture `key` *on this specific input*, or null when the
 * input has no live conflict (the issue-#105 rule surfaced in the editor): the
 * per-input outline, its ⚠ tooltip, and the section note all read from here.
 *
 * Only the higher-priority gesture in a pair (the one the runtime resolves
 * first, so the one meant to win the input) carries the conflict, so the note
 * lands on the gesture the user should make win and never nags the other side.
 * The fix is dynamic and live: drop this gesture's threshold below the rival's
 * so it fires first and takes priority, at which point `navigationConflicts`
 * stops returning the pair and the note clears on its own. A button clash has
 * no threshold to undercut, so there it asks for a distinct input instead.
 */
export function inputConflict(
  key: NavGestureName,
  input: InputBinding,
  navigation: MenuNavigation,
  centreIsCancel = false,
): InputConflict | null {
  const inputKeys = new Set(inputConflictKeys(input));
  const rivals = new Set<string>();
  let ceiling: number | null = null; // lowest rival threshold this gesture must drop below
  for (const { gestures, key: collisionKey, target } of navigationConflicts(
    navigation,
    centreIsCancel,
  )) {
    // gestures[0] is the owner (higher priority); the conflict shows on its row
    // only, and only for the input that actually collides.
    if (gestures[0] !== key || !inputKeys.has(collisionKey)) continue;
    rivals.add(NAV_GESTURE_LABELS[gestures[1]]);
    if (target !== null) ceiling = ceiling === null ? target : Math.min(ceiling, target);
  }
  if (rivals.size === 0) return null;
  const list = [...rivals].join(', ');
  // A threshold can separate them only when there's a rival threshold to get
  // below and headroom under it (>1, since thresholds floor at 1).
  const fix =
    ceiling !== null && ceiling > 1
      ? `Set its threshold below ${ceiling} (e.g. ${ceiling - 1}) so it triggers before ${list} and takes priority.`
      : `Pick a distinct input so it does not clash with ${list}.`;
  return { gestures: [...rivals], trigger: inputLabel(input), fix };
}

/** The conflict detail for every conflicting input of gesture `key` (the
 *  section-level note); empty when `key` is conflict-free. */
export function gestureConflicts(
  key: NavGestureName,
  navigation: MenuNavigation,
  centreIsCancel = false,
): InputConflict[] {
  return navigation[key].inputs
    .map((input) => inputConflict(key, input, navigation, centreIsCancel))
    .filter((c): c is InputConflict => c !== null);
}
