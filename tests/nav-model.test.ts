// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  editNavigation,
  inspectNavInput,
  navEditTouchesNavigation,
  navInputOptions,
} from '../src/core/nav-model';
import type { NavEditTarget } from '../src/shared/nav-ui';
import { FALLBACK_BUTTON_COUNT } from '../src/core/nav-input';
import {
  AIMING_NAVIGATION,
  DEFAULT_GESTURE_THRESHOLD,
  DEFAULT_MENU_CONFIG,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  resolveNavigation,
  type MenuConfig,
  type MenuNavigation,
  type MenuNode,
} from '../src/shared/menu';

const cfg = (branches: MenuNode[], extra: Partial<MenuConfig> = {}): MenuConfig => ({
  ...DEFAULT_MENU_CONFIG,
  root: { label: 'Centre', branches },
  ...extra,
});

const nav = (mutate: (n: MenuNavigation) => void): MenuNavigation => {
  const n = structuredClone(resolveNavigation(DEFAULT_MENU_CONFIG)) as MenuNavigation;
  mutate(n);
  return n;
};

describe('navInputOptions (#457 C3)', () => {
  it('offers none + buttons + axes + magnitudes, grouped', () => {
    const options = navInputOptions({ kind: 'none' }, 4, false);
    expect(options[0]).toEqual({ value: 'none', label: 'None' });
    expect(options.filter((o) => o.group === 'Buttons')).toHaveLength(4);
    expect(options.filter((o) => o.group === 'Axes')).toHaveLength(18); // 6 axes x 3 directions
    expect(options.filter((o) => o.group === 'Magnitude')).toHaveLength(2);
  });

  it('appends a stale device button as a disabled option', () => {
    const options = navInputOptions({ kind: 'button', button: 9 }, 4, false);
    const stale = options.find((o) => o.value === 'button:9');
    expect(stale?.disabled).toBe(true);
    expect(stale?.label).toContain('unavailable');
  });

  it('axisOnly offers none + axes and flags a carried-over non-axis value', () => {
    const options = navInputOptions({ kind: 'magnitude', source: 'tilt', threshold: 150 }, 4, true);
    expect(options.some((o) => o.group === 'Buttons')).toBe(false);
    expect(options.some((o) => o.group === 'Magnitude')).toBe(false);
    const flagged = options.find((o) => o.value === 'magnitude:tilt');
    expect(flagged?.disabled).toBe(true);
  });
});

describe('inspectNavInput (#457 C3)', () => {
  it('falls back to the default button range without a device', () => {
    expect(inspectNavInput(cfg([{ label: 'A' }]), null, 0).buttonsOffered).toBe(
      FALLBACK_BUTTON_COUNT,
    );
    expect(inspectNavInput(cfg([{ label: 'A' }]), null, 3).buttonsOffered).toBe(3);
  });

  it('marks a double-booked trigger with the unified hard conflict', () => {
    // Button 0 is both the trigger (toggle mode; the shipped default is
    // open-only, where the trigger may freely share) and the global back.
    const config = cfg([{ label: 'A' }], {
      triggerButton: 0,
      triggerMode: 'toggle',
      navigation: nav((n) => {
        n.back.inputs = [{ kind: 'button', button: 0 }];
      }),
    });
    const m = inspectNavInput(config, null, 4);
    const opt0 = m.menuSettings.trigger.options.find((o) => o.value === '0');
    expect(opt0?.conflict?.severity).toBe('hard');
    expect(opt0?.conflict?.message).toContain('Go back');
    expect(m.menuSettings.trigger.conflictNote).toContain('Go back');
  });

  it('frees the trigger in open-only mode (no conflict marking)', () => {
    const config = cfg([{ label: 'A' }], {
      triggerButton: 0,
      triggerMode: 'open',
      navigation: nav((n) => {
        n.back.inputs = [{ kind: 'button', button: 0 }];
      }),
    });
    const m = inspectNavInput(config, null, 4);
    expect(m.menuSettings.trigger.options.find((o) => o.value === '0')?.conflict).toBeNull();
    expect(m.menuSettings.trigger.conflictNote).toBeNull();
  });

  it('flags an out-of-range saved trigger with a disabled option + range error', () => {
    const config = cfg([{ label: 'A' }], { triggerButton: 6 });
    const m = inspectNavInput(config, null, 2);
    expect(m.menuSettings.trigger.rangeError).toContain('2 buttons');
    const stale = m.menuSettings.trigger.options.find((o) => o.value === '6');
    expect(stale?.disabled).toBe(true);
  });

  it('matches the built-in style and reports custom otherwise', () => {
    const aiming = cfg([{ label: 'A' }], { navigation: structuredClone(AIMING_NAVIGATION) });
    expect(inspectNavInput(aiming, null, 0).style.value).toBe('aiming');
    const custom = cfg([{ label: 'A' }], { navigation: nav((n) => (n.deadzone += 5)) });
    const m = inspectNavInput(custom, null, 0);
    expect(m.style.value).toBe('custom');
    expect(m.style.options[0]).toMatchObject({ value: 'custom', disabled: true });
    // The prebuilt Custom entry rides along for the editor's sticky-custom
    // display (shown even while a preset matches).
    expect(inspectNavInput(aiming, null, 0).style.customOption).toMatchObject({
      value: 'custom',
      disabled: true,
    });
  });

  it('disables the deadzone + warns for twist aiming without a cycle axis', () => {
    const config = cfg([{ label: 'A' }], {
      navigation: nav((n) => {
        n.aim = 'twist';
        n.cycle.inputs = [];
      }),
    });
    const m = inspectNavInput(config, null, 0);
    expect(m.deadzone.disabled).toBe(true);
    expect(m.deadzone.note).toBeNull();
    expect(m.twistWarning).not.toBeNull();
  });

  it('marks a gesture rivalry on the owning row with the unified soft conflict', () => {
    // drillIn and back share TZ−: the higher-priority gesture's row carries it.
    const config = cfg([{ label: 'A' }], {
      navigation: nav((n) => {
        n.drillIn.inputs = [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 200 }];
        n.back.inputs = [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 200 }];
      }),
    });
    const m = inspectNavInput(config, null, 0);
    const flagged = m.gestures.flatMap((g) => g.list.rows).filter((r) => r.conflict !== null);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged[0]!.conflict?.severity).toBe('soft');
    expect(flagged[0]!.conflict?.message).toContain('they may fight');
  });

  it('serves the per-item lists for a node path and the commit list for the centre', () => {
    const config = cfg([
      {
        label: 'A',
        action: { id: 'p/a' },
        activation: { inputs: [{ kind: 'button', button: 1 }] },
      },
    ]);
    const forNode = inspectNavInput(config, [0], 4);
    expect(forNode.node?.activation.rows[0]?.value).toBe('button:1');
    expect(forNode.centre).toBeNull();
    const forCentre = inspectNavInput(config, [], 4);
    expect(forCentre.centre?.commit.rows.length).toBeGreaterThan(0);
    expect(forCentre.node).toBeNull();
    expect(inspectNavInput(config, null, 4).node).toBeNull();
  });

  it('warns when a per-item binding shadows a global gesture', () => {
    const config = cfg(
      [
        {
          label: 'A',
          action: { id: 'p/a' },
          activation: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 150 }] },
        },
      ],
      {
        navigation: nav((n) => {
          n.back.inputs = [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 150 }];
        }),
      },
    );
    const m = inspectNavInput(config, [0], 0);
    expect(m.node?.activation.warnings.some((w) => w.includes('wins here'))).toBe(true);
  });
});

describe('plugin nav-style presets in the quick-pick (#195)', () => {
  const presetNav = nav((n) => {
    n.aim = 'twist';
    n.cycle.inputs = [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }];
  });
  const plugins = {
    plugins: [
      {
        id: 'org.x.styles',
        name: 'Twist pack',
        version: '1.0.0',
        kind: 'nav-style',
        dir: '/tmp/p',
        removable: true,
        trust: 'community',
        permissions: [],
        actionCount: 0,
        hasMenu: false,
        hasCatalog: false,
        hasBridge: false,
        navStylePresets: [
          { id: 'twist', label: 'Twist', description: 'Twist everything.', navigation: presetNav },
        ],
      },
    ],
    errors: [],
  } as never;

  it('lists the preset namespaced under "From plugins" and matches it', () => {
    const config = cfg([{ label: 'A' }], { navigation: structuredClone(presetNav) });
    const m = inspectNavInput(config, null, 0, plugins);
    expect(m.style.value).toBe('org.x.styles/twist');
    const opt = m.style.options.find((o) => o.value === 'org.x.styles/twist');
    expect(opt).toMatchObject({ label: 'Twist · Twist pack', group: 'From plugins' });
    expect(m.style.description).toBe('Twist everything.');
  });

  it('applies a plugin preset by its namespaced key', () => {
    const applied = editNavigation(
      cfg([{ label: 'A' }]),
      { kind: 'applyPreset', presetId: 'org.x.styles/twist' },
      plugins,
    );
    expect(applied.navigation).toEqual(presetNav);
    const unknown = cfg([{ label: 'A' }]);
    expect(
      editNavigation(unknown, { kind: 'applyPreset', presetId: 'org.x.styles/nope' }, plugins),
    ).toBe(unknown);
  });

  it('keeps built-ins first: the aiming preset resolves without the plugins arg', () => {
    const applied = editNavigation(
      cfg([{ label: 'A' }]),
      { kind: 'applyPreset', presetId: 'aiming' },
      plugins,
    );
    expect(applied.navigation).toEqual(AIMING_NAVIGATION);
  });
});

describe('navEditTouchesNavigation (sticky-custom style display)', () => {
  it('classifies ops by whether they touch the preset-matched block', () => {
    expect(navEditTouchesNavigation({ kind: 'setAim', aim: 'tilt' })).toBe(true);
    expect(navEditTouchesNavigation({ kind: 'setDeadzone', hover: 1, open: 2 })).toBe(true);
    expect(navEditTouchesNavigation({ kind: 'applyPreset', presetId: 'aiming' })).toBe(true);
    expect(
      navEditTouchesNavigation({
        kind: 'addInput',
        target: { scope: 'nav', gesture: 'commitCenter' },
      }),
    ).toBe(true);
    expect(navEditTouchesNavigation({ kind: 'setTriggerButton', button: 1 })).toBe(false);
    expect(navEditTouchesNavigation({ kind: 'setTriggerMode', mode: 'open' })).toBe(false);
    expect(
      navEditTouchesNavigation({
        kind: 'addInput',
        target: { scope: 'node', path: [0], binding: 'exit' },
      }),
    ).toBe(false);
  });
});

describe('editNavigation (#457 C3)', () => {
  const base = (): MenuConfig => cfg([{ label: 'A', action: { id: 'p/a' } }]);

  it('sets aim / deadzone / cycle priority by materialising the navigation', () => {
    const aimed = editNavigation(base(), { kind: 'setAim', aim: 'tilt' });
    expect(aimed.navigation?.aim).toBe('tilt');
    const dz = editNavigation(base(), { kind: 'setDeadzone', hover: 40, open: 90 });
    expect(dz.navigation?.hoverDeadzone).toBe(40);
    expect(dz.navigation?.deadzone).toBe(90);
    const prio = editNavigation(base(), { kind: 'setCyclePriority', priority: 'twist' });
    expect(prio.navigation?.cycle.priority).toBe('twist');
  });

  it('sets the trigger button / mode and applies a preset', () => {
    expect(editNavigation(base(), { kind: 'setTriggerButton', button: 3 }).triggerButton).toBe(3);
    expect(editNavigation(base(), { kind: 'setTriggerMode', mode: 'open' }).triggerMode).toBe(
      'open',
    );
    const preset = editNavigation(base(), { kind: 'applyPreset', presetId: 'aiming' });
    expect(preset.navigation).toEqual(AIMING_NAVIGATION);
    const unknown = base();
    expect(editNavigation(unknown, { kind: 'applyPreset', presetId: 'nope' })).toBe(unknown);
  });

  it('decodes a picked input value and carries the threshold across a kind change', () => {
    // The aiming default ships drillIn without inputs (the aim itself drills),
    // so add a row first, like the editor's "+ Add input".
    const seeded = editNavigation(base(), {
      kind: 'addInput',
      target: { scope: 'nav', gesture: 'drillIn' },
    });
    const withAxis = editNavigation(seeded, {
      kind: 'setInput',
      target: { scope: 'nav', gesture: 'drillIn' },
      index: 0,
      value: 'axis:rz:positive',
    });
    const input = withAxis.navigation?.drillIn.inputs[0];
    expect(input).toMatchObject({ kind: 'axis', axis: 'rz', direction: 'positive' });
    // The default drill threshold seeds when nothing carries over; flipping the
    // direction afterwards keeps a tuned threshold.
    const tuned = editNavigation(withAxis, {
      kind: 'setThreshold',
      target: { scope: 'nav', gesture: 'drillIn' },
      index: 0,
      threshold: 333,
    });
    const flipped = editNavigation(tuned, {
      kind: 'setInput',
      target: { scope: 'nav', gesture: 'drillIn' },
      index: 0,
      value: 'axis:rz:negative',
    });
    expect(flipped.navigation?.drillIn.inputs[0]).toMatchObject({
      direction: 'negative',
      threshold: 333,
    });
  });

  it('seeds the per-gesture default threshold (cycle lower than the drills)', () => {
    const drillRow = editNavigation(base(), {
      kind: 'addInput',
      target: { scope: 'nav', gesture: 'drillIn' },
    });
    const drill = editNavigation(drillRow, {
      kind: 'setInput',
      target: { scope: 'nav', gesture: 'drillIn' },
      index: 0,
      value: 'magnitude:lateral',
    });
    const drillInput = drill.navigation?.drillIn.inputs[0];
    expect(drillInput?.kind === 'magnitude' && drillInput.threshold).toBe(
      DEFAULT_GESTURE_THRESHOLD,
    );
    const cycleRow = editNavigation(base(), {
      kind: 'addInput',
      target: { scope: 'nav', gesture: 'cycle' },
    });
    const seeded = editNavigation(cycleRow, {
      kind: 'setInput',
      target: { scope: 'nav', gesture: 'cycle' },
      index: 0,
      value: 'axis:rz:both',
    });
    const cycleInput = seeded.navigation?.cycle.inputs[0];
    expect(cycleInput?.kind === 'axis' && cycleInput.threshold).toBe(DEFAULT_TWIST_CYCLE_THRESHOLD);
  });

  it('adds / removes navigation inputs and node bindings (created + dropped)', () => {
    const added = editNavigation(base(), {
      kind: 'addInput',
      target: { scope: 'nav', gesture: 'activate' },
    });
    const before = resolveNavigation(base()).activate.inputs.length;
    expect(added.navigation?.activate.inputs.length).toBe(before + 1);

    // Node binding: first add creates it, removing the last input drops it.
    const target: NavEditTarget = { scope: 'node', path: [0], binding: 'activation' };
    const withBinding = editNavigation(base(), { kind: 'addInput', target });
    const node = withBinding.root.branches![0]!;
    expect(node.activation?.inputs).toEqual([{ kind: 'none' }]);
    const set = editNavigation(withBinding, {
      kind: 'setInput',
      target,
      index: 0,
      value: 'button:2',
    });
    expect(set.root.branches![0]!.activation?.inputs[0]).toEqual({ kind: 'button', button: 2 });
    const dropped = editNavigation(set, { kind: 'removeInput', target, index: 0 });
    expect(dropped.root.branches![0]!.activation).toBeUndefined();
  });

  it('rejects invalid ops by identity', () => {
    const config = base();
    expect(
      editNavigation(config, {
        kind: 'removeInput',
        target: { scope: 'nav', gesture: 'activate' },
        index: 99,
      }),
    ).toBe(config);
    expect(
      editNavigation(config, {
        kind: 'setThreshold',
        target: { scope: 'nav', gesture: 'back' },
        index: 0,
        threshold: -5,
      }),
    ).toBe(config);
    expect(
      editNavigation(config, {
        kind: 'setInput',
        target: { scope: 'node', path: [9], binding: 'exit' },
        index: 0,
        value: 'none',
      }),
    ).toBe(config);
  });
});
