// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveIconFile } from '../src/main/icon-theme';
import type { HostEnvironment } from '../src/shared/plugin-types';

const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;

// A session with no configured icon theme (a bare wlroots compositor: no KDE,
// no gsettings, no GTK settings) must still resolve named icons from whatever
// icon theme is installed, discovered from disk rather than hard-coded. Without
// the discovery fallback the chain would collapse to hicolor and a named icon
// living only in an installed-but-unconfigured theme would go missing. The
// lookup is cached on the first resolve, so this is its own file (a fresh module
// instance) and seeds the environment in beforeAll.
describe('resolveIconFile discovers installed themes when none is configured', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string): void => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-icon-discover-'));
    // An installed theme that is NOT hicolor and NOT configured anywhere.
    const theme = join(dir, 'data', 'icons', 'SpaceuxProbeTheme');
    const iconDir = join(theme, 'scalable', 'apps');
    mkdirSync(iconDir, { recursive: true });
    writeFileSync(
      join(theme, 'index.theme'),
      '[Icon Theme]\nName=SpaceuxProbeTheme\nDirectories=scalable/apps\n\n[scalable/apps]\nContext=Applications\n',
    );
    writeFileSync(join(iconDir, 'spaceux-discover-probe.svg'), '<svg/>');
    // A cursor-only theme (declares no icon Directories) must be skipped.
    const cursorTheme = join(dir, 'data', 'icons', 'SpaceuxCursorOnly');
    mkdirSync(cursorTheme, { recursive: true });
    writeFileSync(join(cursorTheme, 'index.theme'), '[Icon Theme]\nName=SpaceuxCursorOnly\n');

    set('XDG_DATA_HOME', join(dir, 'data'));
    set('XDG_DATA_DIRS', join(dir, 'empty'));
    // No theme configured: no kdeglobals and no gtk settings.ini here.
    set('XDG_CONFIG_HOME', join(dir, 'no-config'));
  });

  afterAll(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an icon from an installed but unconfigured theme', () => {
    expect(resolveIconFile('spaceux-discover-probe', host)).toBe(
      join(
        dir,
        'data',
        'icons',
        'SpaceuxProbeTheme',
        'scalable',
        'apps',
        'spaceux-discover-probe.svg',
      ),
    );
  });

  it('still returns null for an icon present in no installed theme', () => {
    expect(resolveIconFile('spaceux-absent-probe', host)).toBeNull();
  });
});
