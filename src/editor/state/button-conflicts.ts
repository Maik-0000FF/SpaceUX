// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detect when a physical SpaceMouse button is bound in more than one place
 * (#75), so the editor can warn at assignment time and colour-code the button
 * pickers instead of silently accepting a double-booking.
 *
 * Sources collected today (the ones that exist): the open/toggle trigger
 * button, the five global navigation gestures, and every node's per-item
 * activation / exit. Designed as a flat list of {button, source, weight} so a
 * future source (cross-menu / per-button open-menu bindings, #76) only has to
 * push more entries — the severity logic stays unchanged.
 *
 * Pure and React-free so the overlap rules are unit-testable.
 */

import {
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  type InputBinding,
  type MenuConfig,
  type MenuNode,
} from '@/shared/menu';

/** Colour-coding severity for a candidate button (#75). `free` = unbound
 *  elsewhere; `soft` = only clashes with a precedence-resolved source (a
 *  per-item gesture wins for its item, so it's "works, but worth knowing");
 *  `hard` = double-books an unconditional source (the toggle trigger or a
 *  global navigation gesture). */
export type ConflictSeverity = 'free' | 'soft' | 'hard';

/** One place a physical button is bound, for naming a conflict + ranking it. */
export type ButtonBinding = {
  button: number;
  /** Human label of what holds the button (shown in the warning). */
  source: string;
  weight: 'hard' | 'soft';
};

/** Button numbers an input list binds (axis/magnitude inputs carry no button). */
function buttonsOf(binding: { inputs: readonly InputBinding[] } | undefined): number[] {
  if (!binding) return [];
  return binding.inputs.flatMap((i) => (i.kind === 'button' ? [i.button] : []));
}

function walkNodes(node: MenuNode, visit: (n: MenuNode) => void): void {
  visit(node);
  for (const child of node.branches ?? []) walkNodes(child, visit);
}

/**
 * Every button binding in a config, flattened. The trigger button counts as a
 * `hard` source only in toggle mode: open-only mode "only opens the menu", so
 * the trigger is then free to also drive a gesture (per the trigger-behaviour
 * note in the editor), and isn't collected.
 */
export function collectButtonBindings(config: MenuConfig): ButtonBinding[] {
  const out: ButtonBinding[] = [];

  if ((config.triggerMode ?? DEFAULT_TRIGGER_MODE) === 'toggle') {
    out.push({
      button: config.triggerButton ?? DEFAULT_TRIGGER_BUTTON,
      source: 'Trigger button',
      weight: 'hard',
    });
  }

  const nav = config.navigation;
  if (nav) {
    const gestures: [string, { inputs: readonly InputBinding[] }][] = [
      ['Open submenu', nav.drillIn],
      ['Go back', nav.back],
      ['Step through items', nav.cycle],
      ['Activate center', nav.commitCenter],
      ['Activate item', nav.activate],
    ];
    for (const [source, binding] of gestures) {
      for (const button of buttonsOf(binding)) out.push({ button, source, weight: 'hard' });
    }
  }

  walkNodes(config.root, (node) => {
    const name = node.label ? `"${node.label}"` : 'an item';
    for (const button of buttonsOf(node.activation)) {
      out.push({ button, source: `${name} activation`, weight: 'soft' });
    }
    for (const button of buttonsOf(node.exit)) {
      out.push({ button, source: `${name} exit`, weight: 'soft' });
    }
  });

  return out;
}

/** Bindings on `button` other than `selfSource` (the picker being edited, so a
 *  binding never flags against itself). */
export function conflictsOn(
  bindings: readonly ButtonBinding[],
  button: number,
  selfSource?: string,
): ButtonBinding[] {
  return bindings.filter((b) => b.button === button && b.source !== selfSource);
}

/** Severity of a set of competing bindings: hard if any is unconditional,
 *  soft if only precedence-resolved ones remain, free if none. */
export function severityOf(conflicts: readonly ButtonBinding[]): ConflictSeverity {
  if (conflicts.length === 0) return 'free';
  return conflicts.some((c) => c.weight === 'hard') ? 'hard' : 'soft';
}
