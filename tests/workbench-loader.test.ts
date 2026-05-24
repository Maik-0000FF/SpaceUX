// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG } from '@/shared/menu';
import {
  isWorkbenchMenuId,
  makeWorkbenchMenuId,
  parseWorkbenchMenuId,
} from '@/shared/plugin-types';

import {
  deleteWorkbenchMenu,
  listWorkbenchMenus,
  loadWorkbenchMenu,
  workbenchMenuPath,
  writeWorkbenchMenu,
} from '../src/main/workbench-loader';

const PLUGIN = 'org.spaceux.freecad';
const ID = makeWorkbenchMenuId(PLUGIN, 'PartDesignWorkbench');

describe('workbench-menu id helpers', () => {
  it('builds and parses an id (single ":" separator after the prefix)', () => {
    expect(ID).toBe('wb:org.spaceux.freecad:PartDesignWorkbench');
    expect(isWorkbenchMenuId(ID)).toBe(true);
    expect(parseWorkbenchMenuId(ID)).toEqual({
      pluginId: PLUGIN,
      workbenchKey: 'PartDesignWorkbench',
    });
  });

  it('keeps an underscored workbench key intact through id + filename', () => {
    // The plugin id has no underscore, so the first "__" in the filename is the
    // separator even when the key itself contains "__".
    const id = makeWorkbenchMenuId(PLUGIN, 'Foo__Bar');
    expect(parseWorkbenchMenuId(id)).toEqual({ pluginId: PLUGIN, workbenchKey: 'Foo__Bar' });
    expect(path.basename(workbenchMenuPath(id, '/tmp')!)).toBe(
      'org.spaceux.freecad__Foo__Bar.json',
    );
  });

  it('rejects non-workbench / malformed ids', () => {
    expect(isWorkbenchMenuId('plugin:org.spaceux.freecad')).toBe(false);
    expect(isWorkbenchMenuId(null)).toBe(false);
    expect(parseWorkbenchMenuId('wb:')).toBeNull(); // no body
    expect(parseWorkbenchMenuId('wb:onlyplugin')).toBeNull(); // no separator
    expect(parseWorkbenchMenuId('wb::Key')).toBeNull(); // empty plugin id
    expect(parseWorkbenchMenuId('wb:plugin:')).toBeNull(); // empty key
  });

  it('returns null path for a malformed id (guards stray IPC)', () => {
    expect(workbenchMenuPath('plugin:x', '/tmp')).toBeNull();
    expect(workbenchMenuPath('wb:bad/plugin:Key', '/tmp')).toBeNull(); // slash in plugin id
    expect(workbenchMenuPath('wb:org.spaceux.freecad:Bad Key', '/tmp')).toBeNull(); // space in key
  });
});

describe('workbench-menu storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-wb-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports absent when no file exists (un-curated workbench)', async () => {
    expect((await loadWorkbenchMenu(ID, dir)).status).toBe('absent');
  });

  it('reports invalid for a malformed id', async () => {
    expect((await loadWorkbenchMenu('plugin:x', dir)).status).toBe('invalid');
  });

  it('writes a bare MenuConfig and loads it back (migrated + validated)', async () => {
    const written = await writeWorkbenchMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(written.ok).toBe(true);

    const loaded = await loadWorkbenchMenu(ID, dir);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(loaded.path).toBe(workbenchMenuPath(ID, dir));
      expect(typeof loaded.mtime).toBe('number');
    }
  });

  it('conflict-checks the write against the expected mtime', async () => {
    await writeWorkbenchMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    // expectedMtime=null means "no file existed when I loaded" — but one does
    // now, so a second write with null is a conflict, not a silent overwrite.
    const conflict = await writeWorkbenchMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(conflict.ok).toBe('conflict');
  });

  it('reports invalid for present-but-broken JSON', async () => {
    await fs.writeFile(workbenchMenuPath(ID, dir)!, '{ not json', 'utf8');
    expect((await loadWorkbenchMenu(ID, dir)).status).toBe('invalid');
  });

  it('lists curated ids, ignoring junk; missing dir is empty', async () => {
    expect(await listWorkbenchMenus(path.join(dir, 'nope'))).toEqual([]);

    const a = makeWorkbenchMenuId(PLUGIN, 'PartWorkbench');
    const b = makeWorkbenchMenuId(PLUGIN, 'SketcherWorkbench');
    await writeWorkbenchMenu(a, DEFAULT_MENU_CONFIG, null, dir);
    await writeWorkbenchMenu(b, DEFAULT_MENU_CONFIG, null, dir);
    await fs.writeFile(path.join(dir, 'not-a-workbench.txt'), 'x', 'utf8');
    await fs.writeFile(path.join(dir, 'nounderscore.json'), '{}', 'utf8');

    expect(await listWorkbenchMenus(dir)).toEqual([a, b].sort());
  });

  it('deletes a curated pie; missing file and malformed id are success', async () => {
    await writeWorkbenchMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(await deleteWorkbenchMenu(ID, dir)).toEqual({ ok: true });
    expect((await loadWorkbenchMenu(ID, dir)).status).toBe('absent');
    expect(await deleteWorkbenchMenu(ID, dir)).toEqual({ ok: true }); // already gone
    expect(await deleteWorkbenchMenu('plugin:x', dir)).toEqual({ ok: true }); // malformed
  });
});
