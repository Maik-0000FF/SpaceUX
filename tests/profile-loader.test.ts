// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, MENU_CONFIG_VERSION } from '@/shared/menu';
import { DEFAULT_PIE_APPEARANCE } from '@/shared/pie-appearance';

import {
  deleteDeviceProfile,
  deviceProfileId,
  deviceProfilePath,
  isProfileId,
  listDeviceProfiles,
  loadDeviceProfile,
  resolveActiveConfig,
  resolvePluginMenuConfig,
  writeDeviceProfile,
  writeDeviceProfileSync,
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

  it('keeps the menu valid when the wrapper appearance is garbage (sanitized, not rejected)', async () => {
    // A broken appearance section must not invalidate the whole profile —
    // bad fields are dropped/clamped over the defaults.
    await write('046d-c62b', {
      menu: DEFAULT_MENU_CONFIG,
      appearance: { theme: 'bogus-theme', opacity: 5 },
    });
    const result = await loadDeviceProfile('046d-c62b', dir);
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.config).toEqual(DEFAULT_MENU_CONFIG);
      // 'bogus-theme' dropped → default 'light'; opacity 5 clamped → 1;
      // labelScale + iconScale + scale + balances + fonts absent → defaults.
      expect(result.appearance).toEqual({
        theme: 'light',
        opacity: 1,
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
    }
  });

  it('reports invalid when the profile fails schema validation', async () => {
    await write('046d-c62b', { version: MENU_CONFIG_VERSION, root: 'nope' });
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
  const profileAppearance = {
    theme: 'spaceux' as const,
    opacity: 0.8,
    blur: false,
    labelScale: 1,
    iconScale: 1,
    scale: 1,
    ringBalance: 0.5,
    centerBalance: 0.5,
    fontUi: '',
    fontMono: '',
    shapeModel: null,
    wedgeStyle: 'classic' as const,
    wedgeGapStyle: 'parallel' as const,
    wedgeGap: 0.027,
    wedgeHoverOffset: 0.03,
    showSubmenuMarkers: true,
    showDepthDots: true,
  };
  const loaded: ProfileLoadResult = {
    status: 'loaded',
    config: profileConfig,
    appearance: profileAppearance,
    mtime: 222,
    path: '/cfg/profiles/046d-c62b.json',
  };

  it('uses the profile (config + appearance) when one loaded for the device', () => {
    const active = resolveActiveConfig('046d-c62b', loaded, fallback);
    expect(active).toEqual({
      config: profileConfig,
      mtime: 222,
      source: '/cfg/profiles/046d-c62b.json',
      profileId: '046d-c62b',
      appearance: profileAppearance,
    });
  });

  it('falls back (appearance null = keep global) when the device has no profile file', () => {
    const active = resolveActiveConfig('046d-c62b', { status: 'absent' }, fallback);
    expect(active).toEqual({ ...fallback, profileId: null, appearance: null });
  });

  it('falls back (with profileId null) when the profile is invalid', () => {
    const active = resolveActiveConfig('046d-c62b', { status: 'invalid', reason: 'bad' }, fallback);
    expect(active).toEqual({ ...fallback, profileId: null, appearance: null });
  });

  it('falls back when there is no device (null id / null profile)', () => {
    const active = resolveActiveConfig(null, null, fallback);
    expect(active).toEqual({ ...fallback, profileId: null, appearance: null });
  });
});

describe('resolvePluginMenuConfig', () => {
  const fallback: FallbackMenu = {
    config: { ...DEFAULT_MENU_CONFIG, triggerButton: 3 },
    mtime: 111,
    source: '/cfg/menu.json',
  };
  const root = { label: '', branches: [{ label: 'Item' }] };

  it("overlays the plugin's content onto the user's base config", () => {
    const active = resolvePluginMenuConfig(root, fallback, 'plugin:org.x');
    expect(active.config.root).toBe(root); // plugin content
    expect(active.config.triggerButton).toBe(3); // user's base preserved
    expect(active.profileId).toBe('plugin:org.x');
  });

  it('is read-only (source null) and keeps the global appearance (null)', () => {
    const active = resolvePluginMenuConfig(root, fallback, 'plugin:org.x');
    expect(active.source).toBeNull();
    expect(active.appearance).toBeNull();
  });

  it('does not mutate the fallback config', () => {
    resolvePluginMenuConfig(root, fallback, 'plugin:org.x');
    expect(fallback.config.root).not.toBe(root);
  });
});

describe('isProfileId', () => {
  it('accepts a 4-4 lowercase hex id and rejects anything else', () => {
    expect(isProfileId('046d-c62b')).toBe(true);
    expect(isProfileId('0001-0002')).toBe(true);
    expect(isProfileId('046D-C62B')).toBe(false); // uppercase
    expect(isProfileId('46d-c62b')).toBe(false); // not padded
    expect(isProfileId('../etc/passwd')).toBe(false); // path traversal
    expect(isProfileId('046dc62b')).toBe(false); // no separator
  });
});

describe('listDeviceProfiles / writeDeviceProfile / deleteDeviceProfile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-profiles-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lists only well-formed profile ids, sorted, ignoring stray files', async () => {
    await fs.writeFile(path.join(dir, '046d-c62b.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, '0001-0002.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x', 'utf8'); // not .json
    await fs.writeFile(path.join(dir, 'garbage.json'), '{}', 'utf8'); // not an id
    expect(await listDeviceProfiles(dir)).toEqual(['0001-0002', '046d-c62b']);
  });

  it('returns an empty list when the profiles dir does not exist', async () => {
    expect(await listDeviceProfiles(path.join(dir, 'nope'))).toEqual([]);
  });

  it('writes a profile (menu + appearance) that round-trips via the loader', async () => {
    const appearance = {
      theme: 'light' as const,
      opacity: 0.4,
      blur: false,
      labelScale: 0.8,
      iconScale: 0.8,
      scale: 1,
      ringBalance: 0.5,
      centerBalance: 0.5,
      fontUi: 'Cantarell, sans-serif',
      fontMono: '',
      shapeModel: null,
      wedgeStyle: 'classic' as const,
      wedgeGapStyle: 'parallel' as const,
      wedgeGap: 0.027,
      wedgeHoverOffset: 0.03,
      showSubmenuMarkers: true,
      showDepthDots: true,
    };
    const result = await writeDeviceProfile('046d-c62b', DEFAULT_MENU_CONFIG, appearance, dir);
    expect(result.ok).toBe(true);
    const loaded = await loadDeviceProfile('046d-c62b', dir);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(loaded.appearance).toEqual(appearance);
    }
  });

  it('loads an old bare-MenuConfig profile (no wrapper) with appearance null', async () => {
    // Pre-PR-3c profiles were the bare MenuConfig at the top level.
    await fs.writeFile(deviceProfilePath('046d-c62b', dir), JSON.stringify(DEFAULT_MENU_CONFIG));
    const loaded = await loadDeviceProfile('046d-c62b', dir);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(loaded.appearance).toBeNull(); // no override → caller keeps global
    }
  });

  it('writeDeviceProfileSync (quit-path) writes a profile that round-trips', async () => {
    const appearance = {
      theme: 'spaceux' as const,
      opacity: 0.3,
      blur: false,
      labelScale: 1,
      iconScale: 1,
      scale: 1,
      ringBalance: 0.5,
      centerBalance: 0.5,
      fontUi: '',
      fontMono: '',
      shapeModel: null,
      wedgeStyle: 'classic' as const,
      wedgeGapStyle: 'parallel' as const,
      wedgeGap: 0.027,
      wedgeHoverOffset: 0.03,
      showSubmenuMarkers: true,
      showDepthDots: true,
    };
    writeDeviceProfileSync('046d-c62b', DEFAULT_MENU_CONFIG, appearance, dir);
    const loaded = await loadDeviceProfile('046d-c62b', dir);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(loaded.appearance).toEqual(appearance);
    }
  });

  it('overwrites an existing profile without a conflict (deliberate save)', async () => {
    await writeDeviceProfile('046d-c62b', DEFAULT_MENU_CONFIG, DEFAULT_PIE_APPEARANCE, dir);
    const changed = { ...DEFAULT_MENU_CONFIG, triggerButton: 4 };
    const result = await writeDeviceProfile('046d-c62b', changed, DEFAULT_PIE_APPEARANCE, dir);
    expect(result.ok).toBe(true);
    const loaded = await loadDeviceProfile('046d-c62b', dir);
    if (loaded.status === 'loaded') expect(loaded.config.triggerButton).toBe(4);
  });

  it('deletes a profile, and treats a missing file as success', async () => {
    await writeDeviceProfile('046d-c62b', DEFAULT_MENU_CONFIG, DEFAULT_PIE_APPEARANCE, dir);
    expect(await deleteDeviceProfile('046d-c62b', dir)).toEqual({ ok: true });
    expect((await loadDeviceProfile('046d-c62b', dir)).status).toBe('absent');
    // Idempotent: deleting again still succeeds.
    expect(await deleteDeviceProfile('046d-c62b', dir)).toEqual({ ok: true });
  });
});
