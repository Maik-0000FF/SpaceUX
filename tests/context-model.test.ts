// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { inspectPalette, inspectSourceState } from '../src/core/context-model';
import { addItem } from '../src/core/menu-edit';
import { DEFAULT_MENU_CONFIG, type MenuConfig } from '../src/shared/menu';
import type { CatalogSnapshot } from '../src/shared/context-ui';

const catalog = (over: Partial<CatalogSnapshot> = {}): CatalogSnapshot => ({
  plugin: { id: 'org.x.fc', name: 'FreeCAD', contextLabel: 'Workbench', hasBridge: true },
  status: 'ready',
  reason: null,
  groups: [
    {
      key: 'PartWB',
      name: 'Part',
      icon: 'data:image/png;base64,AAA',
      toolbars: [
        {
          name: 'Tools',
          commands: [
            { command: 'Part_Box', label: 'Box', enabled: true },
            { command: 'Part_Off', label: 'Off', enabled: false },
          ],
        },
      ],
    },
  ],
  ...over,
});

const none: CatalogSnapshot = { plugin: null, status: 'ready', reason: null, groups: [] };

describe('inspectSourceState (#457 C5 part 2)', () => {
  it('returns no source/banner without a catalog plugin or override', () => {
    const m = inspectSourceState(none, [], null);
    expect(m.source).toBeNull();
    expect(m.readOnly).toBe(false);
    expect(m.banner).toBeNull();
    expect(m.header).toBeNull();
  });

  it('flags a plugin-provided source read-only with the banner', () => {
    const m = inspectSourceState(catalog(), [], 'plugin:org.x.fc');
    expect(m.readOnly).toBe(true);
    expect(m.banner?.switchLabel).toBe('Switch to Auto');
    expect(m.source?.isDynamic).toBe(true);
    expect(m.header).toBeNull(); // dynamic has no per-context header
  });

  it('merges catalog + curated-offline contexts, sorted, with curated flags', () => {
    const m = inspectSourceState(catalog(), ['ctx:org.x.fc:PartWB', 'ctx:org.x.fc:DraftWB'], null);
    expect(m.source?.contexts.map((c) => c.label)).toEqual(['Draft WB', 'Part']);
    const part = m.source?.contexts.find((c) => c.key === 'PartWB');
    expect(part).toMatchObject({ curated: true, icon: 'data:image/png;base64,AAA' });
    // Curated-offline (not in the catalog): label derived from the key, no icon.
    const draft = m.source?.contexts.find((c) => c.key === 'DraftWB');
    expect(draft?.curated).toBe(true);
    expect(draft?.icon).toBeUndefined();
  });

  it('names the active curated context in the header', () => {
    const m = inspectSourceState(catalog(), ['ctx:org.x.fc:PartWB'], 'ctx:org.x.fc:PartWB');
    expect(m.source?.activeContextKey).toBe('PartWB');
    expect(m.header).toEqual({ icon: 'data:image/png;base64,AAA', label: 'Part' });
    expect(m.readOnly).toBe(false); // curated pies are editable
  });
});

describe('inspectPalette (#457 C5 part 2)', () => {
  it('is null without a catalog plugin', () => {
    expect(inspectPalette(none, null, false)).toBeNull();
  });

  it('expands the catalog, applies enabledOnly, scopes to the active context', () => {
    const all = inspectPalette(catalog(), null, false);
    expect(all?.runActionId).toBe('org.x.fc/run');
    expect(all?.groups[0]?.commands.map((c) => c.command)).toEqual(['Part_Box', 'Part_Off']);
    const usable = inspectPalette(catalog(), null, true);
    expect(usable?.groups[0]?.commands.map((c) => c.command)).toEqual(['Part_Box']);
    const scoped = inspectPalette(catalog(), 'ctx:org.x.fc:OtherWB', false);
    expect(scoped?.groups).toEqual([]); // active context has no catalog group
  });

  it('words the read-only and error notes', () => {
    const ro = inspectPalette(catalog(), 'plugin:org.x.fc', false);
    expect(ro?.addDisabled).toBe(true);
    expect(ro?.note).toContain('read-only');
    const err = inspectPalette(catalog({ status: 'error', reason: 'bridge down' }), null, false);
    expect(err?.note).toContain('bridge down');
  });
});

describe('addItem (#76 D2b palette add)', () => {
  const cfg: MenuConfig = {
    ...DEFAULT_MENU_CONFIG,
    root: { label: 'C', branches: [{ label: 'A' }] },
  };

  it('appends a fully-specified leaf, purely', () => {
    const after = addItem(cfg, [], {
      label: 'Box',
      icon: 'data:i',
      action: { id: 'org.x.fc/run', config: { command: 'Part_Box' } },
    });
    expect(after.root.branches).toHaveLength(2);
    expect(after.root.branches![1]).toEqual({
      label: 'Box',
      icon: 'data:i',
      action: { id: 'org.x.fc/run', config: { command: 'Part_Box' } },
    });
    expect(cfg.root.branches).toHaveLength(1);
  });

  it('rejects a stale ring path by identity', () => {
    expect(addItem(cfg, [5], { label: 'X' })).toBe(cfg);
  });

  it('refuses to grow branches beside an action leaf', () => {
    const withLeaf: MenuConfig = {
      ...DEFAULT_MENU_CONFIG,
      root: { label: 'C', branches: [{ label: 'A', action: { id: 'x' } }] },
    };
    expect(addItem(withLeaf, [0], { label: 'X' })).toBe(withLeaf);
  });
});
