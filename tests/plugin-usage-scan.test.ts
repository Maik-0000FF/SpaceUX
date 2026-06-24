// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { scanPluginUsage, type MenuRef } from '../src/main/plugin-usage-scan';
import { DEFAULT_PIE_APPEARANCE } from '../src/shared/pie-appearance';
import { DEFAULT_MENU_CONFIG } from '../src/shared/menu';
import { type MenuConfig, type MenuNode } from '../src/shared/menu';
import { type PieAppearance } from '../src/shared/ipc';

function makeMenu(
  name: string,
  overrides: Partial<MenuConfig> = {},
  appearance: PieAppearance = DEFAULT_PIE_APPEARANCE,
): MenuRef {
  return {
    name,
    config: { ...DEFAULT_MENU_CONFIG, ...overrides },
    appearance,
  };
}

function makeActionNode(actionId: string, label = 'leaf'): MenuNode {
  return { label, action: { id: actionId, config: {} } };
}

const emptyAppearance: PieAppearance = { ...DEFAULT_PIE_APPEARANCE };

describe('scanPluginUsage — shape kind', () => {
  it('reports menus whose shapeModel matches the plugin', () => {
    const a = makeMenu('A', { shapeModel: 'org.spaceux.planets/planets' });
    const b = makeMenu('B', { shapeModel: 'org.other.different/orbit' });
    const c = makeMenu('C'); // no shape override, inherit
    const report = scanPluginUsage('org.spaceux.planets', 'shape', [a, b, c], emptyAppearance);
    expect(report.menus).toEqual(['A']);
    expect(report.globalAppearance).toBe(false);
  });

  it('reports the global appearance when it points at the plugin', () => {
    const appearance: PieAppearance = {
      ...DEFAULT_PIE_APPEARANCE,
      shapeModel: 'org.spaceux.planets/planets',
    };
    const report = scanPluginUsage('org.spaceux.planets', 'shape', [], appearance);
    expect(report.menus).toEqual([]);
    expect(report.globalAppearance).toBe(true);
  });

  it('ignores menus with shapeModel undefined (inherit) or null (force wedge)', () => {
    // undefined = inherit appearance; null = force the built-in wedge. Both
    // mean this menu does NOT reference the plugin, even if the menu name
    // looks otherwise interesting.
    const inherit = makeMenu('Inherit'); // undefined
    const forceWedge = makeMenu('ForceWedge', { shapeModel: null });
    const report = scanPluginUsage(
      'org.spaceux.planets',
      'shape',
      [inherit, forceWedge],
      emptyAppearance,
    );
    expect(report.menus).toEqual([]);
    expect(report.globalAppearance).toBe(false);
  });

  it('matches on the plugin-id prefix, not a substring elsewhere', () => {
    // Guard against a future bug where the scan checks `includes` instead of
    // `startsWith` and matches a key like `other.org.spaceux.planets/orbit`
    // that contains the plugin id mid-string.
    const a = makeMenu('A', { shapeModel: 'other.org.spaceux.planets/orbit' });
    const report = scanPluginUsage('org.spaceux.planets', 'shape', [a], emptyAppearance);
    expect(report.menus).toEqual([]);
  });

  it('reports a menu that inherits from a per-menu appearance pointing at the plugin', () => {
    // Device profiles can bundle their own PieAppearance (#113). A menu in
    // such a profile may have `shapeModel: undefined` (inherit) and still
    // effectively render via the plugin because the profile's appearance
    // targets it. The scan must follow that inheritance.
    const profileAppearance: PieAppearance = {
      ...DEFAULT_PIE_APPEARANCE,
      shapeModel: 'org.spaceux.planets/planets',
    };
    const a = makeMenu('Inherit', {}, profileAppearance);
    const report = scanPluginUsage('org.spaceux.planets', 'shape', [a], emptyAppearance);
    expect(report.menus).toEqual(['Inherit']);
    // The *global* appearance still doesn't point at the plugin; that flag
    // tracks the app-level default, not per-profile bundles.
    expect(report.globalAppearance).toBe(false);
  });

  it('does not report a menu whose null override forces wedge, even if its appearance targets the plugin', () => {
    // `shapeModel: null` is an explicit "force the built-in wedge here",
    // overriding whatever the appearance says. The scan respects that — the
    // menu does not in fact use the plugin.
    const profileAppearance: PieAppearance = {
      ...DEFAULT_PIE_APPEARANCE,
      shapeModel: 'org.spaceux.planets/planets',
    };
    const a = makeMenu('ForceWedge', { shapeModel: null }, profileAppearance);
    const report = scanPluginUsage('org.spaceux.planets', 'shape', [a], emptyAppearance);
    expect(report.menus).toEqual([]);
  });
});

describe('scanPluginUsage — function kind', () => {
  it('reports menus whose tree contains an action namespaced under the plugin', () => {
    const branchTree: MenuNode = {
      label: 'root',
      branches: [makeActionNode('org.spaceux.freecad/run'), makeActionNode('builtin/other')],
    };
    const a = makeMenu('A', { root: branchTree });
    const b = makeMenu('B'); // default root, no actions
    const report = scanPluginUsage('org.spaceux.freecad', 'function', [a, b], emptyAppearance);
    expect(report.menus).toEqual(['A']);
  });

  it('walks deeply nested branches', () => {
    const deep: MenuNode = {
      label: 'root',
      branches: [
        {
          label: 'mid',
          branches: [
            {
              label: 'deeper',
              branches: [makeActionNode('org.spaceux.freecad/run')],
            },
          ],
        },
      ],
    };
    const a = makeMenu('A', { root: deep });
    const report = scanPluginUsage('org.spaceux.freecad', 'function', [a], emptyAppearance);
    expect(report.menus).toEqual(['A']);
  });

  it('matches the root node action when the centre carries an action commit', () => {
    // The root node may itself carry an action (the centre's commit target);
    // the scanner must check it, not only its branches.
    const a = makeMenu('A', {
      root: { label: 'root', action: { id: 'org.spaceux.freecad/run', config: {} } },
    });
    const report = scanPluginUsage('org.spaceux.freecad', 'function', [a], emptyAppearance);
    expect(report.menus).toEqual(['A']);
  });

  it('ignores menus where no node references the plugin', () => {
    const a = makeMenu('A', {
      root: {
        label: 'root',
        branches: [makeActionNode('builtin/launch'), makeActionNode('org.other/run')],
      },
    });
    const report = scanPluginUsage('org.spaceux.freecad', 'function', [a], emptyAppearance);
    expect(report.menus).toEqual([]);
  });

  it('never sets globalAppearance for the function kind', () => {
    // globalAppearance is shape-only by definition: there is no
    // `appearance.functionPlugin`. Even an appearance whose shapeModel
    // points at the function plugin's id (nonsense) must not flip the flag
    // on a function scan.
    const appearance: PieAppearance = {
      ...DEFAULT_PIE_APPEARANCE,
      shapeModel: 'org.spaceux.freecad/anything',
    };
    const a = makeMenu('A', {
      root: { label: 'root', branches: [makeActionNode('org.spaceux.freecad/run')] },
    });
    const report = scanPluginUsage('org.spaceux.freecad', 'function', [a], appearance);
    expect(report.menus).toEqual(['A']);
    expect(report.globalAppearance).toBe(false);
  });
});

describe('scanPluginUsage — nav-style and theme are stubbed', () => {
  it('returns an empty report for nav-style regardless of input', () => {
    // The matching for nav-style needs preset-id provenance the scanner
    // doesn't have today; treating "no detection" as "no usage" surfaces a
    // plain confirm message, which is correct fallback behaviour.
    const a = makeMenu('A'); // anything
    const report = scanPluginUsage(
      'org.spaceux.twist-press-lift',
      'nav-style',
      [a],
      emptyAppearance,
    );
    expect(report.menus).toEqual([]);
    expect(report.globalAppearance).toBe(false);
  });

  it('returns an empty report for theme regardless of input', () => {
    const a = makeMenu('A');
    const report = scanPluginUsage('org.example.theme', 'theme', [a], emptyAppearance);
    expect(report.menus).toEqual([]);
    expect(report.globalAppearance).toBe(false);
  });
});
