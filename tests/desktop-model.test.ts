// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { editDesktopSettings, inspectDesktopSettings } from '../src/core/desktop-model';
import { DEFAULT_DESKTOP_SETTINGS } from '../src/shared/desktop-settings';
import type { DesktopSettings } from '../src/shared/ipc';

const base = (mutate?: (d: DesktopSettings) => void): DesktopSettings => {
  const d = structuredClone(DEFAULT_DESKTOP_SETTINGS);
  mutate?.(d);
  return d;
};

describe('inspectDesktopSettings (#457 C4)', () => {
  it('renders activation off while disabled and the mode while enabled', () => {
    expect(inspectDesktopSettings(base(), 0, 4).activation.value).toBe('off');
    const on = base((d) => {
      d.enabled = true;
      d.activationMode = 'toggle';
      d.toggleButton = 1;
    });
    expect(inspectDesktopSettings(on, 0, 4).activation.value).toBe('toggle');
  });

  it('builds the toggle picker only in enabled toggle mode, trigger disabled', () => {
    expect(inspectDesktopSettings(base(), 0, 4).toggle).toBeNull();
    const on = base((d) => {
      d.enabled = true;
      d.activationMode = 'toggle';
      d.toggleButton = 9; // beyond the 4-button device
    });
    const toggle = inspectDesktopSettings(on, 0, 4).toggle;
    expect(toggle?.options.find((o) => o.value === '0')?.disabled).toBe(true);
    expect(toggle?.options.find((o) => o.value === '0')?.label).toContain('pie trigger');
    const stale = toggle?.options.find((o) => o.value === '9');
    expect(stale?.disabled).toBe(true);
    expect(stale?.label).toContain('unavailable');
  });

  it('shows only the chosen function fields per axis card', () => {
    const m = inspectDesktopSettings(base(), 0, 4);
    const byAxis = Object.fromEntries(m.axes.cards.map((c) => [c.axis, c]));
    expect(byAxis.ty!.fields).toEqual([]); // none
    expect(byAxis.rx!.fields.map((f) => f.key)).toEqual([
      'orientation',
      'deadzone',
      'speed',
      'curve',
      'invert',
    ]); // scroll
    expect(byAxis.rz!.fields.map((f) => f.key)).toEqual(['threshold', 'cooldownMs', 'invert']); // workspace
    expect(byAxis.tz!.fields.map((f) => f.key)).toEqual(['deadzone', 'speed', 'invert']); // zoom
  });

  it('marks conflicts with the unified shape (hard on the trigger, always on)', () => {
    const on = base((d) => {
      d.enabled = true;
      d.activationMode = 'always';
      d.buttons[0] = 'overview'; // button 0 = the pie trigger below
    });
    const m = inspectDesktopSettings(on, 0, 4);
    const row0 = m.buttons.rows[0]!;
    expect(row0.conflict?.severity).toBe('hard');
    expect(row0.blockedNote).not.toBeNull();
    expect(row0.options.find((o) => o.value === 'overview')?.disabled).toBe(true);
  });

  it('keeps a same-button pair of desktop bindings a soft conflict', () => {
    const on = base((d) => {
      d.enabled = true;
      d.activationMode = 'toggle';
      d.toggleButton = 2;
      d.buttons[2] = 'showDesktop';
    });
    const m = inspectDesktopSettings(on, 5, 4);
    expect(m.toggle?.conflict?.severity).toBe('soft');
    expect(m.buttons.rows[2]!.conflict?.severity).toBe('soft');
  });

  it('dims the body while disabled and uses the button-count fallback', () => {
    const m = inspectDesktopSettings(base(), 0, 0);
    expect(m.controlsEnabled).toBe(false);
    expect(m.buttons.rows.length).toBeGreaterThan(0);
  });
});

describe('editDesktopSettings (#457 C4)', () => {
  it('activation: off disables; toggle enables and seeds the first button', () => {
    const on = editDesktopSettings(base(), { kind: 'setActivation', value: 'toggle' });
    expect(on.settings.enabled).toBe(true);
    expect(on.settings.activationMode).toBe('toggle');
    expect(on.settings.toggleButton).toBe(0);
    const off = editDesktopSettings(on.settings, { kind: 'setActivation', value: 'off' });
    expect(off.settings.enabled).toBe(false);
    // The mode + button survive an off/on round trip.
    expect(off.settings.activationMode).toBe('toggle');
  });

  it('a kind change seeds the function defaults; a field edit clamps', () => {
    const scroll = editDesktopSettings(base(), { kind: 'setAxisKind', axis: 'ty', fn: 'scroll' });
    const fn = scroll.settings.axes.ty;
    expect(fn.kind === 'scroll' && fn.orientation).toBe('vertical');
    const sped = editDesktopSettings(scroll.settings, {
      kind: 'setAxisField',
      axis: 'ty',
      key: 'speed',
      value: 99,
    });
    const fn2 = sped.settings.axes.ty;
    expect(fn2.kind === 'scroll' && fn2.speed).toBe(10); // clamped to the UI band
  });

  it('rejects a stale field op (key the function does not carry)', () => {
    const cfg = base();
    expect(
      editDesktopSettings(cfg, { kind: 'setAxisField', axis: 'ty', key: 'speed', value: 2 })
        .changed,
    ).toBe(false); // ty is none
    expect(
      editDesktopSettings(cfg, { kind: 'setAxisField', axis: 'rx', key: 'kind', value: 'zoom' })
        .changed,
    ).toBe(false); // the discriminator is not a field
  });

  it('button flows: choice, the empty action seed, id/config edits, clear', () => {
    const overview = editDesktopSettings(base(), {
      kind: 'setButtonChoice',
      index: 1,
      choice: 'overview',
    });
    expect(overview.settings.buttons[1]).toBe('overview');
    const action = editDesktopSettings(overview.settings, {
      kind: 'setButtonChoice',
      index: 1,
      choice: 'action',
    });
    expect(action.settings.buttons[1]).toEqual({ kind: 'action', ref: { id: '' } });
    const picked = editDesktopSettings(action.settings, {
      kind: 'setButtonActionId',
      index: 1,
      id: 'org.spaceux.builtins/exec',
    });
    const withCfg = editDesktopSettings(picked.settings, {
      kind: 'setButtonActionConfig',
      index: 1,
      config: { command: 'firefox' },
    });
    const btn = withCfg.settings.buttons[1];
    expect(typeof btn === 'object' && btn.ref).toEqual({
      id: 'org.spaceux.builtins/exec',
      config: { command: 'firefox' },
    });
    const cleared = editDesktopSettings(withCfg.settings, { kind: 'clearButton', index: 1 });
    expect(cleared.settings.buttons[1]).toBeUndefined();
    expect(editDesktopSettings(cleared.settings, { kind: 'clearButton', index: 1 }).changed).toBe(
      false,
    );
  });

  it('reset restores the Classic preset', () => {
    const tweaked = editDesktopSettings(base(), { kind: 'setSuspend', value: false });
    const reset = editDesktopSettings(tweaked.settings, { kind: 'reset' });
    expect(reset.settings).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });
});
