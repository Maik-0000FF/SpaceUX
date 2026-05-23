// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MENU_CONFIG,
  serializeMenuConfig,
  validateMenuConfig,
  type MenuConfig,
} from '@/shared/menu';

describe('serializeMenuConfig', () => {
  it('round-trips through the validator unchanged', () => {
    const json = serializeMenuConfig(DEFAULT_MENU_CONFIG);
    const parsed: unknown = JSON.parse(json);
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(DEFAULT_MENU_CONFIG);
  });

  it('ends with a trailing newline and uses 2-space indent', () => {
    const json = serializeMenuConfig(DEFAULT_MENU_CONFIG);
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('\n  "version"');
  });

  it('emits a fixed key order regardless of input key order', () => {
    // Same config assembled with keys inserted in different orders.
    const a: MenuConfig = {
      version: 1,
      triggerButton: 0,
      root: { label: '', branches: [{ label: 'A', action: { id: 'p/x', config: { k: 1 } } }] },
    };
    const b: MenuConfig = {
      root: { branches: [{ action: { config: { k: 1 }, id: 'p/x' }, label: 'A' }], label: '' },
      triggerButton: 0,
      version: 1,
    } as MenuConfig;
    expect(serializeMenuConfig(a)).toBe(serializeMenuConfig(b));
    // version precedes root in the output.
    const out = serializeMenuConfig(a);
    expect(out.indexOf('"version"')).toBeLessThan(out.indexOf('"root"'));
  });

  it('omits absent optional fields', () => {
    const minimal: MenuConfig = { version: 1, root: { label: '', branches: [{ label: 'Solo' }] } };
    const json = serializeMenuConfig(minimal);
    expect(json).not.toContain('triggerButton');
    expect(json).not.toContain('axisInvert');
    expect(json).not.toContain('action');
  });

  it('omits the default triggerMode but serializes a non-default one', () => {
    const root = { label: '', branches: [{ label: 'Solo' }] };
    // Default 'toggle' is omitted so existing/default configs don't gain it.
    expect(serializeMenuConfig({ version: 1, triggerMode: 'toggle', root })).not.toContain(
      'triggerMode',
    );
    // 'open' is written, and round-trips through the validator.
    const json = serializeMenuConfig({ version: 1, triggerMode: 'open', root });
    expect(json).toContain('"triggerMode": "open"');
    const r = validateMenuConfig(JSON.parse(json));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.triggerMode).toBe('open');
  });

  it('round-trips a navigation block through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      navigation: {
        aim: 'tilt',
        deadzone: 80,
        hoverDeadzone: 40,
        drillIn: { inputs: [{ kind: 'magnitude', source: 'tilt', threshold: 200 }] },
        back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 60 }] },
        cycle: {
          inputs: [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }],
          priority: 'lateral',
        },
        commitCenter: { inputs: [{ kind: 'button', button: 1 }] },
        activate: { inputs: [{ kind: 'button', button: 0 }] },
      },
      root: { label: '', branches: [{ label: 'Solo' }] },
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('omits the default push aim but emits a non-default one (#159)', () => {
    const base = {
      deadzone: 50,
      hoverDeadzone: 25,
      drillIn: { inputs: [] },
      back: { inputs: [] },
      cycle: { inputs: [], priority: 'lateral' as const },
      commitCenter: { inputs: [] },
      activate: { inputs: [] },
    };
    const root = { label: '', branches: [{ label: 'Solo' }] };
    const pushed = serializeMenuConfig({ version: 1, navigation: { aim: 'push', ...base }, root });
    expect(pushed).not.toContain('"aim"');
    const tilted = serializeMenuConfig({ version: 1, navigation: { aim: 'tilt', ...base }, root });
    expect(tilted).toContain('"aim": "tilt"');
  });

  it('round-trips a root with a centre label + action through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      root: {
        label: 'Close',
        action: { id: 'org.spaceux.builtins/cancel' },
        branches: [{ label: 'Solo' }],
      },
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a keepOpen leaf node through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      root: {
        label: '',
        branches: [
          { label: 'Vol+', action: { id: 'org.spaceux.builtins/key-combo' }, keepOpen: true },
        ],
      },
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a per-item activation binding through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      root: {
        label: '',
        branches: [
          {
            label: 'Vol',
            action: { id: 'org.spaceux.builtins/key-combo' },
            activation: {
              inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }],
            },
          },
        ],
      },
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a per-item exit binding through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      root: {
        label: '',
        branches: [
          {
            label: 'Item',
            action: { id: 'org.spaceux.builtins/exec' },
            exit: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'positive', threshold: 50 }] },
          },
        ],
      },
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('emits the root after the top-level settings', () => {
    const cfg: MenuConfig = {
      version: 1,
      triggerButton: 0,
      root: { label: 'Close', branches: [{ label: 'Solo' }] },
    };
    const out = serializeMenuConfig(cfg);
    expect(out.indexOf('"triggerButton"')).toBeLessThan(out.indexOf('"root"'));
  });
});
