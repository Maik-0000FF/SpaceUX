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
      sectors: [{ label: 'A', binding: { action: 'p/x', config: { k: 1 } } }],
    };
    const b: MenuConfig = {
      sectors: [{ binding: { config: { k: 1 }, action: 'p/x' }, label: 'A' }],
      triggerButton: 0,
      version: 1,
    } as MenuConfig;
    expect(serializeMenuConfig(a)).toBe(serializeMenuConfig(b));
    // version precedes sectors in the output.
    const out = serializeMenuConfig(a);
    expect(out.indexOf('"version"')).toBeLessThan(out.indexOf('"sectors"'));
  });

  it('omits absent optional fields', () => {
    const minimal: MenuConfig = { version: 1, sectors: [{ label: 'Solo' }] };
    const json = serializeMenuConfig(minimal);
    expect(json).not.toContain('triggerButton');
    expect(json).not.toContain('axisInvert');
    expect(json).not.toContain('binding');
    expect(json).not.toContain('centerField');
  });

  it('round-trips a twistDrill through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      twistDrill: { enabled: true, threshold: 180 },
      sectors: [{ label: 'Solo' }],
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a twistCycle through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      twistCycle: { enabled: true, threshold: 100, priority: 'twist' },
      sectors: [{ label: 'Solo' }],
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a centerField (label + binding) through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      centerField: { label: 'Close', binding: { action: 'org.spaceux.builtins/cancel' } },
      sectors: [{ label: 'Solo' }],
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('round-trips a centerField activation through the validator', () => {
    const cfg: MenuConfig = {
      version: 1,
      centerField: {
        binding: { action: 'org.spaceux.builtins/cancel' },
        activation: { axis: 'tz', direction: 'positive', threshold: 200 },
      },
      sectors: [{ label: 'Solo' }],
    };
    const parsed: unknown = JSON.parse(serializeMenuConfig(cfg));
    const result = validateMenuConfig(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(cfg);
  });

  it('emits centerField before sectors', () => {
    const cfg: MenuConfig = {
      version: 1,
      centerField: { label: 'Close' },
      sectors: [{ label: 'Solo' }],
    };
    const out = serializeMenuConfig(cfg);
    expect(out.indexOf('"centerField"')).toBeLessThan(out.indexOf('"sectors"'));
  });
});
