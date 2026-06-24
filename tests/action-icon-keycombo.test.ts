// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveActionFill } from '../src/main/action-icon';
import type { HostEnvironment } from '../src/shared/plugin-types';

const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;

// resolveActionFill for a key-combo (#511): the keysym maps to a freedesktop
// icon name, which is then resolved from the active icon theme (no bundled
// image). A temp theme holding audio-volume-muted.svg isolates this from the
// real system; the icon-theme lookup is cached on first resolve, so this file
// seeds the environment in beforeAll.
describe('resolveActionFill key-combo (#511)', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string): void => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-keycombo-icon-'));
    const apps = join(dir, 'icons', 'hicolor', 'scalable', 'apps');
    mkdirSync(apps, { recursive: true });
    writeFileSync(join(apps, 'audio-volume-muted.svg'), '<svg/>');
    writeFileSync(
      join(dir, 'icons', 'hicolor', 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n\n[scalable/apps]\nContext=Applications\n',
    );
    set('XDG_DATA_HOME', dir);
    set('XDG_DATA_DIRS', dir);
    set('XDG_CONFIG_HOME', join(dir, 'no-config'));
  });

  afterAll(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the keysym icon as a data URI and a short label', async () => {
    const fill = await resolveActionFill('key-combo', 'XF86AudioMute', host);
    expect(fill.icon).toMatch(/^data:image\/svg\+xml/);
    expect(fill.label).toBe('Mute');
  });

  it('resolves the icon + label through a modifier-prefixed chord too', async () => {
    const fill = await resolveActionFill('key-combo', 'ctrl+XF86AudioMute', host);
    expect(fill.icon).toMatch(/^data:image\/svg\+xml/);
    expect(fill.label).toBe('Mute');
  });

  it('returns no icon and no label for a plain shortcut', async () => {
    const fill = await resolveActionFill('key-combo', 'alt+Tab', host);
    expect(fill.icon).toBeNull();
    expect(fill.label).toBeNull();
  });
});
