// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveIconFile } from '../src/main/icon-theme';
import type { HostEnvironment } from '../src/shared/plugin-types';

const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;

// Regression: a theme's Directories= is unioned across every base dir that
// defines an index.theme, not taken from the first one only. A per-user base
// may ship a partial index.theme (here Directories=scalable/apps) while the
// system base declares more (also 48x48/apps); an icon that lives only in the
// system base's 48x48/apps must still resolve. The lookup is cached on the
// first resolve, so this scenario gets its own file for a fresh cache.
describe('resolveIconFile unions Directories across base dirs', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string): void => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-icon-union-'));
    // The "per-user" base declares only scalable/apps (a partial index.theme).
    const homeHicolor = join(dir, 'home', 'icons', 'hicolor');
    mkdirSync(homeHicolor, { recursive: true });
    writeFileSync(
      join(homeHicolor, 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n\n[scalable/apps]\nContext=Applications\n',
    );
    // The "system" base declares scalable/apps AND 48x48/apps, and holds the
    // icon under 48x48/apps, a subdir the per-user index.theme never lists.
    const sysHicolor = join(dir, 'sys', 'icons', 'hicolor');
    const sysApps48 = join(sysHicolor, '48x48', 'apps');
    mkdirSync(sysApps48, { recursive: true });
    writeFileSync(
      join(sysHicolor, 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps,48x48/apps\n\n[scalable/apps]\nContext=Applications\n\n[48x48/apps]\nSize=48\nContext=Applications\n',
    );
    writeFileSync(join(sysApps48, 'spaceux-union-probe.png'), '');
    set('XDG_DATA_HOME', join(dir, 'home'));
    set('XDG_DATA_DIRS', join(dir, 'sys'));
    set('XDG_CONFIG_HOME', join(dir, 'no-config'));
  });

  afterAll(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an icon in a subdir declared only by a non-first base index.theme', () => {
    expect(resolveIconFile('spaceux-union-probe', host)).toBe(
      join(dir, 'sys', 'icons', 'hicolor', '48x48', 'apps', 'spaceux-union-probe.png'),
    );
  });
});
