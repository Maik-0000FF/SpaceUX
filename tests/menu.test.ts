// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_ACTION,
  BUILTIN_PLUGIN_ID,
  DEFAULT_AXIS_INVERT,
  DEFAULT_MENU_CONFIG,
  DEFAULT_TRIGGER_BUTTON,
  MENU_CONFIG_VERSION,
  builtinAction,
  resolveAxisInvert,
  validateMenuConfig,
} from '../src/shared/menu';

describe('validateMenuConfig', () => {
  it('accepts the factory default config', () => {
    const result = validateMenuConfig(DEFAULT_MENU_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.version).toBe(MENU_CONFIG_VERSION);
      expect(result.config.sectors).toEqual(DEFAULT_MENU_CONFIG.sectors);
    }
  });

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 42, 'hello', [1, 2, 3]]) {
      const result = validateMenuConfig(bad);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a missing or wrong version', () => {
    expect(validateMenuConfig({ sectors: [] }).ok).toBe(false);
    expect(validateMenuConfig({ version: 'one', sectors: [] }).ok).toBe(false);
    expect(validateMenuConfig({ version: 999, sectors: [{ label: 'x' }] }).ok).toBe(false);
  });

  it('rejects an empty sectors array', () => {
    const r = validateMenuConfig({ version: MENU_CONFIG_VERSION, sectors: [] });
    expect(r.ok).toBe(false);
  });

  it('rejects a sector with no label', () => {
    const r = validateMenuConfig({ version: MENU_CONFIG_VERSION, sectors: [{}] });
    expect(r.ok).toBe(false);
  });

  it('rejects a sector with a blank label', () => {
    const r = validateMenuConfig({ version: MENU_CONFIG_VERSION, sectors: [{ label: '   ' }] });
    expect(r.ok).toBe(false);
  });

  it('accepts a sector without a binding (label-only)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'Just a label' }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a binding without an action field', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'x', binding: {} }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a binding with a non-object config', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'x',
          binding: { action: builtinAction('exec'), config: 'not-an-object' },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('drops sector.icon when it is not a string', () => {
    // Strictly the validator rejects the wrong type rather than
    // silently dropping; pin that contract.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'x', icon: 42 }],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a config without triggerButton (field is optional)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'x' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.triggerButton).toBeUndefined();
  });

  it('accepts a non-negative integer triggerButton', () => {
    for (const v of [0, 1, 7]) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        triggerButton: v,
        sectors: [{ label: 'x' }],
      });
      expect(r.ok, `triggerButton=${v}`).toBe(true);
      if (r.ok) expect(r.config.triggerButton).toBe(v);
    }
  });

  it('rejects negative, fractional, or non-number triggerButton', () => {
    for (const bad of [-1, 1.5, '0', null, true]) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        triggerButton: bad,
        sectors: [{ label: 'x' }],
      });
      expect(r.ok, `triggerButton=${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe('validateMenuConfig — nested submenus', () => {
  it('accepts a sector whose only role is to host children (branch)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'FreeCAD',
          children: [
            { label: 'New', binding: { action: builtinAction('exec'), config: { command: 'x' } } },
            { label: 'Open', binding: { action: builtinAction('exec'), config: { command: 'y' } } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const branch = r.config.sectors[0];
      expect(branch?.children).toHaveLength(2);
      expect(branch?.binding).toBeUndefined();
    }
  });

  it('rejects a sector that declares both binding and children', () => {
    // Branch vs leaf must be unambiguous so the renderer doesn't
    // have to decide which one wins on commit.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'Ambiguous',
          binding: { action: builtinAction('exec'), config: { command: 'x' } },
          children: [{ label: 'Child' }],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/either "binding" or "children", not both/);
  });

  it('rejects an empty children array (would render as a hole with no escape)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'Empty branch', children: [] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"children" must be a non-empty array/);
  });

  it('rejects a non-array children field', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [{ label: 'x', children: 'not-an-array' }],
    });
    expect(r.ok).toBe(false);
  });

  it('reports the path when a deep grandchild is malformed', () => {
    // The "where" prefix has to follow the recursion so a misconfig
    // five levels in is still traceable. This pin guards the path
    // assembly — a future "flatten the message for brevity" refactor
    // would silently lose the depth context users need to find the
    // bad node in their menu.json.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'top',
          children: [
            {
              label: 'mid',
              children: [{ label: '' }], // blank label at depth 2
            },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('sector 0 child 0 child 0');
      expect(r.reason).toContain('"label"');
    }
  });

  it('accepts arbitrarily nested branches (depth 3 here)', () => {
    // The schema is intentionally recursive — pinning a 3-deep config
    // makes the "yes, more than two levels really works" promise
    // load-bearing rather than implicit.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [
        {
          label: 'L0',
          children: [
            {
              label: 'L1',
              children: [
                {
                  label: 'L2',
                  binding: { action: builtinAction('exec'), config: { command: 'deep' } },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('DEFAULT_MENU_CONFIG', () => {
  it('pins triggerButton to DEFAULT_TRIGGER_BUTTON', () => {
    // The shipped default exposes the trigger explicitly so users
    // copying the config as a starting point see the field instead
    // of relying on the loader's implicit fallback.
    expect(DEFAULT_MENU_CONFIG.triggerButton).toBe(DEFAULT_TRIGGER_BUTTON);
  });

  it('pins axisInvert to DEFAULT_AXIS_INVERT (no default drift)', () => {
    // The renderer falls back to DEFAULT_AXIS_INVERT when a user
    // config omits the field. If the shipped DEFAULT_MENU_CONFIG
    // drifts away from that constant, a config with no axisInvert
    // would silently differ from one that copy-pastes the
    // shipped value.
    expect(DEFAULT_MENU_CONFIG.axisInvert).toEqual(DEFAULT_AXIS_INVERT);
  });
});

describe('resolveAxisInvert', () => {
  it('returns DEFAULT_AXIS_INVERT when axisInvert is omitted', () => {
    expect(resolveAxisInvert({})).toEqual(DEFAULT_AXIS_INVERT);
  });

  it('fills the missing side of a partial override from DEFAULT_AXIS_INVERT', () => {
    // The regression that motivated this resolver: PieMenu used to
    // fall back to DEFAULT_PIE_GEOMETRY.invertY (true) for a missing
    // y, while App.tsx fell back to DEFAULT_AXIS_INVERT.y (false).
    // Both paths now go through resolveAxisInvert, so pinning the
    // contract here keeps a future consumer from picking a different
    // fallback constant.
    expect(resolveAxisInvert({ axisInvert: { x: true } })).toEqual({
      x: true,
      y: DEFAULT_AXIS_INVERT.y,
    });
    expect(resolveAxisInvert({ axisInvert: { y: true } })).toEqual({
      x: DEFAULT_AXIS_INVERT.x,
      y: true,
    });
  });

  it('passes through a fully specified override unchanged', () => {
    expect(resolveAxisInvert({ axisInvert: { x: true, y: true } })).toEqual({ x: true, y: true });
  });
});

describe('builtinAction key composition', () => {
  it('produces "<plugin>/<name>" form expected by the dispatch path', () => {
    expect(builtinAction('exec')).toBe(`${BUILTIN_PLUGIN_ID}/exec`);
    expect(builtinAction('key-combo')).toBe(`${BUILTIN_PLUGIN_ID}/key-combo`);
  });

  it('every default-config binding references a known built-in action', () => {
    // Single source of truth for built-in names lives in
    // BUILTIN_ACTION; this guards against a typo in the default
    // config slipping past the validator (which has no semantic
    // knowledge of which actions exist).
    const known = new Set<string>([
      builtinAction(BUILTIN_ACTION.KEY_COMBO),
      builtinAction(BUILTIN_ACTION.EXEC),
    ]);
    for (const sector of DEFAULT_MENU_CONFIG.sectors) {
      const action = sector.binding?.action;
      expect(action, `sector "${sector.label}" has no binding`).toBeDefined();
      expect(known, `sector "${sector.label}" references unknown action ${action}`).toContain(
        action,
      );
    }
  });
});
