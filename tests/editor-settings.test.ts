// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEditorSettings, saveEditorSettings } from '../src/main/editor-settings';

let dir: string;
let prevXdg: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-settings-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir; // point the settings file at the temp dir
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('editor-settings', () => {
  it('returns empty settings when no file exists', async () => {
    expect(await loadEditorSettings()).toEqual({});
  });

  it('round-trips window + theme and merges partial saves', async () => {
    await saveEditorSettings({ window: { width: 800, height: 600, x: 10, y: 20 } });
    await saveEditorSettings({ theme: 'spaceux' }); // merge, not replace
    expect(await loadEditorSettings()).toEqual({
      window: { width: 800, height: 600, x: 10, y: 20 },
      theme: 'spaceux',
    });
  });

  it('drops an unknown theme and a malformed window', async () => {
    const file = path.join(dir, 'spaceux', 'editor-settings.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ theme: 'neon', window: { width: 'x' } }), 'utf8');
    expect(await loadEditorSettings()).toEqual({});
  });

  it('tolerates a corrupt file', async () => {
    const file = path.join(dir, 'spaceux', 'editor-settings.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json', 'utf8');
    expect(await loadEditorSettings()).toEqual({});
  });
});
