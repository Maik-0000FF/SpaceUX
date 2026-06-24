// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { dirSizeRank, parseThemeIndex } from '../src/main/icon-theme';

describe('parseThemeIndex', () => {
  it('reads Directories and Inherits as comma lists from the [Icon Theme] section', () => {
    const content = [
      '[Icon Theme]',
      'Name=Breeze',
      'Inherits=hicolor',
      'Directories=apps/16,apps/48,scalable/apps',
      '',
      '[apps/48]',
      'Size=48',
      'Context=Applications',
    ].join('\n');
    expect(parseThemeIndex(content)).toEqual({
      directories: ['apps/16', 'apps/48', 'scalable/apps'],
      inherits: ['hicolor'],
    });
  });

  it('handles multiple inherited themes and trims whitespace', () => {
    expect(parseThemeIndex('Inherits=breeze, hicolor ,\nDirectories= a , b ')).toEqual({
      directories: ['a', 'b'],
      inherits: ['breeze', 'hicolor'],
    });
  });

  it('yields empty lists when the keys are absent', () => {
    expect(parseThemeIndex('[Icon Theme]\nName=X')).toEqual({ directories: [], inherits: [] });
  });

  it('does not mistake a key inside a directory section (line-anchored)', () => {
    // A subdir section's keys (Size/Context) must not be read as the theme's.
    const content = '[Icon Theme]\nDirectories=apps/48\n\n[apps/48]\nSize=48';
    expect(parseThemeIndex(content).directories).toEqual(['apps/48']);
  });
});

describe('dirSizeRank', () => {
  it('ranks scalable highest (vector, size-independent)', () => {
    expect(dirSizeRank('scalable/apps')).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads the size from either dir layout (category/size or sizexsize/category)', () => {
    expect(dirSizeRank('apps/48')).toBe(48);
    expect(dirSizeRank('48x48/apps')).toBe(48);
  });

  it('takes the largest embedded number and falls back to 0 without one', () => {
    expect(dirSizeRank('256x256/mimetypes')).toBe(256);
    expect(dirSizeRank('apps')).toBe(0);
  });

  it('orders larger before smaller, with scalable first', () => {
    const sorted = ['apps/16', 'scalable/apps', 'apps/128', 'apps/48'].sort(
      (a, b) => dirSizeRank(b) - dirSizeRank(a),
    );
    expect(sorted).toEqual(['scalable/apps', 'apps/128', 'apps/48', 'apps/16']);
  });
});
