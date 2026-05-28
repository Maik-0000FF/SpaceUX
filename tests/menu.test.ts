// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  BUILTIN_ACTION,
  BUILTIN_PLUGIN_ID,
  DEFAULT_AXIS_INVERT,
  DEFAULT_MENU_CONFIG,
  DEFAULT_TRIGGER_BUTTON,
  MAX_MENU_DEPTH,
  MENU_CONFIG_VERSION,
  builtinAction,
  isCancelNode,
  resolveAxisInvert,
  resolveShapeModel,
  validateMenuConfig,
} from '../src/shared/menu';

describe('validateMenuConfig', () => {
  it('accepts the factory default config', () => {
    const result = validateMenuConfig(DEFAULT_MENU_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.version).toBe(MENU_CONFIG_VERSION);
      expect(result.config.root.branches).toEqual(DEFAULT_MENU_CONFIG.root.branches);
    }
  });

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 42, 'hello', [1, 2, 3]]) {
      const result = validateMenuConfig(bad);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a missing or wrong version', () => {
    expect(validateMenuConfig({ root: { label: '', branches: [] } }).ok).toBe(false);
    expect(validateMenuConfig({ version: 'one', root: { label: '', branches: [] } }).ok).toBe(
      false,
    );
    expect(
      validateMenuConfig({ version: 999, root: { label: '', branches: [{ label: 'x' }] } }).ok,
    ).toBe(false);
  });

  it('rejects a root with no branches field', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '' }, // branches missing entirely
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a root with an empty branches array — just the centre (#160)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.branches).toEqual([]);
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
        root: { label: '', branches: [{ label }] },
      });
      expect(r.ok, `label=${JSON.stringify(label)}`).toBe(true);
      if (r.ok) {
        const node = r.config.root.branches![0];
        expect(node?.label).toBe(label);
      }
    }
  });

  it('rejects a node with no label', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{}] },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a node with a blank label and no icon', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: '   ' }] },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts an icon-only node (blank label + icon)', () => {
    // An item identified by its icon alone is valid — a node only needs a
    // non-empty label OR an icon, so icon-only menus (e.g. FreeCAD commands)
    // are allowed.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: '', icon: 'data:image/png;base64,iVBOR' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.branches?.[0]?.icon).toBe('data:image/png;base64,iVBOR');
  });

  it('rejects a blank label with a non-renderable icon (would draw nothing)', () => {
    // The icon-only allowance uses the renderer's predicate: a non-data: icon
    // (e.g. a legacy theme-icon name) renders nothing, so it can't stand in
    // for a label.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: '', icon: 'box' }] },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a node without a binding (label-only)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'Just a label' }] },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a binding without an action field', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x', action: {} }] },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a binding with a non-object config', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'x',
            action: { id: builtinAction('exec'), config: 'not-an-object' },
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it('drops node.icon when it is not a string', () => {
    // Strictly the validator rejects the wrong type rather than
    // silently dropping; pin that contract.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x', icon: 42 }] },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a config without triggerButton (field is optional)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.triggerButton).toBeUndefined();
  });

  it('accepts a non-negative integer triggerButton', () => {
    for (const v of [0, 1, 7]) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        triggerButton: v,
        root: { label: '', branches: [{ label: 'x' }] },
      });
      expect(r.ok, `triggerButton=${v}`).toBe(true);
      if (r.ok) expect(r.config.triggerButton).toBe(v);
    }
  });

  it('accepts a valid triggerMode and rejects an unknown one', () => {
    const at = (triggerMode: unknown) =>
      validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        triggerMode,
        root: { label: '', branches: [{ label: 'x' }] },
      });
    for (const v of ['toggle', 'open']) {
      const r = at(v);
      expect(r.ok, `triggerMode=${v}`).toBe(true);
      if (r.ok) expect(r.config.triggerMode).toBe(v);
    }
    expect(at('sometimes').ok).toBe(false);
    expect(at(1).ok).toBe(false);
    // Optional: omitting it is fine.
    const none = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.config.triggerMode).toBeUndefined();
  });

  it('ignores a legacy "scale" field (moved to PieAppearance) without rejecting', () => {
    // #186 follow-up: pie size moved to the global appearance. An old menu.json
    // with `scale` must still load (tolerated legacy field) — the value is just
    // dropped, not validated, and never surfaces on the config.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      scale: 1.5,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect('scale' in r.config).toBe(false);
  });

  it('rejects negative, fractional, or non-number triggerButton', () => {
    for (const bad of [-1, 1.5, '0', null, true]) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        triggerButton: bad,
        root: { label: '', branches: [{ label: 'x' }] },
      });
      expect(r.ok, `triggerButton=${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe('isCancelNode', () => {
  it('is true only for a binding on the built-in cancel action', () => {
    expect(isCancelNode({ action: { id: builtinAction('cancel') } })).toBe(true);
    expect(isCancelNode({ action: { id: builtinAction('exec') } })).toBe(false);
    expect(isCancelNode({ action: { id: 'some.plugin/cancel' } })).toBe(false);
    expect(isCancelNode({})).toBe(false);
  });
});

describe('validateMenuConfig — nested submenus', () => {
  it('accepts a node whose only role is to host children (branch)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'FreeCAD',
            branches: [
              { label: 'New', action: { id: builtinAction('exec'), config: { command: 'x' } } },
              { label: 'Open', action: { id: builtinAction('exec'), config: { command: 'y' } } },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const branch = r.config.root.branches![0];
      expect(branch?.branches).toHaveLength(2);
      expect(branch?.action).toBeUndefined();
    }
  });

  it('rejects a non-root node that declares both action and branches', () => {
    // Submenu vs leaf must be unambiguous so the renderer doesn't
    // have to decide which one wins on commit. (The root is exempt —
    // it may carry both; tested in the root describe.)
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'Ambiguous',
            action: { id: builtinAction('exec'), config: { command: 'x' } },
            branches: [{ label: 'Child' }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/either "action" or "branches", not both/);
  });

  it('rejects an empty branches array (would render as a hole with no escape)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'Empty branch', branches: [] }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"branches" must not be empty/);
  });

  it('keeps keepOpen=true on a leaf node', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'Vol+',
            action: { id: builtinAction('key-combo'), config: { keys: 'XF86AudioRaiseVolume' } },
            keepOpen: true,
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.branches![0]?.keepOpen).toBe(true);
  });

  it('drops keepOpen when false, on a branch, or on a binding-less leaf', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          { label: 'Off', action: { id: builtinAction('exec') }, keepOpen: false },
          { label: 'Branch', branches: [{ label: 'Child' }], keepOpen: true },
          // Label-only leaf: commits to nothing, so keeping the menu open
          // would strand the user — the flag must not persist here.
          { label: 'Label only', keepOpen: true },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.root.branches![0]?.keepOpen).toBeUndefined();
      expect(r.config.root.branches![1]?.keepOpen).toBeUndefined();
      expect(r.config.root.branches![2]?.keepOpen).toBeUndefined();
    }
  });

  it('rejects a non-boolean keepOpen', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x', keepOpen: 'yes' }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"keepOpen" must be a boolean/);
  });

  it('keeps a per-item activation binding on a leaf with a binding', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'Vol',
            action: { id: builtinAction('key-combo'), config: { keys: 'XF86AudioRaiseVolume' } },
            activation: {
              inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }],
            },
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.branches![0]?.activation?.inputs).toHaveLength(1);
  });

  it('drops activation on a branch, a binding-less leaf, or with no inputs', () => {
    const act = { inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }] };
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          { label: 'Branch', branches: [{ label: 'C' }], activation: act },
          { label: 'Label only', activation: act },
          { label: 'Empty', action: { id: builtinAction('exec') }, activation: { inputs: [] } },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.root.branches![0]?.activation).toBeUndefined();
      expect(r.config.root.branches![1]?.activation).toBeUndefined();
      expect(r.config.root.branches![2]?.activation).toBeUndefined();
    }
  });

  it('rejects a malformed activation input', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'x',
            action: { id: builtinAction('exec') },
            activation: {
              inputs: [{ kind: 'axis', axis: 'nope', direction: 'negative', threshold: 50 }],
            },
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it('keeps a per-item exit on any node (leaf or branch) with inputs', () => {
    const exit = {
      inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }],
    };
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          { label: 'Leaf', action: { id: builtinAction('exec') }, exit },
          { label: 'Branch', branches: [{ label: 'C' }], exit },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.root.branches![0]?.exit?.inputs).toHaveLength(1);
      expect(r.config.root.branches![1]?.exit?.inputs).toHaveLength(1);
    }
  });

  it('drops an exit with no inputs', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x', exit: { inputs: [] } }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.branches![0]?.exit).toBeUndefined();
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
        root: { label: '', branches: [{ label: 'x', branches: bad }] },
      });
      expect(r.ok, `branches=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok)
        expect(r.reason, `branches=${JSON.stringify(bad)}`).toMatch(
          /"branches" must be an array when present/,
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
      root: {
        label: '',
        branches: [
          {
            label: 'top',
            branches: [
              {
                label: 'mid',
                branches: [{ label: '' }], // blank label at depth 2
              },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('root branch 0 branch 0 branch 0');
      expect(r.reason).toContain('"label"');
    }
  });

  it('accepts a config nested exactly to MAX_MENU_DEPTH', () => {
    // Boundary spec: the deepest leaf sits at depth = MAX_MENU_DEPTH.
    // Pin so a future "off-by-one tightening" of the cap would
    // surface here rather than silently rejecting menus that were
    // valid yesterday.
    const leaf = {
      label: 'leaf',
      action: { id: builtinAction('exec'), config: { command: 'x' } },
    };
    let node: Record<string, unknown> = leaf;
    for (let d = 0; d < MAX_MENU_DEPTH; d++) {
      node = { label: `L${d}`, branches: [node] };
    }
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [node] },
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
      action: { id: builtinAction('exec'), config: { command: 'x' } },
    };
    let node: Record<string, unknown> = leaf;
    for (let d = 0; d <= MAX_MENU_DEPTH; d++) {
      node = { label: `L${d}`, branches: [node] };
    }
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [node] },
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
      root: {
        label: '',
        branches: [
          {
            label: 'L0',
            branches: [
              {
                label: 'L1',
                branches: [
                  {
                    label: 'L2',
                    action: { id: builtinAction('exec'), config: { command: 'deep' } },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateMenuConfig — root centre', () => {
  it('has no action when the root omits one (historical cancel behavior)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.action).toBeUndefined();
  });

  it('accepts a root centre label + action (coexisting with branches) and round-trips both', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: 'Close',
        action: { id: builtinAction(BUILTIN_ACTION.CANCEL) },
        branches: [{ label: 'x' }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.root.label).toBe('Close');
      expect(r.config.root.action).toEqual({
        id: builtinAction(BUILTIN_ACTION.CANCEL),
      });
    }
  });

  it('accepts an empty root label (renderer falls back to ✕)', () => {
    // The root label is optional; an empty string is preserved and the
    // renderer renders the historical ✕ glyph in its place.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.label).toBe('');
  });

  it('accepts a root action to any action, not just cancel', () => {
    // The centre is a fully configurable target — pin that a non-cancel
    // action is accepted so a future "centre must be cancel" tightening
    // has to delete this test rather than silently regress.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        action: { id: builtinAction('exec'), config: { command: 'x' } },
        branches: [{ label: 'x' }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.root.action?.id).toBe(builtinAction('exec'));
  });

  it('rejects malformed root shapes', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not-an-object', /root is not an object/],
      [{ branches: [{ label: 'x' }], label: 42 }, /"label".*must be a string/],
      [{ branches: [{ label: 'x' }], icon: 42 }, /"icon".*must be a string/],
      [{ branches: [{ label: 'x' }], action: {} }, /action.*"id".*non-empty string/],
      [{ label: 'x' }, /"branches".*must be an array/], // root must have a branches array (may be empty)
    ];
    for (const [bad, pattern] of cases) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        root: bad,
      });
      expect(r.ok, `root=${JSON.stringify(bad)}`).toBe(false);
      if (!r.ok) expect(r.reason, `root=${JSON.stringify(bad)}`).toMatch(pattern);
    }
  });

  it('rejects a missing root entirely', () => {
    const r = validateMenuConfig({ version: MENU_CONFIG_VERSION });
    expect(r.ok).toBe(false);
  });
});

describe('validateMenuConfig — navigation (issue #105)', () => {
  it('accepts a full navigation block and round-trips every gesture', () => {
    const navigation = {
      aim: 'both',
      deadzone: 120,
      hoverDeadzone: 60,
      drillIn: { inputs: [{ kind: 'magnitude', source: 'lateral', threshold: 250 }] },
      back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
      cycle: {
        inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
        priority: 'twist',
      },
      commitCenter: { inputs: [{ kind: 'button', button: 2 }] },
      activate: { inputs: [{ kind: 'button', button: 0 }] },
    };
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.navigation).toEqual(navigation);
  });

  it('defaults omitted gestures to unbound (empty inputs) and aim to push', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { drillIn: { inputs: [{ kind: 'none' }] } },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.navigation).toEqual({
        aim: 'push',
        deadzone: 50,
        hoverDeadzone: 25,
        drillIn: { inputs: [{ kind: 'none' }] },
        back: { inputs: [] },
        cycle: { inputs: [], priority: 'lateral' },
        commitCenter: { inputs: [] },
        activate: { inputs: [] },
      });
    }
  });

  it('clamps an out-of-range deadzone and rejects a non-number (#160)', () => {
    const tooBig = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { deadzone: 9999 },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(tooBig.ok).toBe(true);
    if (tooBig.ok) expect(tooBig.config.navigation?.deadzone).toBe(500); // MAX_LATERAL_DEADZONE

    const bad = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { deadzone: 'wide' },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/"deadzone" must be a finite number/);
  });

  it('clamps hoverDeadzone to <= the engage deadzone (#160)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { deadzone: 60, hoverDeadzone: 200 }, // hover asked higher than engage
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.navigation?.deadzone).toBe(60);
      expect(r.config.navigation?.hoverDeadzone).toBe(60); // pulled down to engage
    }
  });

  it('rejects an unknown aim source (#159)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { aim: 'sideways' },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"aim" must be one of/);
  });

  it('warns (but accepts) twist aiming with no axis bound to cycle (#159)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: { aim: 'twist' }, // cycle defaults to unbound
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true); // permissive: never rejects
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('aim is "twist"'));
    warnSpy.mockRestore();
  });

  it('does NOT warn for twist aiming once an axis is bound to cycle (#159)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        aim: 'twist',
        cycle: { inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }] },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('aim is "twist"'));
    warnSpy.mockRestore();
  });

  it('rejects malformed input bindings (structural errors are hard rejections)', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ drillIn: { inputs: [{ kind: 'wat' }] } }, /"kind" must be one of/],
      [
        { back: { inputs: [{ kind: 'axis', axis: 'zz', direction: 'both', threshold: 1 }] } },
        /"axis" must be one of/,
      ],
      [
        { commitCenter: { inputs: [{ kind: 'button', button: -1 }] } },
        /"button".*non-negative integer/,
      ],
      [
        { drillIn: { inputs: [{ kind: 'magnitude', source: 'nope', threshold: 1 }] } },
        /"source" must be one of/,
      ],
      [
        { drillIn: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 0 }] } },
        /"threshold".*positive finite number/,
      ],
      [{ cycle: { inputs: [], priority: 'sideways' } }, /"priority" must be one of/],
      [{ drillIn: { inputs: 'not-an-array' } }, /"inputs" must be an array/],
      // A present-but-null gesture is rejected (not silently coerced to
      // unbound) — only an *omitted* gesture defaults to empty.
      [{ drillIn: null }, /drillIn must be an object/],
    ];
    for (const [nav, pattern] of cases) {
      const r = validateMenuConfig({
        version: MENU_CONFIG_VERSION,
        navigation: nav,
        root: { label: '', branches: [{ label: 'x' }] },
      });
      expect(r.ok, `navigation=${JSON.stringify(nav)}`).toBe(false);
      if (!r.ok) expect(r.reason, `navigation=${JSON.stringify(nav)}`).toMatch(pattern);
    }
  });

  it('warns (but accepts) when two gestures bind the same axis half', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        drillIn: { inputs: [{ kind: 'axis', axis: 'rz', direction: 'positive', threshold: 200 }] },
        commitCenter: {
          inputs: [{ kind: 'axis', axis: 'rz', direction: 'positive', threshold: 200 }],
        },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true); // permissive: a conflict never rejects
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('both bind axis:rz:positive'));
    warnSpy.mockRestore();
  });

  it('does NOT warn for drillIn + activate sharing a button — disjoint by node type (#160)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        // The twist styles' "button 0 drills a branch / fires a leaf" combo:
        // a node is never both, so the shared input can't fire both.
        drillIn: { inputs: [{ kind: 'button', button: 0 }] },
        activate: { inputs: [{ kind: 'button', button: 0 }] },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('both bind button:0'));
    warnSpy.mockRestore();
  });

  it('still warns for a real conflict — back + activate on the same button (#160)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        back: { inputs: [{ kind: 'button', button: 1 }] },
        activate: { inputs: [{ kind: 'button', button: 1 }] },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('both bind button:1'));
    warnSpy.mockRestore();
  });

  it('warns when a both-axis binding overlaps a directional one on the same axis', () => {
    // `both` occupies the whole axis, so it collides with a positive
    // binding even though their direction strings differ.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        drillIn: { inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 200 }] },
        commitCenter: {
          inputs: [{ kind: 'axis', axis: 'rz', direction: 'positive', threshold: 200 }],
        },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('both bind axis:rz:positive'));
    warnSpy.mockRestore();
  });

  it('does NOT warn for a legitimate direction split on one axis', () => {
    // RZ-up on one gesture, RZ-down on another can never both be active,
    // so the split-axis setups the feature encourages stay quiet.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      navigation: {
        drillIn: { inputs: [{ kind: 'axis', axis: 'rz', direction: 'positive', threshold: 200 }] },
        commitCenter: {
          inputs: [{ kind: 'axis', axis: 'rz', direction: 'negative', threshold: 200 }],
        },
      },
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('both bind'));
    warnSpy.mockRestore();
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

describe('resolveShapeModel (#107)', () => {
  // Three-state per-menu override layered over the app-level appearance:
  //   undefined → inherit, null → force wedge, string → force plugin.
  // The resolver is pure; the renderer takes care of falling back to
  // wedge when the resolved string doesn't match an installed plugin.

  it('inherits the appearance default when the menu omits the field', () => {
    expect(resolveShapeModel(undefined, null)).toBeNull();
    expect(resolveShapeModel(undefined, 'org.spaceux.planets/planets')).toBe(
      'org.spaceux.planets/planets',
    );
  });

  it('forces wedge when the menu explicitly sets null, regardless of appearance', () => {
    expect(resolveShapeModel(null, null)).toBeNull();
    // Per-menu null overrides an appearance pointing at a plugin shape.
    expect(resolveShapeModel(null, 'org.spaceux.planets/planets')).toBeNull();
  });

  it('forces a plugin shape when the menu sets one, regardless of appearance', () => {
    expect(resolveShapeModel('org.example.other/x', null)).toBe('org.example.other/x');
    expect(resolveShapeModel('org.example.other/x', 'org.spaceux.planets/planets')).toBe(
      'org.example.other/x',
    );
  });
});

describe('validateMenuConfig — shapeModel field (#107)', () => {
  function configWith(shapeModel: unknown): unknown {
    return {
      version: MENU_CONFIG_VERSION,
      shapeModel,
      root: { label: '', branches: [{ label: 'x' }] },
    };
  }

  it('accepts a null shapeModel (force wedge for this menu)', () => {
    const r = validateMenuConfig(configWith(null));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.shapeModel).toBeNull();
  });

  it('accepts a non-empty string shapeModel (force a plugin shape)', () => {
    const r = validateMenuConfig(configWith('org.spaceux.planets/planets'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.shapeModel).toBe('org.spaceux.planets/planets');
  });

  it('accepts an omitted shapeModel field (inherit semantics)', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.shapeModel).toBeUndefined();
  });

  it('rejects a non-string non-null shapeModel', () => {
    const r = validateMenuConfig(configWith(42));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/shapeModel/);
  });

  it('rejects an empty / whitespace-only string (use null or omit instead)', () => {
    expect(validateMenuConfig(configWith('')).ok).toBe(false);
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
    for (const node of DEFAULT_MENU_CONFIG.root.branches ?? []) {
      const action = node.action?.id;
      expect(action, `node "${node.label}" has no action`).toBeDefined();
      expect(known, `node "${node.label}" references unknown action ${action}`).toContain(action);
    }
  });
});

describe('validateMenuConfig — unknown-field diagnostics', () => {
  // Vitest's spy survives across `it` blocks unless we clear it, so
  // each test starts with a fresh capture and restores at the end.
  // Reaching for console.warn is the simplest way to assert the
  // "soft warning" contract without inventing a parallel logger
  // interface just for tests.
  let warnSpy: MockInstance<(...args: unknown[]) => void>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns for an unknown top-level field but still validates', () => {
    // The unknown field doesn't fail validation — backwards-compat
    // for users on a future schema bump that renames a field while
    // the old name still appears in their menu.json. The warning is
    // how they find out.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      unknwon: 'oops', // typo of "unknown" — any non-recognised key
      root: { label: '', branches: [{ label: 'x' }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[menu-loader] unknown field "unknwon" at menu config'),
    );
  });

  it('warns for an unknown field inside a node with the node path', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', branches: [{ label: 'x', bindings: { id: 'x' } }] },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[menu-loader] unknown field "bindings" at root branch 0'),
    );
  });

  it('warns for an unknown field inside an action with the action path', () => {
    // The validateActionRef warn-site uses `${where} action` —
    // a slightly different path shape from the node/config
    // levels. Pin it directly so a future refactor that drops the
    // "action" suffix (or changes the join character) fails here.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'x',
            action: {
              id: builtinAction('exec'),
              cofig: { command: 'x' }, // typo of "config"
            },
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[menu-loader] unknown field "cofig" at root branch 0 action'),
    );
  });

  it('threads the path through a deeply-nested unknown field', () => {
    // Unknown inside a grandchild surfaces with the full breadcrumb
    // — same path scheme the structural-error reasons use, so a
    // config author sees the same coordinate twice if their menu
    // has both a typo and a structural problem in the same node.
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: {
        label: '',
        branches: [
          {
            label: 'top',
            branches: [
              { label: 'mid', fakefield: 1 }, // unknown at root branch 0 branch 0
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[menu-loader] unknown field "fakefield" at root branch 0 branch 0'),
    );
  });

  it('warns for an unknown field on the root with the root path', () => {
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      root: { label: '', center: 'x', branches: [{ label: 'x' }] }, // unknown "center"
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[menu-loader] unknown field "center" at root'),
    );
  });

  it('does not warn when only known fields are present (every level)', () => {
    // Negative-space pin: every known field at every level is set
    // exactly once. If a future refactor accidentally drops a name
    // from any KNOWN_*_FIELDS list, this test catches the resulting
    // false-positive warn from that level. Two nodes cover both
    // node shapes — a leaf with icon + action, and a branch
    // with branches (the XOR with action is enforced upstream).
    const r = validateMenuConfig({
      version: MENU_CONFIG_VERSION,
      triggerButton: 0,
      axisInvert: { x: false, y: false },
      root: {
        label: '',
        branches: [
          {
            label: 'leaf',
            icon: 'app-icon',
            action: { id: builtinAction('exec'), config: { command: 'x' } },
          },
          {
            label: 'branch',
            branches: [
              {
                label: 'child',
                action: { id: builtinAction('exec'), config: { command: 'y' } },
              },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
