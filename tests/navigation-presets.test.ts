// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_NAVIGATION, validateMenuConfig, MENU_CONFIG_VERSION } from '../src/shared/menu';
import { NAVIGATION_PRESETS, matchNavigationPreset } from '../src/shared/navigation-presets';

describe('navigation presets (#160)', () => {
  it('ships the four styles with unique ids', () => {
    expect(NAVIGATION_PRESETS.map((p) => p.id)).toEqual(['aiming', 'push', 'twist', 'pressLift']);
  });

  it('every preset is a structurally valid navigation block', () => {
    for (const preset of NAVIGATION_PRESETS) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        navigation: preset.navigation,
        root: { label: '', branches: [{ label: 'x' }] },
      });
      expect(r.ok, `${preset.id} should validate`).toBe(true);
      // Round-trips unchanged through the validator (no clamping/coercion).
      if (r.ok) expect(r.config.navigation).toEqual(preset.navigation);
    }
  });

  it('the twist styles bind an axis to cycle so twist aiming can actually move', () => {
    // The soft-lock guard: aim:'twist' needs a steppable (axis) cycle input.
    for (const id of ['twist', 'pressLift'] as const) {
      const preset = NAVIGATION_PRESETS.find((p) => p.id === id)!;
      expect(preset.navigation.aim).toBe('twist');
      expect(preset.navigation.cycle.inputs.some((i) => i.kind === 'axis')).toBe(true);
    }
  });

  it('matchNavigationPreset round-trips each preset by value', () => {
    for (const preset of NAVIGATION_PRESETS) {
      // A deep clone (what the editor applies) still matches by value.
      expect(matchNavigationPreset(structuredClone(preset.navigation))).toBe(preset.id);
    }
  });

  it('returns null for a custom combination', () => {
    const custom = structuredClone(NAVIGATION_PRESETS[0]!.navigation);
    custom.deadzone += 5; // a refinement no preset has
    expect(matchNavigationPreset(custom)).toBeNull();
    // The shipped default navigation isn't one of the named styles either.
    expect(matchNavigationPreset(DEFAULT_NAVIGATION)).toBeNull();
  });
});
