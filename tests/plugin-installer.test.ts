// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importPluginFromFolder, uninstallPlugin } from '../src/main/plugin-installer';
import { pluginInstallDir } from '../src/main/plugin-loader';

let tmp: string;
let savedXdg: string | undefined;

// Point the managed extensions root at a temp dir by overriding
// XDG_DATA_HOME (userExtensionsRoot honours it), so importing writes under
// the temp tree and never touches the real ~/.local/share.
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-installer-'));
  savedXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(tmp, 'data');
});

afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = savedXdg;
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Write a minimal valid plugin folder under tmp/src/<name> and return it. */
async function makeSrcPlugin(
  name: string,
  manifest: Record<string, unknown>,
  withIndex = true,
): Promise<string> {
  const dir = path.join(tmp, 'src', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  if (withIndex)
    await fs.writeFile(path.join(dir, 'index.js'), 'export const actions = {};', 'utf8');
  return dir;
}

const functionManifest = (id: string) => ({
  apiVersion: 1,
  kind: 'function',
  id,
  name: 'Demo',
  version: '1.0.0',
  license: 'GPL-3.0-or-later',
  actions: [{ name: 'go', label: 'Go' }],
});

describe('importPluginFromFolder', () => {
  it('copies a valid function plugin into extensions/function/<id>/', async () => {
    const src = await makeSrcPlugin('demo', functionManifest('org.demo.fn'));
    const result = await importPluginFromFolder(src);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dir).toBe(pluginInstallDir('function', 'org.demo.fn'));
      expect(result.manifest.id).toBe('org.demo.fn');
    }
    // The folder's files actually landed in the target.
    const copied = await fs.readFile(
      path.join(pluginInstallDir('function', 'org.demo.fn'), 'manifest.json'),
      'utf8',
    );
    expect(JSON.parse(copied).id).toBe('org.demo.fn');
  });

  it('routes a theme plugin into extensions/theme/<id>/ (no actions required)', async () => {
    const src = await makeSrcPlugin(
      'thm',
      {
        apiVersion: 1,
        kind: 'theme',
        id: 'org.demo.thm',
        name: 'T',
        version: '1.0.0',
        license: 'GPL-3.0-or-later',
      },
      false,
    );
    const result = await importPluginFromFolder(src);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dir).toBe(pluginInstallDir('theme', 'org.demo.thm'));
  });

  it('rejects a folder without a valid manifest', async () => {
    const dir = path.join(tmp, 'src', 'junk');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'manifest.json'), '{ not json', 'utf8');
    const result = await importPluginFromFolder(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a valid plugin folder/);
  });

  it('imports a manifest carrying an unrelated top-level "reason" key', async () => {
    // Guards the explicit `ok` discriminant in readPluginManifest: unknown
    // fields are allowed, so a "reason" key must not be mistaken for a load
    // failure (it would be under a `'reason' in result` check).
    const src = await makeSrcPlugin('reasonkey', {
      ...functionManifest('org.demo.reason'),
      reason: 'just a field',
    });
    const result = await importPluginFromFolder(src);
    expect(result.ok).toBe(true);
  });

  it('rejects a manifest id that is unsafe as a path segment', async () => {
    // The id `../../etc/evil` carries slashes, leading dot, and `..` — every
    // one of those is rejected by the manifest validator's charset rule, so
    // the import fails at the manifest-read step (wrapped as "not a valid
    // plugin folder") before any filesystem write happens.
    const src = await makeSrcPlugin('eviltree', functionManifest('../../etc/evil'));
    const result = await importPluginFromFolder(src);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/manifest field "id"/);
  });

  it('replaces an existing install on re-import (clean update, no orphans)', async () => {
    const src1 = await makeSrcPlugin('v1', functionManifest('org.demo.upd'));
    await fs.writeFile(path.join(src1, 'stale.txt'), 'old', 'utf8');
    await importPluginFromFolder(src1);

    const src2 = await makeSrcPlugin('v2', functionManifest('org.demo.upd'));
    await importPluginFromFolder(src2);

    // The stale file from the first import must be gone after re-import.
    await expect(
      fs.access(path.join(pluginInstallDir('function', 'org.demo.upd'), 'stale.txt')),
    ).rejects.toThrow();
  });
});

describe('uninstallPlugin', () => {
  it('deletes an installed plugin folder', async () => {
    const src = await makeSrcPlugin('demo', functionManifest('org.demo.del'));
    await importPluginFromFolder(src);
    const target = pluginInstallDir('function', 'org.demo.del');
    await fs.access(target); // present

    const result = await uninstallPlugin('function', 'org.demo.del');
    expect(result.ok).toBe(true);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it('treats a missing folder as success', async () => {
    expect((await uninstallPlugin('function', 'org.demo.absent')).ok).toBe(true);
  });

  it('rejects an unsafe id', async () => {
    const result = await uninstallPlugin('function', '../../etc');
    expect(result.ok).toBe(false);
  });
});
