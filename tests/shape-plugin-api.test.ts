// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { validateShapePluginModule } from '../src/shared/shape-plugin-api';

/**
 * The shape-plugin module validator (#107 PR2). Narrow on purpose: only
 * checks the two function exports exist so a plugin can grow extra
 * exports without breaking load. These tests pin that contract.
 */
describe('validateShapePluginModule', () => {
  it('accepts a module with layout + hitTest as functions', () => {
    expect(validateShapePluginModule({ layout: () => ({}), hitTest: () => null })).toBeNull();
  });

  it('accepts a module that carries extra fields beyond the contract', () => {
    // Future-proofing: a plugin author may export helpers / metadata
    // alongside the contract functions. The validator must not reject
    // anything it doesn't explicitly require.
    expect(
      validateShapePluginModule({
        layout: () => ({}),
        hitTest: () => null,
        meta: { version: '0.1.0' },
        default: { name: 'whatever' },
      }),
    ).toBeNull();
  });

  it('rejects non-object inputs', () => {
    for (const bad of [null, undefined, 42, 'hello', true, []]) {
      const reason = validateShapePluginModule(bad);
      expect(reason, `input=${JSON.stringify(bad)}`).not.toBeNull();
    }
  });

  it('rejects a module missing `layout`', () => {
    expect(validateShapePluginModule({ hitTest: () => null })).toMatch(/`layout`/);
  });

  it('rejects a module missing `hitTest`', () => {
    expect(validateShapePluginModule({ layout: () => ({}) })).toMatch(/`hitTest`/);
  });

  it('rejects a module where layout is not a function (e.g. an object stub)', () => {
    expect(validateShapePluginModule({ layout: { nodes: [] }, hitTest: () => null })).toMatch(
      /`layout`/,
    );
  });

  it('rejects a module where hitTest is not a function', () => {
    expect(validateShapePluginModule({ layout: () => ({}), hitTest: 'not a function' })).toMatch(
      /`hitTest`/,
    );
  });
});
