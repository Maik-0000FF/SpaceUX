// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, type MenuConfig } from '@/shared/menu';

import { loadMenuConfig } from '../src/main/menu-loader';
import { writeMenuConfig } from '../src/main/menu-writer';

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-writer-'));
  target = path.join(dir, 'menu.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeMenuConfig', () => {
  it('writes a fresh file (no prior file, expected mtime null) and round-trips', async () => {
    const result = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    expect(result.ok).toBe(true);

    const loaded = await loadMenuConfig([target]);
    expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
    if (result.ok === true) expect(loaded.mtime).toBe(result.mtime);
  });

  it('rejects an invalid config without touching disk', async () => {
    // A missing root fails validation.
    const bad = { version: 1 } as unknown as MenuConfig;
    const result = await writeMenuConfig(target, bad, null);
    expect(result.ok).toBe(false);
    await expect(fs.access(target)).rejects.toBeDefined();
  });

  it('reports a conflict when a file already exists but none was expected', async () => {
    await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    // Editor thinks there is no file (mtime null) but one exists now.
    const result = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    expect(result.ok).toBe('conflict');
  });

  it('reports a conflict on a stale expected mtime', async () => {
    const first = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    expect(first.ok).toBe(true);
    const staleMtime = first.ok === true ? first.mtime - 1000 : 0;
    const result = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, staleMtime);
    expect(result.ok).toBe('conflict');
  });

  it('writes when the expected mtime matches the file', async () => {
    const first = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    const mtime = first.ok === true ? first.mtime : null;
    const second = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, mtime);
    expect(second.ok).toBe(true);
    if (second.ok === true) expect(second.mtime).toBeGreaterThanOrEqual(0);
  });

  it('overwrite-after-conflict succeeds when re-sent with the actual mtime', async () => {
    await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    const conflict = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, null);
    expect(conflict.ok).toBe('conflict');
    // The conflict result carries the on-disk mtime; re-sending with it
    // (the editor's "Overwrite") passes the check.
    const actual = conflict.ok === 'conflict' ? conflict.mtime : null;
    const forced = await writeMenuConfig(target, DEFAULT_MENU_CONFIG, actual);
    expect(forced.ok).toBe(true);
  });
});
