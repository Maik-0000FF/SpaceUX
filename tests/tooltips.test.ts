// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { PLUGIN_KINDS, type ActionConfigSchema } from '@/shared/plugin-types';

import { KIND_TOOLTIPS, actionConfigExample } from '../src/editor/tooltips';

// actionConfigExample turns an action's manifest config schema into a concrete
// JSON example for the Config field's tooltip (#279). Pure, so tested here.
describe('actionConfigExample', () => {
  it('returns null when the action has no config schema', () => {
    expect(actionConfigExample(undefined)).toBeNull();
  });

  it('returns null for an empty schema (no fields)', () => {
    expect(actionConfigExample({})).toBeNull();
  });

  it('uses the placeholder as the example value for a string field (exec)', () => {
    const schema: ActionConfigSchema = {
      command: {
        kind: 'string',
        label: 'Command',
        placeholder: 'firefox --new-window https://example.com',
      },
    };
    expect(actionConfigExample(schema)).toBe(
      JSON.stringify({ command: 'firefox --new-window https://example.com' }, null, 2),
    );
  });

  it('falls back to default, then empty string, for a string field', () => {
    expect(
      actionConfigExample({ keys: { kind: 'string', label: 'Keys', default: 'alt+Tab' } }),
    ).toBe(JSON.stringify({ keys: 'alt+Tab' }, null, 2));
    expect(actionConfigExample({ keys: { kind: 'string', label: 'Keys' } })).toBe(
      JSON.stringify({ keys: '' }, null, 2),
    );
  });

  it('picks a typed example for integer, boolean and enum fields', () => {
    const schema: ActionConfigSchema = {
      count: { kind: 'integer', label: 'Count', min: 2 },
      sticky: { kind: 'boolean', label: 'Sticky' },
      mode: { kind: 'enum', label: 'Mode', choices: ['fast', 'slow'] },
    };
    expect(actionConfigExample(schema)).toBe(
      JSON.stringify({ count: 2, sticky: false, mode: 'fast' }, null, 2),
    );
  });

  it('prefers an explicit default over min / first choice', () => {
    const schema: ActionConfigSchema = {
      count: { kind: 'integer', label: 'Count', min: 2, default: 7 },
      mode: { kind: 'enum', label: 'Mode', choices: ['fast', 'slow'], default: 'slow' },
    };
    expect(actionConfigExample(schema)).toBe(JSON.stringify({ count: 7, mode: 'slow' }, null, 2));
  });

  it('includes every field in declaration order', () => {
    const schema: ActionConfigSchema = {
      a: { kind: 'string', label: 'A', placeholder: 'x' },
      b: { kind: 'string', label: 'B', placeholder: 'y' },
    };
    expect(actionConfigExample(schema)).toBe(JSON.stringify({ a: 'x', b: 'y' }, null, 2));
  });
});

// The plugin-kind badge tooltip (#279) must explain every kind the manager can
// list, so a future kind can't ship a blank badge.
describe('KIND_TOOLTIPS', () => {
  it('has a non-empty entry for every plugin kind', () => {
    for (const kind of PLUGIN_KINDS) {
      expect(KIND_TOOLTIPS[kind]).toBeTruthy();
    }
  });
});
