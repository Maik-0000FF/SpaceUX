// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/main/plugin-loader';
import { MIN_SUPPORTED_PLUGIN_API_VERSION, PLUGIN_API_VERSION } from '../src/shared/plugin-types';

/** Build a minimal manifest object that passes every field other than
 *  the one a given test wants to mutate. Keeps the per-test fixture
 *  tiny and the intent obvious. */
function manifestBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: PLUGIN_API_VERSION,
    id: 'org.example.test',
    name: 'Test Plugin',
    version: '0.0.1',
    license: 'GPL-3.0-or-later',
    actions: [{ name: 'do', label: 'Do something' }],
    ...overrides,
  };
}

describe('validateManifest — apiVersion', () => {
  it('accepts the current PLUGIN_API_VERSION', () => {
    expect(validateManifest(manifestBase({ apiVersion: PLUGIN_API_VERSION }))).toBeNull();
  });

  it('rejects a missing apiVersion field', () => {
    const m = manifestBase();
    delete m.apiVersion;
    const reason = validateManifest(m);
    expect(reason).toMatch(/apiVersion/);
  });

  it('rejects non-integer or non-positive apiVersion', () => {
    for (const bad of [0, -1, 1.5, '1', null, true]) {
      const reason = validateManifest(manifestBase({ apiVersion: bad }));
      expect(reason, `apiVersion=${JSON.stringify(bad)}`).toMatch(/apiVersion/);
    }
  });

  it('rejects apiVersion newer than the host supports', () => {
    const reason = validateManifest(manifestBase({ apiVersion: PLUGIN_API_VERSION + 1 }));
    expect(reason).toMatch(/newer than this host supports/);
  });

  it('rejects apiVersion older than the supported floor', () => {
    if (MIN_SUPPORTED_PLUGIN_API_VERSION <= 1) {
      // Cannot construct an "older than 1" case while MIN is still 1;
      // the contract is exercised once MIN advances. Pin the floor
      // here so a future bump doesn't silently lose the test.
      expect(MIN_SUPPORTED_PLUGIN_API_VERSION).toBe(1);
      return;
    }
    const reason = validateManifest(
      manifestBase({ apiVersion: MIN_SUPPORTED_PLUGIN_API_VERSION - 1 }),
    );
    expect(reason).toMatch(/older than the supported range/);
  });

  it('reports apiVersion failures before any structural field failure', () => {
    // A manifest that's wrong on both apiVersion AND a structural
    // field must surface the apiVersion message — that's the one
    // that tells the user "the plugin contract doesn't apply to
    // this host", which makes every other complaint downstream
    // either redundant or actively misleading. This spec guards the
    // ordering so a future reshuffle of validateManifest's branches
    // doesn't quietly change which message the user sees.
    const reason = validateManifest({
      apiVersion: PLUGIN_API_VERSION + 1,
      id: '',
      name: '',
      version: '',
      license: '',
      actions: [],
    });
    expect(reason).toMatch(/apiVersion/);
  });
});

describe('validateManifest — structural fields', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateManifest(manifestBase())).toBeNull();
  });

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 42, 'hello', []]) {
      expect(validateManifest(bad)).not.toBeNull();
    }
  });

  it('rejects an empty or non-array actions field', () => {
    expect(validateManifest(manifestBase({ actions: [] }))).toMatch(/actions/);
    expect(validateManifest(manifestBase({ actions: 'not-array' }))).toMatch(/actions/);
  });

  it('rejects an action without a name or label', () => {
    expect(validateManifest(manifestBase({ actions: [{ label: 'x' }] }))).toMatch(/action\.name/);
    expect(validateManifest(manifestBase({ actions: [{ name: 'x' }] }))).toMatch(/action\.label/);
  });

  it('keeps MIN_SUPPORTED_PLUGIN_API_VERSION at or below PLUGIN_API_VERSION', () => {
    // Cheap invariant: if a future bump accidentally raises the
    // floor above the ceiling, every plugin would fail to load
    // with confusing range errors. The bumping policy is documented
    // in src/shared/plugin-types.ts but humans skip docs; this
    // assertion catches the slip in CI before users do.
    expect(MIN_SUPPORTED_PLUGIN_API_VERSION).toBeLessThanOrEqual(PLUGIN_API_VERSION);
  });

  it('rejects a blank id / name / version / license', () => {
    for (const key of ['id', 'name', 'version', 'license'] as const) {
      const reason = validateManifest(manifestBase({ [key]: '   ' }));
      expect(reason, `field=${key}`).toMatch(new RegExp(`"${key}"`));
    }
  });
});
