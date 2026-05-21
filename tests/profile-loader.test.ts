// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, MENU_CONFIG_VERSION } from '@/shared/menu';

import {
  deviceProfileId,
  deviceProfilePath,
  loadDeviceProfile,
  resolveActiveConfig,
  type FallbackMenu,
  type ProfileLoadResult,
} from '../src/main/profile-loader';

describe('deviceProfileId', () => {
  it('formats VID:PID as zero-padded lowercase hex', () => {
    // 0x046d / 0xc62b — a real SpaceNavigator id.
    expect(deviceProfileId(0x046d, 0xc62b)).toBe('046d-c62b');
    // Padding: small ids keep four digits each.
    expect(deviceProfileId(0x1, 0x2)).toBe('0001-0002');
  });

  it('returns null when there is no device to key on', () => {
    // 0 is the daemon's "none / unknown" sentinel for vendor and product.
    expect(deviceProfileId(0, 0)).toBeNull();
    expect(deviceProfileId(0x046d, 0)).toBeNull();
    expect(deviceProfileId(0, 0xc62b)).toBeNull();
  });
});

describe('loadDeviceProfile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-profile-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = (id: string, obj: unknown) =>
    fs.writeFile(deviceProfilePath(id, dir), JSON.stringify(obj), 'utf8');

  it('reports absent when no profile file exists (the common case)', async () => {
    const result = await loadDeviceProfile('046d-c62b', dir);
    expect(result.status).toBe('absent');
  });

  it('loads and validates a present profile (same format as menu.json)', async () => {
    await write('046d-c62b', DEFAULT_MENU_CONFIG);
    const result = await loadDeviceProfile('046d-c62b', dir);
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(result.path).toBe(deviceProfilePath('046d-c62b', dir));
      expect(typeof result.mtime).toBe('number');
    }
  });

  it('reports invalid (not absent) for malformed JSON, so the caller can warn', async () => {
    await fs.writeFile(deviceProfilePath('046d-c62b', dir), '{ not json', 'utf8');
    const result = await loadDeviceProfile('046d-c62b', dir);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toMatch(/not valid JSON/);
  });

  it('reports invalid when the profile fails schema validation', async () => {
    await write('046d-c62b', { version: MENU_CONFIG_VERSION, sectors: 'nope' });
    const result = await loadDeviceProfile('046d-c62b', dir);
    expect(result.status).toBe('invalid');
  });
});

describe('resolveActiveConfig', () => {
  const fallback: FallbackMenu = {
    config: DEFAULT_MENU_CONFIG,
    mtime: 111,
    source: '/cfg/menu.json',
  };
  const profileConfig = { ...DEFAULT_MENU_CONFIG, triggerButton: 3 };
  const loaded: ProfileLoadResult = {
    status: 'loaded',
    config: profileConfig,
    mtime: 222,
    path: '/cfg/profiles/046d-c62b.json',
  };

  it('uses the profile when one loaded for the device', () => {
    const active = resolveActiveConfig('046d-c62b', loaded, fallback);
    expect(active).toEqual({
      config: profileConfig,
      mtime: 222,
      source: '/cfg/profiles/046d-c62b.json',
      profileId: '046d-c62b',
    });
  });

  it('falls back when the device has no profile file (absent)', () => {
    const active = resolveActiveConfig('046d-c62b', { status: 'absent' }, fallback);
    expect(active).toEqual({ ...fallback, profileId: null });
  });

  it('falls back (with profileId null) when the profile is invalid', () => {
    const active = resolveActiveConfig('046d-c62b', { status: 'invalid', reason: 'bad' }, fallback);
    expect(active).toEqual({ ...fallback, profileId: null });
  });

  it('falls back when there is no device (null id / null profile)', () => {
    const active = resolveActiveConfig(null, null, fallback);
    expect(active).toEqual({ ...fallback, profileId: null });
  });
});
