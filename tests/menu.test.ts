// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_ACTION,
  BUILTIN_PLUGIN_ID,
  DEFAULT_AXIS_INVERT,
  DEFAULT_MENU_CONFIG,
  DEFAULT_TRIGGER_BUTTON,
  MAX_MENU_DEPTH,
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

  it('accepts non-ASCII labels (emoji, CJK, RTL, accented, combining marks)', () => {
    // The label contract is "any non-empty Unicode string". Pin
    // representative categories so a future "ASCII only" tightening
    // would have to delete this test rather than silently regressing.
    // Composite glyphs (Variation-Selector + ZWJ) depend on the host
    // font rendering, but the validator's job is purely structural —
    // it accepts them and trusts the renderer's <text> + system font
    // to draw them.
    const labels = [
      '🔊',
      '📁 Files',
      '⚠️', // text + variation-selector
      '👨‍👩‍👧', // ZWJ-joined family composite
      '🇩🇪', // regional-indicator pair (flag)
      '設定', // CJK
      'إعدادات', // Arabic / RTL
      'café', // Latin-1 precomposed accented (U+00E9)
      'café', // NFD-decomposed equivalent: "cafe" + COMBINING ACUTE ACCENT
      'naïve', // diaeresis (precomposed)
    ];
    for (const label of labels) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        sectors: [{ label }],
      });
      expect(r.ok, `label=${JSON.stringify(label)}`).toBe(true);
      if (r.ok) {
        const sector = r.config.sectors[0];
        expect(sector?.label).toBe(label);
      }
    }
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

  it('accepts an opt-in tzDeadzone and round-trips its value', () => {
    // Optional positive-number knob that lets the user raise the
    // TZ-cancel threshold separately from the lateral deadzone.
    // Round-trip pin so a refactor that drops the field from the
    // resolved config (e.g. accidentally narrowing the result type)
    // fails here.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      tzDeadzone: 120,
      sectors: [{ label: 'x' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.tzDeadzone).toBe(120);
  });

  it('rejects malformed tzDeadzone shapes', () => {
    // Same shape contract as the threshold field on
    // magnitudeDrill/tiltDrill — positive finite number. Pinned as
    // a table so a future "let 0 through" tweak (which would mean
    // "fire on any TZ deflection") has to remove a test rather
    // than tweak it silently.
    const cases: unknown[] = ['100', null, true, 0, -1, Infinity, NaN];
    for (const bad of cases) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        tzDeadzone: bad,
        sectors: [{ label: 'x' }],
      });
      expect(r.ok, `tzDeadzone=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok)
        expect(r.reason, `tzDeadzone=${JSON.stringify(bad)}`).toMatch(
          /"tzDeadzone".*positive finite number/,
        );
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
    if (!r.ok) expect(r.reason).toMatch(/"children" must not be empty/);
  });

  it('rejects a non-array children field with a distinct message', () => {
    // The "not an array" and "empty array" cases produce different
    // reasons so a user staring at the error knows whether to add
    // brackets or to add an entry — pinning both messages here keeps
    // a future "consolidate for brevity" refactor from re-merging
    // them and losing that signal.
    for (const bad of ['not-an-array', 42, null, {}]) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        sectors: [{ label: 'x', children: bad }],
      });
      expect(r.ok, `children=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok)
        expect(r.reason, `children=${JSON.stringify(bad)}`).toMatch(
          /"children" must be an array when present/,
        );
    }
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

  it('accepts an opt-in magnitudeDrill config and round-trips its fields', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      magnitudeDrill: { enabled: true, threshold: 250 },
      sectors: [{ label: 'x' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.magnitudeDrill).toEqual({ enabled: true, threshold: 250 });
  });

  it('rejects malformed magnitudeDrill shapes', () => {
    // Each variant breaks a different invariant — enabled must be
    // a real boolean, threshold a positive finite number. Pinned
    // as a table so a future "loosen one of these" refactor has to
    // remove a test rather than tweak it silently.
    const cases: Array<[unknown, RegExp]> = [
      ['not-an-object', /must be an object/],
      [{ threshold: 200 }, /enabled.*must be a boolean/],
      [{ enabled: 'yes', threshold: 200 }, /enabled.*must be a boolean/],
      [{ enabled: true, threshold: '200' }, /threshold.*positive finite number/],
      [{ enabled: true, threshold: 0 }, /threshold.*positive finite number/],
      [{ enabled: true, threshold: -1 }, /threshold.*positive finite number/],
      [{ enabled: true, threshold: Infinity }, /threshold.*positive finite number/],
    ];
    for (const [bad, pattern] of cases) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        magnitudeDrill: bad,
        sectors: [{ label: 'x' }],
      });
      expect(r.ok, `magnitudeDrill=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok) expect(r.reason, `magnitudeDrill=${JSON.stringify(bad)}`).toMatch(pattern);
    }
  });

  it('accepts an opt-in tiltDrill config and round-trips its fields', () => {
    // Same shape as magnitudeDrill; the validator threads the
    // field name through so error messages stay specific. Pinning
    // both fields side-by-side guards a future "merge them into
    // one autoDrill" refactor from silently dropping one path.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      tiltDrill: { enabled: true, threshold: 200 },
      sectors: [{ label: 'x' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.tiltDrill).toEqual({ enabled: true, threshold: 200 });
  });

  it('rejects malformed tiltDrill shapes with field-specific messages', () => {
    // Mirror of the magnitudeDrill table — same invariants, but
    // the error reason should name `tiltDrill` so a config author
    // sees which field is wrong when both are present.
    const cases: Array<[unknown, RegExp]> = [
      ['not-an-object', /"tiltDrill".*must be an object/],
      [{ enabled: 'yes', threshold: 200 }, /"tiltDrill\.enabled".*must be a boolean/],
      [{ enabled: true, threshold: -1 }, /"tiltDrill\.threshold".*positive finite number/],
    ];
    for (const [bad, pattern] of cases) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        tiltDrill: bad,
        sectors: [{ label: 'x' }],
      });
      expect(r.ok, `tiltDrill=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok) expect(r.reason, `tiltDrill=${JSON.stringify(bad)}`).toMatch(pattern);
    }
  });

  it('accepts both auto-drill fields concurrently', () => {
    // Lateral and tilt can both be enabled — either gesture
    // triggers drill. Pin so a future "exclusive" tweak fails here.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      magnitudeDrill: { enabled: true, threshold: 250 },
      tiltDrill: { enabled: true, threshold: 200 },
      sectors: [{ label: 'x' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.magnitudeDrill).toEqual({ enabled: true, threshold: 250 });
      expect(r.config.tiltDrill).toEqual({ enabled: true, threshold: 200 });
    }
  });

  it('accepts a config nested exactly to MAX_MENU_DEPTH', () => {
    // Boundary spec: the deepest leaf sits at depth = MAX_MENU_DEPTH.
    // Pin so a future "off-by-one tightening" of the cap would
    // surface here rather than silently rejecting menus that were
    // valid yesterday.
    const leaf = {
      label: 'leaf',
      binding: { action: builtinAction('exec'), config: { command: 'x' } },
    };
    let node: Record<string, unknown> = leaf;
    for (let d = 0; d < MAX_MENU_DEPTH; d++) {
      node = { label: `L${d}`, children: [node] };
    }
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [node],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a config one level deeper than MAX_MENU_DEPTH', () => {
    // Construct exactly MAX_MENU_DEPTH + 1 levels of nesting under
    // a single top-level branch. The reason should name both the
    // configured cap and the actual depth that triggered the
    // rejection so a config author can see how far over the cap
    // they went without counting `child` tokens in the path.
    const leaf = {
      label: 'leaf',
      binding: { action: builtinAction('exec'), config: { command: 'x' } },
    };
    let node: Record<string, unknown> = leaf;
    for (let d = 0; d <= MAX_MENU_DEPTH; d++) {
      node = { label: `L${d}`, children: [node] };
    }
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      sectors: [node],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('exceeds maximum nesting depth');
      expect(r.reason).toContain(String(MAX_MENU_DEPTH));
      expect(r.reason).toContain(`(got ${MAX_MENU_DEPTH + 1})`);
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
