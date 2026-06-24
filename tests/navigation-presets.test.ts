// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MENU_CONFIG,
  DEFAULT_NAVIGATION,
  validateMenuConfig,
  MENU_CONFIG_VERSION,
} from '../src/shared/menu';
import { NAVIGATION_PRESETS, matchNavigationPreset } from '../src/shared/navigation-presets';

describe('navigation presets (#160)', () => {
  it('ships only the aiming preset as a built-in (#195: others moved to a plugin)', () => {
    // PR3 of #195 reduced the built-in set to just `aiming`: the previous
    // push / twist / pressLift presets moved to the twist-press-lift
    // nav-style plugin. This test pins the slim default so a future
    // accidental re-add doesn't sneak back through.
    expect(NAVIGATION_PRESETS.map((p) => p.id)).toEqual(['aiming']);
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

  it('seeds the default menu on the aiming (Tilt to aim) preset', () => {
    // The first-run menu carries the aiming navigation explicitly, so the
    // editor shows "Tilt to aim" rather than a Custom mix. Guards against the
    // default menu and the preset drifting apart.
    expect(DEFAULT_MENU_CONFIG.navigation).toBeDefined();
    expect(matchNavigationPreset(DEFAULT_MENU_CONFIG.navigation!)).toBe('aiming');
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
