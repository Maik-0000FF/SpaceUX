// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, MENU_CONFIG_VERSION } from '@/shared/menu';

import { loadMenuConfig } from '../src/main/menu-loader';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-loader-'));
  file = path.join(dir, 'menu.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const writeConfig = (obj: unknown) => fs.writeFile(file, JSON.stringify(obj), 'utf8');

describe('loadMenuConfig migration handling', () => {
  it('loads a current-version config without falling back', async () => {
    await writeConfig(DEFAULT_MENU_CONFIG);
    const result = await loadMenuConfig([file]);
    expect(result.fallbackReason).toBeNull();
    expect(result.config).toEqual(DEFAULT_MENU_CONFIG);
  });

  it('falls back to default for a version newer than supported', async () => {
    await writeConfig({ ...DEFAULT_MENU_CONFIG, version: MENU_CONFIG_VERSION + 1 });
    const result = await loadMenuConfig([file]);
    expect(result.config).toBe(DEFAULT_MENU_CONFIG);
    expect(result.fallbackReason).toMatch(/newer than supported/);
  });

  it('falls back when an older version has no registered migration', async () => {
    await writeConfig({ ...DEFAULT_MENU_CONFIG, version: MENU_CONFIG_VERSION - 1 });
    const result = await loadMenuConfig([file]);
    expect(result.config).toBe(DEFAULT_MENU_CONFIG);
    expect(result.fallbackReason).toMatch(/no migration registered/);
  });
});
