// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formatPluginKey, parsePluginKey } from '../src/shared/plugin-key';

describe('formatPluginKey', () => {
  it('joins plugin id and item id with a single slash', () => {
    expect(formatPluginKey('org.spaceux.planets', 'planets')).toBe('org.spaceux.planets/planets');
  });

  it('is the inverse of parsePluginKey on well-formed inputs', () => {
    const key = formatPluginKey('a.b', 'c-d');
    const parsed = parsePluginKey(key);
    expect(parsed).toEqual({ pluginId: 'a.b', itemId: 'c-d' });
  });
});

describe('parsePluginKey', () => {
  it('splits a well-formed key on the first slash', () => {
    expect(parsePluginKey('org.spaceux.planets/planets')).toEqual({
      pluginId: 'org.spaceux.planets',
      itemId: 'planets',
    });
  });

  it('keeps slashes after the first one inside itemId', () => {
    // An item id may itself contain a `/` (e.g. a nested command name like
    // `Sketcher/Line`). The split happens on the FIRST slash only so the
    // item id stays intact.
    expect(parsePluginKey('org.spaceux.freecad/Sketcher/Line')).toEqual({
      pluginId: 'org.spaceux.freecad',
      itemId: 'Sketcher/Line',
    });
  });

  it('returns null when there is no slash', () => {
    expect(parsePluginKey('bareid')).toBeNull();
  });

  it('returns null when the plugin half is empty (leading slash)', () => {
    expect(parsePluginKey('/itemonly')).toBeNull();
  });

  it('returns null when the item half is empty (trailing slash)', () => {
    expect(parsePluginKey('plugin-only/')).toBeNull();
  });

  it('returns null on an empty key', () => {
    expect(parsePluginKey('')).toBeNull();
  });

  it('returns null on a bare slash (both halves empty)', () => {
    expect(parsePluginKey('/')).toBeNull();
  });
});
