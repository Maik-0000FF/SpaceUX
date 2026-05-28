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

  it('matches a plugin-contributed preset when no built-in matches (#195)', () => {
    // Mirrors what NavigationStyle.tsx passes in: a list of plugin presets
    // keyed by `<pluginId>/<presetId>`. A unique custom nav block matches the
    // plugin entry and the namespaced key comes back as the dropdown value.
    const custom = structuredClone(NAVIGATION_PRESETS[0]!.navigation);
    custom.deadzone += 5;
    expect(matchNavigationPreset(custom, [{ id: 'org.example.x/style', navigation: custom }])).toBe(
      'org.example.x/style',
    );
  });

  it('built-ins win when a plugin preset duplicates a built-in navigation block', () => {
    // Two presets with the same block: the built-in's id is returned, so a
    // plugin can never silently shadow a built-in by shipping the same shape.
    const aim = NAVIGATION_PRESETS.find((p) => p.id === 'aiming')!;
    expect(
      matchNavigationPreset(structuredClone(aim.navigation), [
        { id: 'org.example.x/aim-clone', navigation: aim.navigation },
      ]),
    ).toBe('aiming');
  });
});
