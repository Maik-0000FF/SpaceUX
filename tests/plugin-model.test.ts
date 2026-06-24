// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  SHAPE_INHERIT_VALUE,
  SHAPE_WEDGE_VALUE,
  inspectPluginConsent,
  inspectPluginManager,
  inspectPluginRemoval,
  inspectShapeSelects,
} from '../src/core/plugin-model';
import { DEFAULT_PIE_APPEARANCE } from '../src/shared/pie-appearance';
import { DEFAULT_MENU_CONFIG, type MenuConfig } from '../src/shared/menu';
import type { PluginInfo, PluginsState } from '../src/shared/ipc';

const plugin = (over: Partial<PluginInfo>): PluginInfo =>
  ({
    id: 'org.example.p',
    name: 'Example',
    version: '1.0.0',
    kind: 'function',
    dir: '/tmp/p',
    removable: true,
    trust: 'community',
    permissions: [],
    actionCount: 0,
    hasMenu: false,
    hasCatalog: false,
    hasBridge: false,
    ...over,
  }) as PluginInfo;

const state = (plugins: PluginInfo[], errors: PluginsState['errors'] = []): PluginsState => ({
  plugins,
  errors,
});

const cfg = (over: Partial<MenuConfig> = {}): MenuConfig => ({
  ...DEFAULT_MENU_CONFIG,
  root: { label: 'C', branches: [{ label: 'A' }] },
  ...over,
});

describe('inspectPluginManager (#457 C5)', () => {
  it('sections per kind in canonical order, empty kinds collapsed', () => {
    const m = inspectPluginManager(
      state([
        plugin({
          id: 'a',
          kind: 'shape',
          name: 'S',
          shape: { id: 's', label: 'S', description: '', entry: 'index.js' },
        }),
        plugin({ id: 'b', kind: 'function', name: 'F', actionCount: 2 }),
      ]),
    );
    expect(m.sections.map((s) => s.heading)).toEqual(['Function', 'Shape']);
  });

  it('builds the badge row: kind, origin, trust (none for unknown)', () => {
    const m = inspectPluginManager(
      state([
        plugin({ id: 'a', removable: false, trust: 'verified' }),
        plugin({ id: 'b', removable: true, trust: 'unknown' }),
      ]),
    );
    const [a, b] = m.sections[0]!.items;
    expect(a!.badges.map((x) => x.label)).toEqual(['function', 'Built-in', 'Verified']);
    expect(a!.removeTooltip).not.toBeNull();
    expect(b!.badges.map((x) => x.label)).toEqual(['function', 'Imported']);
    expect(b!.removeTooltip).toBeNull();
  });

  it('carries feature + permission chips and the load errors', () => {
    const m = inspectPluginManager(
      state(
        [plugin({ actionCount: 3, hasBridge: true, permissions: ['exec'] })],
        [{ dir: '/bad', reason: 'broken manifest' }],
      ),
    );
    const item = m.sections[0]!.items[0]!;
    expect(item.features.map((f) => f.label)).toContain('Actions');
    expect(item.features.map((f) => f.label)).toContain('Bridge');
    expect(item.permissions[0]).toMatchObject({ label: 'exec' });
    expect(m.errors).toEqual([{ dir: '/bad', reason: 'broken manifest' }]);
  });
});

describe('inspectPluginConsent (#457 C5)', () => {
  const picked = (over: Record<string, unknown>) =>
    ({
      ok: true,
      srcDir: '/tmp/p',
      name: 'P',
      permissions: [],
      trust: 'community',
      ...over,
    }) as never;

  it('returns null when no consent is needed', () => {
    expect(inspectPluginConsent(picked({}))).toBeNull();
    expect(inspectPluginConsent({ ok: 'cancelled' } as never)).toBeNull();
  });

  it('asks for declared permissions and flags an impersonator destructively', () => {
    const withPerms = inspectPluginConsent(picked({ permissions: ['exec', 'network'] }));
    expect(withPerms?.permissions).toEqual(['exec', 'network']);
    expect(withPerms?.destructive).toBe(false);
    expect(withPerms?.warn).toBeNull();
    const imp = inspectPluginConsent(picked({ trust: 'mismatch' }));
    expect(imp?.destructive).toBe(true);
    expect(imp?.warn).toContain('impersonating');
    expect(imp?.badge?.label).toBe('Unverified');
  });
});

describe('inspectPluginRemoval (#457 C5)', () => {
  it('folds the usage scan into the message, capped', () => {
    const menus = Array.from({ length: 8 }, (_, i) => `Menu ${i}`);
    const m = inspectPluginRemoval('P', { menus, globalAppearance: true });
    expect(m.message).toContain('Remove "P"?');
    expect(m.message).toContain('• Menu 5');
    expect(m.message).not.toContain('• Menu 6');
    expect(m.message).toContain('…and 2 more');
    expect(m.message).toContain('Global appearance');
    expect(m.destructive).toBe(true);
  });

  it('stays a single line when the scan failed or found nothing', () => {
    expect(inspectPluginRemoval('P', null).message).toBe(
      'Remove "P"? This deletes its installed files.',
    );
  });
});

describe('inspectShapeSelects (#457 C5)', () => {
  const shapePlugin = plugin({
    id: 'org.x.planets',
    kind: 'shape',
    name: 'Planets',
    shape: { id: 'planets', label: 'Planets', description: 'Orbiting nodes.', entry: 'index.js' },
  });

  it('lists wedge + plugin shapes and keeps an orphan visible disabled', () => {
    const m = inspectShapeSelects(
      state([shapePlugin]),
      { ...DEFAULT_PIE_APPEARANCE, shapeModel: 'org.gone/xyz' },
      cfg(),
    );
    expect(m.appearance.options[0]).toMatchObject({ value: SHAPE_WEDGE_VALUE, label: 'Wedges' });
    expect(m.appearance.options.some((o) => o.value === 'org.x.planets/planets')).toBe(true);
    const orphan = m.appearance.options.find((o) => o.value === 'org.gone/xyz');
    expect(orphan?.disabled).toBe(true);
  });

  it('maps the per-menu three-state and names the inherited default', () => {
    const inherit = inspectShapeSelects(
      state([shapePlugin]),
      { ...DEFAULT_PIE_APPEARANCE, shapeModel: 'org.x.planets/planets' },
      cfg(),
    );
    expect(inherit.menu.value).toBe(SHAPE_INHERIT_VALUE);
    expect(inherit.menu.options[0]?.label).toContain('Planets');
    const forced = inspectShapeSelects(
      state([shapePlugin]),
      DEFAULT_PIE_APPEARANCE,
      cfg({ shapeModel: null }),
    );
    expect(forced.menu.value).toBe(SHAPE_WEDGE_VALUE);
    const pluginForced = inspectShapeSelects(
      state([shapePlugin]),
      DEFAULT_PIE_APPEARANCE,
      cfg({ shapeModel: 'org.x.planets/planets' }),
    );
    expect(pluginForced.menu.value).toBe('org.x.planets/planets');
  });
});
