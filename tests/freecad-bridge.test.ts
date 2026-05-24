// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bridgeInstalledAt,
  installBridge,
  resolveFreecadModDir,
  uninstallBridge,
} from '../src/main/freecad-bridge';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-fc-'));
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

/** Create `<home>/.local/share/FreeCAD/<sub>` (recursively). */
const mkFc = (sub: string) =>
  fs.mkdir(path.join(home, '.local', 'share', 'FreeCAD', sub), { recursive: true });
const NO_ENV: NodeJS.ProcessEnv = {};

describe('resolveFreecadModDir', () => {
  it('picks the highest vMAJOR-MINOR data dir', async () => {
    await mkFc('v1-1');
    await mkFc('v1-2');
    await mkFc('v0-21');
    const r = resolveFreecadModDir(home, NO_ENV);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.label).toBe('v1-2');
      expect(r.modDir).toBe(path.join(home, '.local/share/FreeCAD/v1-2/Mod'));
    }
  });

  it('compares versions numerically (v1-10 > v1-9)', async () => {
    await mkFc('v1-9');
    await mkFc('v1-10');
    const r = resolveFreecadModDir(home, NO_ENV);
    expect(r.ok && r.label).toBe('v1-10');
  });

  it('falls back to the legacy unversioned layout when no version dir exists', async () => {
    await mkFc(''); // just <data>/FreeCAD
    const r = resolveFreecadModDir(home, NO_ENV);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.label).toBe('unversioned');
      expect(r.modDir).toBe(path.join(home, '.local/share/FreeCAD/Mod'));
    }
  });

  it('honours XDG_DATA_HOME', async () => {
    const xdg = path.join(home, 'xdg');
    await fs.mkdir(path.join(xdg, 'FreeCAD', 'v1-2'), { recursive: true });
    const r = resolveFreecadModDir(home, { XDG_DATA_HOME: xdg });
    expect(r.ok && r.modDir).toBe(path.join(xdg, 'FreeCAD/v1-2/Mod'));
  });

  it('reports a Flatpak/Snap install as unsupported (sandbox)', async () => {
    await fs.mkdir(path.join(home, '.var/app/org.freecad.FreeCAD'), { recursive: true });
    const r = resolveFreecadModDir(home, NO_ENV);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sandbox).toBe(true);
  });

  it('reports no FreeCAD data dir when nothing is found', () => {
    const r = resolveFreecadModDir(home, NO_ENV);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sandbox).toBe(false);
  });
});

describe('install / uninstall', () => {
  let src: string;
  let modDir: string;

  beforeEach(async () => {
    src = path.join(home, 'addon'); // the plugin's freecad/ folder
    await fs.mkdir(path.join(src, '__pycache__'), { recursive: true });
    await fs.writeFile(path.join(src, 'InitGui.py'), 'init', 'utf8');
    await fs.writeFile(path.join(src, 'spaceux_bridge.py'), 'bridge', 'utf8');
    await fs.writeFile(path.join(src, '__pycache__', 'x.pyc'), 'cache', 'utf8');
    modDir = path.join(home, 'Mod'); // doesn't exist yet → install creates it
  });

  it('copies the addon to <modDir>/SpaceUX, excluding __pycache__', async () => {
    expect(bridgeInstalledAt(modDir)).toBe(false);
    const res = await installBridge(src, modDir);
    expect(res.ok).toBe(true);
    expect(bridgeInstalledAt(modDir)).toBe(true);

    const dest = path.join(modDir, 'SpaceUX');
    expect(await fs.readFile(path.join(dest, 'spaceux_bridge.py'), 'utf8')).toBe('bridge');
    expect(await fs.readFile(path.join(dest, 'InitGui.py'), 'utf8')).toBe('init');
    // __pycache__ is filtered out.
    await expect(fs.stat(path.join(dest, '__pycache__'))).rejects.toThrow();
  });

  it('re-install replaces the existing addon (no stale files)', async () => {
    await installBridge(src, modDir);
    await fs.writeFile(path.join(modDir, 'SpaceUX', 'stale.py'), 'old', 'utf8');
    await installBridge(src, modDir);
    await expect(fs.stat(path.join(modDir, 'SpaceUX', 'stale.py'))).rejects.toThrow();
    expect(await fs.readFile(path.join(modDir, 'SpaceUX', 'spaceux_bridge.py'), 'utf8')).toBe(
      'bridge',
    );
  });

  it('uninstall removes the addon; a missing one is success', async () => {
    await installBridge(src, modDir);
    expect(await uninstallBridge(modDir)).toEqual({ ok: true });
    expect(bridgeInstalledAt(modDir)).toBe(false);
    expect(await uninstallBridge(modDir)).toEqual({ ok: true }); // already gone
  });
});
