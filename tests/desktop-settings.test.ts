// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_DESKTOP_SETTINGS, sanitizeDesktopSettings } from '../src/shared/desktop-settings';
import { loadDesktopSettings, saveAppSettings } from '../src/main/app-settings';

describe('sanitizeDesktopSettings', () => {
  it('returns defaults for a non-object', () => {
    expect(sanitizeDesktopSettings(undefined)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(sanitizeDesktopSettings(null)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(sanitizeDesktopSettings(42)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    expect(sanitizeDesktopSettings('nope')).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it('fills defaults for missing fields (partial blob)', () => {
    expect(sanitizeDesktopSettings({ enabled: true })).toEqual({
      ...DEFAULT_DESKTOP_SETTINGS,
      enabled: true,
    });
  });

  it('drops wrong-typed top-level fields back to defaults', () => {
    const out = sanitizeDesktopSettings({
      enabled: 'yes',
      activationMode: 'bogus',
      suspendWhilePieOpen: 1,
    });
    expect(out.enabled).toBe(DEFAULT_DESKTOP_SETTINGS.enabled);
    expect(out.activationMode).toBe(DEFAULT_DESKTOP_SETTINGS.activationMode);
    expect(out.suspendWhilePieOpen).toBe(DEFAULT_DESKTOP_SETTINGS.suspendWhilePieOpen);
  });

  it('accepts a valid toggle button and clamps the index to an integer range', () => {
    expect(
      sanitizeDesktopSettings({ activationMode: 'toggle', toggleButton: 2 }).toggleButton,
    ).toBe(2);
    expect(sanitizeDesktopSettings({ toggleButton: 1.5 }).toggleButton).toBe(null); // non-integer
    expect(sanitizeDesktopSettings({ toggleButton: -3 }).toggleButton).toBe(0); // clamped
    expect(sanitizeDesktopSettings({ toggleButton: null }).toggleButton).toBe(null);
  });

  it('forces a toggle button in toggle mode (no unusable null)', () => {
    expect(sanitizeDesktopSettings({ activationMode: 'toggle' }).toggleButton).toBe(0);
    expect(
      sanitizeDesktopSettings({ activationMode: 'toggle', toggleButton: null }).toggleButton,
    ).toBe(0);
    // Always mode leaves it null; the dead-end only matters in toggle mode.
    expect(
      sanitizeDesktopSettings({ activationMode: 'always', toggleButton: null }).toggleButton,
    ).toBe(null);
  });

  it('keeps every axis present, defaulting an unknown function to the axis default', () => {
    const out = sanitizeDesktopSettings({ axes: { rx: { kind: 'telepathy' } } });
    // rx defaults to scroll; an unknown kind falls back to that default.
    expect(out.axes.rx).toEqual(DEFAULT_DESKTOP_SETTINGS.axes.rx);
    // ty default stays 'none' when the input omits it.
    expect(out.axes.ty).toEqual({ kind: 'none' });
  });

  it('validates and clamps a scroll function', () => {
    const out = sanitizeDesktopSettings({
      axes: {
        ty: {
          kind: 'scroll',
          orientation: 'horizontal',
          deadzone: 99999,
          speed: -5,
          curve: 100,
          invert: true,
        },
      },
    });
    expect(out.axes.ty).toEqual({
      kind: 'scroll',
      orientation: 'horizontal',
      deadzone: 400, // clamped to DEADZONE_MAX
      speed: 0.1, // clamped to SPEED_MIN
      curve: 5, // clamped to CURVE_MAX
      invert: true,
    });
  });

  it('defaults a bad scroll orientation to vertical', () => {
    const out = sanitizeDesktopSettings({
      axes: { ty: { kind: 'scroll', orientation: 'sideways' } },
    });
    expect(out.axes.ty).toMatchObject({ kind: 'scroll', orientation: 'vertical' });
  });

  it('validates a discrete axis function (threshold + cooldown clamped)', () => {
    const out = sanitizeDesktopSettings({
      axes: { ry: { kind: 'workspace', threshold: 9000, cooldownMs: -10 } },
    });
    expect(out.axes.ry).toEqual({
      kind: 'workspace',
      threshold: 400, // clamped to THRESHOLD_MAX
      cooldownMs: 0, // clamped to COOLDOWN_MIN
      invert: false,
    });
  });

  it('keeps valid button functions and drops none / unknown / non-integer keys', () => {
    const out = sanitizeDesktopSettings({
      buttons: { 0: 'overview', 1: 'none', 2: 'bogus', foo: 'showDesktop', 3: 'showDesktop' },
    });
    expect(out.buttons).toEqual({ 0: 'overview', 3: 'showDesktop' });
  });

  it('keeps a valid action-bound button and passes its config through', () => {
    const out = sanitizeDesktopSettings({
      buttons: {
        0: { kind: 'action', ref: { id: 'plugin/act', config: { keys: 'alt+Tab' } } },
        1: { kind: 'action', ref: { id: 'builtin/exec' } }, // config optional
      },
    });
    expect(out.buttons).toEqual({
      0: { kind: 'action', ref: { id: 'plugin/act', config: { keys: 'alt+Tab' } } },
      1: { kind: 'action', ref: { id: 'builtin/exec' } },
    });
  });

  it('drops a malformed action button (missing/blank id, non-object config)', () => {
    const out = sanitizeDesktopSettings({
      buttons: {
        0: { kind: 'action', ref: { id: '' } }, // blank id
        1: { kind: 'action', ref: {} }, // no id
        2: { kind: 'action' }, // no ref
        3: { kind: 'action', ref: { id: 'p/a', config: 'nope' } }, // string config dropped, id kept
        4: { kind: 'action', ref: { id: 'p/b', config: ['x'] } }, // array config dropped, id kept
      },
    });
    expect(out.buttons).toEqual({
      3: { kind: 'action', ref: { id: 'p/a' } },
      4: { kind: 'action', ref: { id: 'p/b' } },
    });
  });
});

describe('loadDesktopSettings persistence', () => {
  let dir: string;
  let prevXdg: string | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-desktop-'));
    prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
  });

  afterEach(async () => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file / section is absent', async () => {
    expect(await loadDesktopSettings()).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });

  it('round-trips a saved desktop config', async () => {
    const next = structuredClone(DEFAULT_DESKTOP_SETTINGS);
    next.enabled = true;
    next.axes.rx = {
      kind: 'scroll',
      orientation: 'vertical',
      deadzone: 50,
      speed: 2.5,
      curve: 2,
      invert: false,
    };
    await saveAppSettings({ desktop: next });
    const loaded = await loadDesktopSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.axes.rx).toMatchObject({ kind: 'scroll', speed: 2.5, curve: 2 });
  });

  it('repairs a malformed persisted section to a complete config on load', async () => {
    const file = path.join(dir, 'spaceux', 'app-settings.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        desktop: { enabled: 'maybe', axes: { rx: { kind: 'scroll', deadzone: 1e9 } } },
      }),
      'utf8',
    );
    const loaded = await loadDesktopSettings();
    expect(loaded.enabled).toBe(false); // bad type → default
    expect(loaded.axes.rx).toMatchObject({ kind: 'scroll', deadzone: 400 }); // clamped
    expect(loaded.axes.rz).toEqual(DEFAULT_DESKTOP_SETTINGS.axes.rz); // untouched default
  });
});
