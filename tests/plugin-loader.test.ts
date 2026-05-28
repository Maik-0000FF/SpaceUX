// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/main/plugin-loader';
import { MIN_SUPPORTED_PLUGIN_API_VERSION, PLUGIN_API_VERSION } from '../src/shared/plugin-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Build a minimal manifest object that passes every field other than
 *  the one a given test wants to mutate. Keeps the per-test fixture
 *  tiny and the intent obvious. */
function manifestBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: PLUGIN_API_VERSION,
    kind: 'function',
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

  it('rejects a missing or unknown kind', () => {
    const missing = manifestBase();
    delete missing.kind;
    expect(validateManifest(missing)).toMatch(/"kind"/);
    expect(validateManifest(manifestBase({ kind: 'widget' }))).toMatch(/"kind"/);
    expect(validateManifest(manifestBase({ kind: 42 }))).toMatch(/"kind"/);
  });

  it('accepts a theme plugin without an actions array', () => {
    // Theme plugins (#47) carry no actions; the `actions` contract only
    // applies to function plugins. A theme manifest minus actions is valid.
    const theme = manifestBase({ kind: 'theme' });
    delete theme.actions;
    expect(validateManifest(theme)).toBeNull();
  });

  it('rejects a theme plugin that carries a stray actions array', () => {
    // Symmetric to the menu / presets rules: a field that doesn't belong on
    // this kind is a manifest error, not silently ignored.
    const theme = manifestBase({ kind: 'theme' });
    expect(validateManifest(theme)).toMatch(/"actions" is only valid on a function plugin/);
  });

  it('still requires actions for a function plugin', () => {
    const fn = manifestBase({ kind: 'function' });
    delete fn.actions;
    expect(validateManifest(fn)).toMatch(/actions/);
  });

  it('rejects a blank id / name / version / license', () => {
    for (const key of ['id', 'name', 'version', 'license'] as const) {
      const reason = validateManifest(manifestBase({ [key]: '   ' }));
      expect(reason, `field=${key}`).toMatch(new RegExp(`"${key}"`));
    }
  });

  it('rejects duplicate action names within a single manifest', () => {
    // Two entries with the same name would silently collapse at
    // handler-registration time. The validator must surface this
    // before loadOne ever sees the manifest.
    const reason = validateManifest(
      manifestBase({
        actions: [
          { name: 'launch', label: 'Launch A' },
          { name: 'launch', label: 'Launch B' },
        ],
      }),
    );
    expect(reason).toMatch(/action\.name "launch" appears more than once/);
  });

  it('accepts a function plugin with a menu (root is structurally an object)', () => {
    // validateManifest only checks menu.root is an object; the deep node-tree
    // validation runs in loadOne.
    const m = manifestBase({ menu: { root: { label: '', branches: [{ label: 'x' }] } } });
    expect(validateManifest(m)).toBeNull();
  });

  it('rejects a menu on a non-function plugin', () => {
    const m = manifestBase({ kind: 'theme', menu: { root: {} } });
    delete m.actions;
    expect(validateManifest(m)).toMatch(/"menu" is only valid on a function plugin/);
  });

  it('rejects a malformed menu (not an object / no root object)', () => {
    expect(validateManifest(manifestBase({ menu: 'nope' }))).toMatch(/"menu" must be an object/);
    expect(validateManifest(manifestBase({ menu: {} }))).toMatch(/"menu.root" must be an object/);
  });

  it('accepts multiple actions with distinct names', () => {
    expect(
      validateManifest(
        manifestBase({
          actions: [
            { name: 'launch', label: 'Launch' },
            { name: 'close', label: 'Close' },
          ],
        }),
      ),
    ).toBeNull();
  });
});

/** Build a minimal nav-style manifest, a different shape from the function
 *  base (no `actions`, instead a `presets` array). One reasonable preset is
 *  included so the validator's preset-level branch is exercised. */
function navStyleManifestBase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: PLUGIN_API_VERSION,
    kind: 'nav-style',
    id: 'org.example.nav',
    name: 'Test Nav Style',
    version: '0.0.1',
    license: 'GPL-3.0-or-later',
    presets: [
      {
        id: 'aim-twist',
        label: 'Aim + Twist',
        description: 'Aim to hover, twist to cycle.',
        navigation: {
          aim: 'push',
          deadzone: 100,
          hoverDeadzone: 50,
          drillIn: { inputs: [] },
          back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
          cycle: { inputs: [], priority: 'lateral' },
          commitCenter: { inputs: [] },
          activate: { inputs: [{ kind: 'button', button: 0 }] },
        },
      },
    ],
    ...overrides,
  };
}

describe('validateManifest — nav-style kind', () => {
  it('accepts a minimal valid nav-style manifest', () => {
    expect(validateManifest(navStyleManifestBase())).toBeNull();
  });

  it('rejects an empty or non-array presets field', () => {
    expect(validateManifest(navStyleManifestBase({ presets: [] }))).toMatch(/presets/);
    expect(validateManifest(navStyleManifestBase({ presets: 'nope' }))).toMatch(/presets/);
    const m = navStyleManifestBase();
    delete m.presets;
    expect(validateManifest(m)).toMatch(/presets/);
  });

  it('rejects a preset without an id / label / description', () => {
    const base = navStyleManifestBase().presets as Array<Record<string, unknown>>;
    expect(validateManifest(navStyleManifestBase({ presets: [{ ...base[0], id: '' }] }))).toMatch(
      /preset\.id/,
    );
    expect(
      validateManifest(navStyleManifestBase({ presets: [{ ...base[0], label: '' }] })),
    ).toMatch(/preset\.label/);
    expect(
      validateManifest(navStyleManifestBase({ presets: [{ ...base[0], description: '' }] })),
    ).toMatch(/preset\.description/);
  });

  it('rejects duplicate preset ids within a single manifest', () => {
    const base = (navStyleManifestBase().presets as Array<Record<string, unknown>>)[0]!;
    const reason = validateManifest(
      navStyleManifestBase({ presets: [base, { ...base, label: 'Dupe' }] }),
    );
    expect(reason).toMatch(/preset\.id "aim-twist" appears more than once/);
  });

  it('rejects a preset with a malformed navigation block (delegates to validateNavigation)', () => {
    const base = (navStyleManifestBase().presets as Array<Record<string, unknown>>)[0]!;
    const reason = validateManifest(
      navStyleManifestBase({
        presets: [{ ...base, navigation: { ...(base.navigation as object), aim: 'sideways' } }],
      }),
    );
    expect(reason).toMatch(/aim/);
  });

  it('normalises the navigation block in place after validation', () => {
    // validateNavigation clamps and defaults — exercising the in-place write
    // so the picker sees a canonical shape regardless of what the manifest
    // literally wrote (a deadzone above MAX would otherwise leak through).
    const base = (navStyleManifestBase().presets as Array<Record<string, unknown>>)[0]!;
    const manifest = navStyleManifestBase({
      presets: [{ ...base, navigation: { ...(base.navigation as object), deadzone: 99999 } }],
    });
    expect(validateManifest(manifest)).toBeNull();
    const nav = (manifest.presets as Array<Record<string, unknown>>)[0]!.navigation as {
      deadzone: number;
    };
    expect(nav.deadzone).toBeLessThan(99999);
  });

  it('still rejects a menu on a nav-style plugin (menus are function-only)', () => {
    const m = navStyleManifestBase({ menu: { root: {} } });
    expect(validateManifest(m)).toMatch(/"menu" is only valid on a function plugin/);
  });

  it('rejects a nav-style plugin that carries a stray actions array', () => {
    // Mirror of "rejects a theme plugin with stray actions": every kind-
    // specific field is policed on the kinds it doesn't belong to.
    const m = navStyleManifestBase({ actions: [{ name: 'do', label: 'Do' }] });
    expect(validateManifest(m)).toMatch(/"actions" is only valid on a function plugin/);
  });
});

describe('validateManifest — cross-kind field rejection', () => {
  it('rejects a function plugin that carries a stray presets array', () => {
    // The presets field is the nav-style payload; on a function manifest it's
    // a misplaced field, not a silently-ignored extra (symmetric to actions /
    // menu on non-function plugins).
    const fn = manifestBase({
      presets: [
        {
          id: 'x',
          label: 'X',
          description: 'X',
          navigation: {
            aim: 'push',
            drillIn: { inputs: [] },
            back: { inputs: [] },
            cycle: { inputs: [], priority: 'lateral' },
            commitCenter: { inputs: [] },
            activate: { inputs: [] },
          },
        },
      ],
    });
    expect(validateManifest(fn)).toMatch(/"presets" is only valid on a nav-style plugin/);
  });

  it('rejects a theme plugin that carries a stray presets array', () => {
    const theme = manifestBase({ kind: 'theme' });
    delete theme.actions;
    (theme as Record<string, unknown>).presets = [
      {
        id: 'x',
        label: 'X',
        description: 'X',
        navigation: {
          aim: 'push',
          drillIn: { inputs: [] },
          back: { inputs: [] },
          cycle: { inputs: [], priority: 'lateral' },
          commitCenter: { inputs: [] },
          activate: { inputs: [] },
        },
      },
    ];
    expect(validateManifest(theme)).toMatch(/"presets" is only valid on a nav-style plugin/);
  });
});

describe('bundled extensions are valid manifests', () => {
  it('extensions/nav-style/org.spaceux.twist-press-lift/manifest.json passes the validator', () => {
    // Smoke test: the plugin ships with the repo and is the canonical example
    // of a nav-style plugin. If its manifest ever drifts out of contract this
    // test fires before the editor's user-facing import.
    const raw = readFileSync(
      path.join(REPO_ROOT, 'extensions/nav-style/org.spaceux.twist-press-lift/manifest.json'),
      'utf8',
    );
    const parsed: unknown = JSON.parse(raw);
    expect(validateManifest(parsed)).toBeNull();
  });
});

describe('plugin API version invariants', () => {
  it('keeps MIN_SUPPORTED_PLUGIN_API_VERSION at or below PLUGIN_API_VERSION', () => {
    // Cheap invariant: if a future bump accidentally raises the
    // floor above the ceiling, every plugin would fail to load
    // with confusing range errors. The bumping policy is documented
    // in src/shared/plugin-types.ts but humans skip docs; this
    // assertion catches the slip in CI before users do.
    //
    // This is intentionally not inside the validateManifest describe
    // blocks because it exercises the two module constants directly,
    // not the validator. A future reader scanning for "what guards
    // plugin-types.ts?" should land here without having to look
    // through validator-shape tests first.
    expect(MIN_SUPPORTED_PLUGIN_API_VERSION).toBeLessThanOrEqual(PLUGIN_API_VERSION);
  });
});
