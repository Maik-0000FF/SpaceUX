// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAppSettings, loadPieAppearance, saveAppSettings } from '../src/main/app-settings';

let dir: string;
let prevXdg: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-app-settings-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir; // point the settings file at the temp dir
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeRaw(contents: string): Promise<void> {
  const file = path.join(dir, 'spaceux', 'app-settings.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, 'utf8');
}

describe('app-settings', () => {
  it('returns empty settings when no file exists', async () => {
    expect(await loadAppSettings()).toEqual({});
  });

  it('round-trips pieTheme + pieOpacity and merges partial saves', async () => {
    await saveAppSettings({ pieTheme: 'spaceux' });
    await saveAppSettings({ pieOpacity: 0.6 }); // merge, not replace
    expect(await loadAppSettings()).toEqual({ pieTheme: 'spaceux', pieOpacity: 0.6 });
  });

  it('drops an unknown theme', async () => {
    await writeRaw(JSON.stringify({ pieTheme: 'neon', pieOpacity: 0.5 }));
    expect(await loadAppSettings()).toEqual({ pieOpacity: 0.5 });
  });

  it('clamps an out-of-band opacity to the 0–1 range on load', async () => {
    await writeRaw(JSON.stringify({ pieOpacity: 5 }));
    expect((await loadAppSettings()).pieOpacity).toBe(1);
    await writeRaw(JSON.stringify({ pieOpacity: -3 }));
    expect((await loadAppSettings()).pieOpacity).toBe(0);
  });

  it('accepts full transparency (0) as a valid opacity', async () => {
    await saveAppSettings({ pieOpacity: 0 });
    expect((await loadAppSettings()).pieOpacity).toBe(0);
  });

  it('drops a non-numeric opacity', async () => {
    await writeRaw(JSON.stringify({ pieOpacity: 'x', pieTheme: 'light' }));
    expect(await loadAppSettings()).toEqual({ pieTheme: 'light' });
  });

  it('tolerates a corrupt file', async () => {
    await writeRaw('not json');
    expect(await loadAppSettings()).toEqual({});
  });

  describe('loadPieAppearance', () => {
    it('fills defaults (dark / 0.6 / label 1 / icon 0.5 / scale 1 / no font override) when nothing is persisted', async () => {
      expect(await loadPieAppearance()).toEqual({
        theme: 'dark',
        opacity: 0.6,
        labelScale: 1,
        iconScale: 0.5,
        scale: 1,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: '',
        fontMono: '',
        shapeModel: null,
        showSubmenuMarkers: true,
        showDepthDots: true,
      });
    });

    it('applies persisted values over the defaults', async () => {
      await saveAppSettings({
        pieTheme: 'light',
        pieOpacity: 0.45,
        pieLabelScale: 0.6,
        pieIconScale: 0.8,
        pieScale: 1.5,
        pieFontUi: 'Cantarell, sans-serif',
        pieFontMono: 'monospace',
      });
      expect(await loadPieAppearance()).toEqual({
        theme: 'light',
        opacity: 0.45,
        labelScale: 0.6,
        iconScale: 0.8,
        scale: 1.5,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: 'Cantarell, sans-serif',
        fontMono: 'monospace',
        shapeModel: null,
        showSubmenuMarkers: true,
        showDepthDots: true,
      });
    });

    it('falls back per-field when only one is persisted', async () => {
      await saveAppSettings({ pieTheme: 'spaceux' });
      expect(await loadPieAppearance()).toEqual({
        theme: 'spaceux',
        opacity: 0.6,
        labelScale: 1,
        iconScale: 0.5,
        scale: 1,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: '',
        fontMono: '',
        shapeModel: null,
        showSubmenuMarkers: true,
        showDepthDots: true,
      });
    });

    it('normalises a persisted font override (trim + control chars)', async () => {
      await writeRaw(JSON.stringify({ pieFontUi: '  Inter\tDisplay  ' }));
      expect((await loadPieAppearance()).fontUi).toBe('Inter Display');
    });

    it('clamps a persisted pieScale into [0.5, 2]', async () => {
      await saveAppSettings({ pieScale: 99 });
      expect((await loadPieAppearance()).scale).toBe(2);
      await saveAppSettings({ pieScale: 0.1 });
      expect((await loadPieAppearance()).scale).toBe(0.5);
    });
  });
});
