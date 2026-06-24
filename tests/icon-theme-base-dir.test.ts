// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveIconFile } from '../src/main/icon-theme';
import type { HostEnvironment } from '../src/shared/plugin-types';

const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;

// Regression: an icon installed under one base dir's hicolor theme must resolve
// even when the index.theme that declares the theme's Directories= lives in a
// different base dir. A program installed under /usr/local drops its icon in
// /usr/local/share/icons/hicolor while only /usr/share/icons/hicolor carries the
// index.theme; the theme is logically merged across base dirs, so the dir list
// is taken from wherever it is defined and probed under every base that has the
// theme. The icon-theme lookup is cached on the first resolve, so this file is
// the sole resolver test and seeds the environment in beforeAll.
describe('resolveIconFile across spread base dirs', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string): void => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-icon-spread-'));
    // The "per-user" base carries the icon, but has no index.theme of its own.
    const iconDir = join(dir, 'home', 'icons', 'hicolor', 'scalable', 'apps');
    mkdirSync(iconDir, { recursive: true });
    writeFileSync(join(iconDir, 'spaceux-spread-probe.svg'), '<svg/>');
    // The "system" base carries only the hicolor index.theme (declares the dirs).
    const sysHicolor = join(dir, 'sys', 'icons', 'hicolor');
    mkdirSync(sysHicolor, { recursive: true });
    writeFileSync(
      join(sysHicolor, 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n\n[scalable/apps]\nContext=Applications\n',
    );
    set('XDG_DATA_HOME', join(dir, 'home'));
    set('XDG_DATA_DIRS', join(dir, 'sys'));
    // No kdeglobals here, so theme detection falls back to the hicolor chain.
    set('XDG_CONFIG_HOME', join(dir, 'no-config'));
  });

  afterAll(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves an icon whose base dir has no index.theme of its own', () => {
    expect(resolveIconFile('spaceux-spread-probe', host)).toBe(
      join(dir, 'home', 'icons', 'hicolor', 'scalable', 'apps', 'spaceux-spread-probe.svg'),
    );
  });

  it('still returns null for an icon that is in no base dir', () => {
    expect(resolveIconFile('spaceux-no-such-icon', host)).toBeNull();
  });
});
