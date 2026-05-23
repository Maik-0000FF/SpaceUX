// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Navigation styles (#160): ready-made, internally-consistent bundles of
 * the whole `navigation` block, so a user picks a coherent style instead
 * of hand-assembling every gesture (a wrong combo — e.g. a magnitude bound
 * to the cycle step, which can't step — silently soft-locks the menu).
 *
 * One-shot apply: selecting a style writes its `navigation` wholesale; the
 * user then refines the individual fields in Properties, and the dropdown
 * shows "Custom" once the bindings no longer match any preset
 * (see {@link matchNavigationPreset}). No persisted style id — presets are
 * just predefined values.
 */

import isEqual from 'lodash/isEqual';

import {
  DEFAULT_LATERAL_DEADZONE,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  type MenuNavigation,
} from './menu';

export type NavigationPresetId = 'aiming' | 'push' | 'twist' | 'pressLift';

export type NavigationPreset = {
  id: NavigationPresetId;
  /** Dropdown label. */
  label: string;
  /** One-line description of the gesture model, shown under the dropdown. */
  description: string;
  /** The full navigation block this style applies. */
  navigation: MenuNavigation;
};

// Firmness past the aim deadzone at which a lateral push commits a drill —
// well above the deadzone so a light push aims and a firm one drills.
const DRILL_PUSH_THRESHOLD = 250;
// TZ deflection for the press/lift split — above the aim deadzone so a
// light puck rest doesn't trip it, with each half its own gesture.
const TZ_SPLIT_THRESHOLD = 150;
// The primary button fires the hovered leaf (and drills a branch in the
// twist style); the user can move it off the trigger button if it clashes.
const ACTIVATE_BUTTON = 0;

const tzBack: MenuNavigation['back'] = {
  inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: DEFAULT_LATERAL_DEADZONE }],
};
const twistCycle: MenuNavigation['cycle'] = {
  inputs: [
    { kind: 'axis', axis: 'rz', direction: 'both', threshold: DEFAULT_TWIST_CYCLE_THRESHOLD },
  ],
  priority: 'twist',
};
const activateButton: MenuNavigation['activate'] = {
  inputs: [{ kind: 'button', button: ACTIVATE_BUTTON }],
};

export const NAVIGATION_PRESETS: readonly NavigationPreset[] = [
  {
    id: 'aiming',
    label: 'Aiming (standard)',
    description: 'Push or tilt points at an item; a firm push drills in. Press TZ to go back.',
    navigation: {
      aim: 'both',
      deadzone: DEFAULT_LATERAL_DEADZONE,
      drillIn: {
        inputs: [{ kind: 'magnitude', source: 'lateral', threshold: DRILL_PUSH_THRESHOLD }],
      },
      back: tzBack,
      cycle: { inputs: [], priority: 'lateral' },
      commitCenter: { inputs: [] },
      activate: activateButton,
    },
  },
  {
    id: 'push',
    label: 'Push only',
    description: 'Slide (TX/TY) points at an item; a firm push drills in. Press TZ to go back.',
    navigation: {
      aim: 'push',
      deadzone: DEFAULT_LATERAL_DEADZONE,
      drillIn: {
        inputs: [{ kind: 'magnitude', source: 'lateral', threshold: DRILL_PUSH_THRESHOLD }],
      },
      back: tzBack,
      cycle: { inputs: [], priority: 'lateral' },
      commitCenter: { inputs: [] },
      activate: activateButton,
    },
  },
  {
    id: 'twist',
    label: 'Twist only',
    description:
      'Twist (RZ) steps through items; button 0 drills a submenu or fires an item. Press TZ to go back.',
    navigation: {
      aim: 'twist',
      deadzone: DEFAULT_LATERAL_DEADZONE,
      drillIn: { inputs: [{ kind: 'button', button: ACTIVATE_BUTTON }] },
      back: tzBack,
      cycle: twistCycle,
      commitCenter: { inputs: [] },
      activate: activateButton,
    },
  },
  {
    id: 'pressLift',
    label: 'Press / Lift',
    description:
      'Twist (RZ) steps through items; lift (TZ+) drills in, press (TZ−) goes back; button 0 fires an item.',
    navigation: {
      aim: 'twist',
      deadzone: DEFAULT_LATERAL_DEADZONE,
      drillIn: {
        inputs: [
          { kind: 'axis', axis: 'tz', direction: 'positive', threshold: TZ_SPLIT_THRESHOLD },
        ],
      },
      back: {
        inputs: [
          { kind: 'axis', axis: 'tz', direction: 'negative', threshold: TZ_SPLIT_THRESHOLD },
        ],
      },
      cycle: twistCycle,
      commitCenter: { inputs: [] },
      activate: activateButton,
    },
  },
];

/** The id of the preset whose bindings exactly match `nav`, or `null` when
 *  the bindings are a custom combination (no preset matches) — drives the
 *  "Custom" entry in the style dropdown. */
export function matchNavigationPreset(nav: MenuNavigation): NavigationPresetId | null {
  return NAVIGATION_PRESETS.find((preset) => isEqual(preset.navigation, nav))?.id ?? null;
}
