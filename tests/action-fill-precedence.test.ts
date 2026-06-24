// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createExtraCoreService } from '../src/core-host/extra-core-service';
import {
  BUILTIN_ACTION,
  builtinAction,
  MENU_CONFIG_VERSION,
  type MenuConfig,
  type MenuNode,
} from '../src/shared/menu';
import type { HostEnvironment } from '../src/shared/plugin-types';

// The autofill precedence (#419): SetActionConfig / SetActionTarget fill a
// node's label from the action target, and when the *target itself* changes the
// new name takes precedence over a manual label; when the target is unchanged a
// manual label survives. The exec entries have no theme icon so the label (from
// the .desktop Name=) drives those cases; a small hicolor theme holds the mute
// icon so the key-combo cases (#511) exercise the icon path too.

const EXEC = builtinAction(BUILTIN_ACTION.EXEC);
const OPEN_FILE = builtinAction(BUILTIN_ACTION.OPEN_FILE);
const KEY_COMBO = builtinAction(BUILTIN_ACTION.KEY_COMBO);
const LEAF: number[] = [0];

const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;
const svc = createExtraCoreService({ hostEnvironment: host });

function configWith(node: MenuNode): MenuConfig {
  return { version: MENU_CONFIG_VERSION, root: { label: 'root', branches: [node] } };
}
function leafOf(config: MenuConfig): MenuNode {
  return config.root.branches![0]!;
}

describe('action autofill target precedence (#419)', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};
  const set = (key: string, value: string): void => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-fill-precedence-'));
    const apps = join(dir, 'applications');
    mkdirSync(apps, { recursive: true });
    writeFileSync(join(apps, 'foo.desktop'), '[Desktop Entry]\nExec=foo\nName=Foo App\nIcon=foo\n');
    writeFileSync(
      join(apps, 'bar.desktop'),
      '[Desktop Entry]\nExec=bar\nName=Bar Tool\nIcon=bar\n',
    );
    // A hicolor theme holding the mute icon, so a key-combo target resolves an
    // icon (the exec entries have no theme icon, so those stay icon-only).
    const themeApps = join(dir, 'icons', 'hicolor', 'scalable', 'apps');
    mkdirSync(themeApps, { recursive: true });
    writeFileSync(join(themeApps, 'audio-volume-muted.svg'), '<svg/>');
    writeFileSync(
      join(dir, 'icons', 'hicolor', 'index.theme'),
      '[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n\n[scalable/apps]\nContext=Applications\n',
    );
    set('XDG_DATA_HOME', dir);
    set('XDG_DATA_DIRS', dir); // only the temp dir, so no system entry interferes
    set('XDG_CONFIG_HOME', join(dir, 'no-config')); // no kdeglobals -> hicolor chain
  });

  afterAll(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('fills a default label from a freshly typed exec command', async () => {
    const out = await svc.SetActionConfig(
      configWith({ label: 'Item 1', action: { id: EXEC } }),
      LEAF,
      {
        command: 'foo',
      },
    );
    expect(leafOf(out).label).toBe('Foo App');
    expect(leafOf(out).labelAuto).toBe(true);
  });

  it('overwrites a manual exec label when the command changes', async () => {
    const out = await svc.SetActionConfig(
      configWith({ label: 'My Terminal', action: { id: EXEC, config: { command: 'foo' } } }),
      LEAF,
      { command: 'bar' },
    );
    expect(leafOf(out).label).toBe('Bar Tool');
    expect(leafOf(out).labelAuto).toBe(true);
  });

  it('keeps a manual exec label when the command is unchanged', async () => {
    const out = await svc.SetActionConfig(
      configWith({ label: 'My Terminal', action: { id: EXEC, config: { command: 'foo' } } }),
      LEAF,
      { command: 'foo' },
    );
    expect(leafOf(out).label).toBe('My Terminal');
    expect(leafOf(out).labelAuto).toBeUndefined();
  });

  it('overwrites a manual open-file label when a different file is picked', async () => {
    const out = await svc.SetActionTarget(
      configWith({ label: 'Notes', action: { id: OPEN_FILE, config: { path: '/a/old.md' } } }),
      LEAF,
      '/a/new-doc.md',
    );
    expect(leafOf(out).label).toBe('new-doc.md');
    expect(leafOf(out).labelAuto).toBe(true);
  });

  it('keeps a manual open-file label when the same file is picked again', async () => {
    const out = await svc.SetActionTarget(
      configWith({ label: 'Notes', action: { id: OPEN_FILE, config: { path: '/a/doc.md' } } }),
      LEAF,
      '/a/doc.md',
    );
    expect(leafOf(out).label).toBe('Notes');
    expect(leafOf(out).labelAuto).toBeUndefined();
  });

  // A media key fills its own short name + icon, so a stale auto label (e.g.
  // "wezterm" left from a program before switching the action) is replaced, not
  // stranded (#511 follow-up).
  it('replaces a stale auto label with the key combo name and icon', async () => {
    const out = await svc.SetActionConfig(
      configWith({ label: 'wezterm', labelAuto: true, action: { id: KEY_COMBO } }),
      LEAF,
      { keys: 'XF86AudioMute' },
    );
    expect(leafOf(out).label).toBe('Mute');
    expect(leafOf(out).labelAuto).toBe(true);
    expect(leafOf(out).icon).toMatch(/^data:image\/svg\+xml/);
  });

  it('keeps a manual key-combo label when the chord is unchanged', async () => {
    const out = await svc.SetActionConfig(
      configWith({
        label: 'My Mute',
        action: { id: KEY_COMBO, config: { keys: 'XF86AudioMute' } },
      }),
      LEAF,
      { keys: 'XF86AudioMute' },
    );
    expect(leafOf(out).label).toBe('My Mute');
    expect(leafOf(out).labelAuto).toBeUndefined();
  });

  it('leaves the label untouched for an unmapped chord (no name, no icon)', async () => {
    const out = await svc.SetActionConfig(
      configWith({ label: 'wezterm', labelAuto: true, action: { id: KEY_COMBO } }),
      LEAF,
      { keys: 'alt+Tab' },
    );
    expect(leafOf(out).label).toBe('wezterm');
    expect(leafOf(out).icon).toBeUndefined();
  });
});
