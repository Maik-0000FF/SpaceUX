// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionConfigSchema } from '@/shared/plugin-types';

/**
 * Single source of truth for the editor's hover-help copy (#279).
 *
 * Tooltip strings used to live inline as scattered `title=` attributes; they
 * collect here so the wording is consistent and editable in one place. The
 * rich, control-specific composition (the JSON example below, multi-line
 * bubbles) is done by the `Tooltip` component at the call site; this module
 * holds the plain strings and the pure builders feeding them.
 */

/** Pie appearance sliders, keyed by the control they annotate. */
export const SLIDER_TOOLTIPS = {
  size: 'Overall size of the pie on screen (100% = the app default).',
  opacity: 'Opacity of the pie background (100% = fully opaque).',
  label: 'Label size as a fraction of the per-segment fit (100% = fill the segment).',
  icon: 'Icon size as a fraction of the per-segment fit (100% = fills the segment).',
  ring: 'Split between the inner pie and the outer ring (50% = default); keeps the overall size.',
  center: 'Size of the centre hole relative to the inner pie (50% = default).',
} as const;

/** Conflict / read-only banner buttons. The reload/overwrite copy depends on
 *  why the active config diverged (an external edit vs. a device/profile
 *  switch), matching the banner text. */
export const BANNER_TOOLTIPS = {
  reloadExternal: 'Discard your edits and load the changed config.',
  reloadActive: 'Discard your edits and load the now-active config.',
  overwriteExternal: 'Write your unsaved edits over the changed config.',
  overwriteActive: 'Write your unsaved edits onto the now-active config.',
  switchToAuto:
    'Leave the read-only plugin pie and edit your own (Auto follows the device / menu.json).',
} as const;

/** Action picker, shown when nothing is picked or the action has no
 *  description of its own (the picked action's own description wins). */
export const ACTION_FIELD_HINT =
  'What this item does when committed. Hover an option in the list to see what it does.';

/** Intro line for the action Config field, shown above the JSON example. */
export const CONFIG_FIELD_INTRO = 'Per-action settings as a JSON object.';

/** Shown when the picked action declares no configurable fields. */
export const CONFIG_FIELD_NONE = 'This action takes no configuration.';

/** A representative value for one config field, used to build the example. */
function exampleValue(field: ActionConfigSchema[string]): string | number | boolean {
  switch (field.kind) {
    case 'string':
      return field.placeholder ?? field.default ?? '';
    case 'integer':
      return field.default ?? field.min ?? 0;
    case 'boolean':
      return field.default ?? false;
    case 'enum':
      return field.default ?? field.choices[0] ?? '';
  }
}

/**
 * A concrete, copy-pasteable JSON example for an action's config schema, or
 * null when the action has no configurable fields. Each field contributes its
 * placeholder/default (or a typed fallback) so the user sees the exact shape
 * the field expects, e.g. `{ "command": "firefox …" }` for `exec`.
 */
export function actionConfigExample(schema: ActionConfigSchema | undefined): string | null {
  if (schema === undefined) return null;
  const keys = Object.keys(schema);
  if (keys.length === 0) return null;
  const example: Record<string, string | number | boolean> = {};
  for (const key of keys) example[key] = exampleValue(schema[key]!);
  return JSON.stringify(example, null, 2);
}
