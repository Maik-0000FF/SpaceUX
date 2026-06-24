// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadAppSettings,
  loadInputSettings,
  loadPieAppearance,
  saveAppSettings,
  saveAppSettingsSync,
} from '../src/main/app-settings';

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
    it('fills defaults (light / 0.8 / blur on / label 0.8 / icon 1 / ring 0.5 / center 0.5) when nothing is persisted', async () => {
      expect(await loadPieAppearance()).toEqual({
        theme: 'light',
        opacity: 0.8,
        blur: true,
        labelScale: 0.8,
        iconScale: 1,
        scale: 1,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: '',
        fontMono: '',
        shapeModel: null,
        wedgeStyle: 'classic',
        wedgeGapStyle: 'parallel',
        wedgeGap: 0.027,
        wedgeHoverOffset: 0.03,
        showSubmenuMarkers: true,
        showDepthDots: true,
      });
    });

    it('applies persisted values over the defaults', async () => {
      await saveAppSettings({
        pieTheme: 'light',
        pieOpacity: 0.45,
        pieBlur: true,
        pieLabelScale: 0.6,
        pieIconScale: 0.8,
        pieScale: 1.5,
        pieFontUi: 'Cantarell, sans-serif',
        pieFontMono: 'monospace',
      });
      expect(await loadPieAppearance()).toEqual({
        theme: 'light',
        opacity: 0.45,
        blur: true,
        labelScale: 0.6,
        iconScale: 0.8,
        scale: 1.5,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: 'Cantarell, sans-serif',
        fontMono: 'monospace',
        shapeModel: null,
        wedgeStyle: 'classic',
        wedgeGapStyle: 'parallel',
        wedgeGap: 0.027,
        wedgeHoverOffset: 0.03,
        showSubmenuMarkers: true,
        showDepthDots: true,
      });
    });

    it('falls back per-field when only one is persisted', async () => {
      await saveAppSettings({ pieTheme: 'spaceux' });
      expect(await loadPieAppearance()).toEqual({
        theme: 'spaceux',
        opacity: 0.8,
        blur: true,
        labelScale: 0.8,
        iconScale: 1,
        scale: 1,
        ringBalance: 0.5,
        centerBalance: 0.5,
        fontUi: '',
        fontMono: '',
        shapeModel: null,
        wedgeStyle: 'classic',
        wedgeGapStyle: 'parallel',
        wedgeGap: 0.027,
        wedgeHoverOffset: 0.03,
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

  describe('saveAppSettingsSync (quit-path flush)', () => {
    it('read-merges instead of overwriting, preserving fields the caller omits', async () => {
      // First run persisted the one-shot flag and a grab choice (async merge).
      await saveAppSettings({ autostartSeeded: true, grabWhilePieOpen: false });
      // The quit-path flush writes appearance + grab, but NOT autostartSeeded.
      saveAppSettingsSync({ pieTheme: 'light', grabWhilePieOpen: false });
      const out = await loadAppSettings();
      expect(out.autostartSeeded).toBe(true); // survived the sync write
      expect(out.pieTheme).toBe('light'); // the flushed value landed
      expect(out.grabWhilePieOpen).toBe(false);
    });

    it('lets the passed value win over a stale on-disk one', async () => {
      await saveAppSettings({ pieOpacity: 0.2 });
      saveAppSettingsSync({ pieOpacity: 0.9 });
      expect((await loadAppSettings()).pieOpacity).toBe(0.9);
    });
  });

  describe('loadInputSettings (#327)', () => {
    it('defaults grab-while-pie-open to on when nothing is persisted', async () => {
      expect(await loadInputSettings()).toEqual({ grabWhilePieOpen: true });
    });

    it('round-trips the persisted grab toggle', async () => {
      await saveAppSettings({ grabWhilePieOpen: false });
      expect(await loadInputSettings()).toEqual({ grabWhilePieOpen: false });
    });

    it('drops a non-boolean grab flag and falls back to the default', async () => {
      await writeRaw(JSON.stringify({ grabWhilePieOpen: 'yes' }));
      expect(await loadInputSettings()).toEqual({ grabWhilePieOpen: true });
    });

    it('keeps input settings independent of appearance in the same file', async () => {
      await saveAppSettings({ grabWhilePieOpen: false });
      await saveAppSettings({ pieTheme: 'light' }); // merge must not clobber it
      expect(await loadInputSettings()).toEqual({ grabWhilePieOpen: false });
      expect((await loadPieAppearance()).theme).toBe('light');
    });
  });
});
