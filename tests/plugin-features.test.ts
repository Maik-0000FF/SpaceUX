// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { features } from '../src/core/plugin-features';
import type { PluginInfo } from '../src/shared/ipc';

/**
 * Unit-tests the plugin-manager feature chips (#220): which chips a plugin
 * shows is derived purely from its {@link PluginInfo} flags, so pin the mapping
 * (and the stable order) here.
 */
const info = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: 'org.example.plugin',
  name: 'Example',
  version: '1.0.0',
  kind: 'function',
  dir: '/ext/org.example.plugin',
  removable: true,
  trust: 'community',
  permissions: [],
  actionCount: 0,
  hasCatalog: false,
  hasBridge: false,
  hasMenu: false,
  contextLabel: 'Workbench',
  ...over,
});

describe('features', () => {
  it("lists a function plugin's integrations as bare labels in a stable order", () => {
    const feats = features(
      info({ actionCount: 3, hasMenu: true, hasCatalog: true, hasBridge: true }),
    );
    expect(feats.map((c) => c.label)).toEqual(['Actions', 'Menu', 'Catalog', 'Bridge']);
  });

  it('keeps the action count in the tooltip, singular/plural aware', () => {
    expect(features(info({ actionCount: 1 }))[0]?.tip).toMatch(/^1 runnable action /);
    expect(features(info({ actionCount: 3 }))[0]?.tip).toMatch(/^3 runnable actions /);
  });

  it('shows a bare "Presets" label with the count in the tooltip', () => {
    const presets = [{ id: 'a' }, { id: 'b' }] as unknown as PluginInfo['navStylePresets'];
    const feats = features(info({ kind: 'nav-style', actionCount: 0, navStylePresets: presets }));
    expect(feats.map((c) => c.label)).toEqual(['Presets']);
    expect(feats[0]?.tip).toMatch(/^2 navigation-style presets /);
  });

  it('shows the shape model label', () => {
    const feats = features(
      info({
        kind: 'shape',
        shape: { id: 'planets', label: 'Planets', description: 'Orbital nodes', entry: 'index.js' },
      }),
    );
    expect(feats.map((c) => c.label)).toEqual(['Shape: Planets']);
  });

  it('is empty for a plugin that contributes nothing executable (a bare theme)', () => {
    expect(features(info({ kind: 'theme' }))).toEqual([]);
  });
});
