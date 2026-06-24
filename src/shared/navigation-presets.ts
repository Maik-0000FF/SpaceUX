// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Navigation styles (#160): ready-made, internally-consistent bundles of
 * the whole `navigation` block, so a user picks a coherent style instead
 * of hand-assembling every gesture (a wrong combo, e.g. a magnitude bound
 * to the cycle step, which can't step, silently soft-locks the menu).
 *
 * One-shot apply: selecting a style writes its `navigation` wholesale; the
 * user then refines the individual fields in Properties, and the dropdown
 * shows "Custom" once the bindings no longer match any preset
 * (see {@link matchNavigationPreset}). No persisted style id; presets are
 * just predefined values.
 *
 * Built-ins ship only `aiming` (the default for someone who's never used a
 * SpaceMouse): the previous push / twist / pressLift presets moved out to
 * the `twist-press-lift` nav-style plugin (#195), so the built-in set is
 * the one style every new user needs to be productive and any taste is an
 * installable add-on.
 */

import isEqual from 'lodash/isEqual.js';

import { AIMING_NAVIGATION, type MenuNavigation } from './menu.js';

export type NavigationPresetId = 'aiming';

export type NavigationPreset = {
  id: NavigationPresetId;
  /** Dropdown label. */
  label: string;
  /** One-line description of the gesture model, shown under the dropdown. */
  description: string;
  /** The full navigation block this style applies. */
  navigation: MenuNavigation;
};

export const NAVIGATION_PRESETS: readonly NavigationPreset[] = [
  {
    id: 'aiming',
    label: 'Tilt to aim',
    description:
      'Push or tilt to hover an item; aim firmly to open its submenu. Press down (TZ−) to go back.',
    navigation: AIMING_NAVIGATION,
  },
];

/** The id of the preset whose bindings exactly match `nav`, or `null` when
 *  the bindings are a custom combination (no preset matches). Drives the
 *  "Custom" entry in the style dropdown.
 *
 *  `extra` is the merged list of plugin-contributed presets (#195) the
 *  caller wants to match against in addition to the built-ins. Each entry's
 *  `id` is opaque to this function (the picker namespaces plugin ids as
 *  `<pluginId>/<presetId>` before passing them in); built-ins win on a tie
 *  because they're consulted first, so the same `id` collision can't change
 *  semantics. */
export function matchNavigationPreset(
  nav: MenuNavigation,
  extra: readonly { id: string; navigation: MenuNavigation }[] = [],
): string | null {
  const builtIn = NAVIGATION_PRESETS.find((preset) => isEqual(preset.navigation, nav));
  if (builtIn) return builtIn.id;
  return extra.find((preset) => isEqual(preset.navigation, nav))?.id ?? null;
}
