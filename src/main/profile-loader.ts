// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { MenuWriteResult, PieAppearance } from '../shared/ipc.js';
import {
  serializeMenuConfig,
  validateMenuConfig,
  type MenuConfig,
  type MenuNode,
} from '../shared/menu.js';
import { DEFAULT_PIE_APPEARANCE, sanitizePieAppearancePatch } from '../shared/pie-appearance.js';

import { migrateAndValidateMenuConfig, spaceuxConfigDirs } from './menu-loader.js';

/**
 * Per-device config profiles (#113).
 *
 * Each connected SpaceMouse model can have its own config, stored at
 * `$XDG_CONFIG_HOME/spaceux/profiles/<vid>-<pid>.json` as a wrapper
 * `{ menu: MenuConfig, appearance?: PieAppearance }` (#113 PR 3c-3 added
 * the bundled appearance). Older profiles written as a bare MenuConfig
 * (PR 3b) still load — see loadDeviceProfile's format detection. The id
 * is the USB VID:PID in lowercase hex — evdev exposes no serial, so a
 * profile is per *model*, not per physical unit.
 *
 * This module is pure I/O + path logic so it stays unit-testable. Main
 * decides *when* to switch profiles (on a daemon device-change event)
 * and falls back to the global menu.json + app-settings appearance
 * whenever a device has no profile, is unknown, or its file is unreadable.
 */

const PROFILES_SUBDIR = 'profiles';

/** Zero-padded 4-digit lowercase hex for a USB id (16-bit). */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).padStart(4, '0');
}

/**
 * Profile id for a device, or `null` when there's no device to key on
 * (vendor or product is 0 — the daemon's "none / unknown" sentinel).
 * Format: `"046d-c62b"`.
 */
export function deviceProfileId(vendor: number, product: number): string | null {
  if (!vendor || !product) return null;
  return `${hex4(vendor)}-${hex4(product)}`;
}

/** Directory holding the per-device profile files, under the menu
 *  loader's primary config dir (the first {@link spaceuxConfigDirs}
 *  entry — `$XDG_CONFIG_HOME/spaceux` if set, else `~/.config/spaceux`). */
export function deviceProfilesDir(): string {
  return path.join(spaceuxConfigDirs()[0]!, PROFILES_SUBDIR);
}

/** Absolute path of a profile file by id. */
export function deviceProfilePath(id: string, dir: string = deviceProfilesDir()): string {
  return path.join(dir, `${id}.json`);
}

/**
 * Outcome of loading a device profile:
 *   - `loaded`  — file present, parsed, migrated + validated; use it.
 *   - `absent`  — no file for this device; caller uses the global fallback.
 *   - `invalid` — file present but unreadable/bad JSON/failed validation;
 *                 caller uses the fallback and should log `reason`.
 */
export type ProfileLoadResult =
  | {
      status: 'loaded';
      config: MenuConfig;
      /** The profile's bundled appearance, or null when the file specifies
       *  none (old bare-MenuConfig profiles, or a wrapper without the key) —
       *  the caller then keeps the global appearance. */
      appearance: PieAppearance | null;
      mtime: number | null;
      path: string;
    }
  | { status: 'absent' }
  | { status: 'invalid'; reason: string };

/**
 * Load the profile for `id` from `dir`. A missing file is `absent`
 * (the expected case for a device the user hasn't customised) and is
 * distinct from `invalid` (a present-but-broken file) so the caller can
 * stay quiet for the former and warn for the latter.
 *
 * Format: the new wrapper `{ menu, appearance? }` (has a `menu` key), or
 * an old bare MenuConfig (PR 3b — no `menu` key) treated as menu-only.
 */
export async function loadDeviceProfile(
  id: string,
  dir: string = deviceProfilesDir(),
): Promise<ProfileLoadResult> {
  const file = deviceProfilePath(id, dir);

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent' };
    return { status: 'invalid', reason: `${file}: ${describeError(err)}` };
  }

  // Best-effort mtime for the editor's conflict baseline (same posture
  // as menu-loader: a stat failure right after a read just means "no
  // baseline").
  let mtime: number | null = null;
  try {
    mtime = (await fs.stat(file)).mtimeMs;
  } catch {
    mtime = null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 'invalid', reason: `${file}: not valid JSON (${describeError(err)})` };
  }

  // Wrapper format has a `menu` key; an old bare MenuConfig (PR 3b) does
  // not (its top level is the menu itself). `appearanceRaw === undefined`
  // → no override, keep the global appearance.
  const isWrapper =
    typeof parsed === 'object' && parsed !== null && 'menu' in (parsed as Record<string, unknown>);
  const menuRaw = isWrapper ? (parsed as Record<string, unknown>).menu : parsed;
  const appearanceRaw = isWrapper ? (parsed as Record<string, unknown>).appearance : undefined;

  const result = migrateAndValidateMenuConfig(menuRaw);
  if (!result.ok) return { status: 'invalid', reason: `${file}: ${result.reason}` };

  const appearance =
    appearanceRaw === undefined
      ? null
      : { ...DEFAULT_PIE_APPEARANCE, ...sanitizePieAppearancePatch(appearanceRaw) };

  return { status: 'loaded', config: result.config, appearance, mtime, path: file };
}

/** The global menu.json baseline, as the inputs the resolver needs. */
export type FallbackMenu = { config: MenuConfig; mtime: number | null; source: string | null };

/** The menu config the app should run with right now, plus where it came
 *  from. `profileId` is the active profile's id, or null when the fallback
 *  is active. `appearance` is the profile's bundled appearance, or null to
 *  keep the global one (no profile, or a profile without an appearance). */
export type ActiveMenuConfig = FallbackMenu & {
  profileId: string | null;
  appearance: PieAppearance | null;
};

/**
 * Decide the active menu config from a device's profile load result and
 * the global fallback — the pure core of main's resolution, split out so
 * the priority can be unit-tested without Electron. Only a `loaded`
 * profile wins; `absent`, `invalid`, and "no device" (`profileId` null /
 * `profile` null) all resolve to the fallback. The caller owns reading the
 * profile (and warning on `invalid`) and comparing `profileId` to decide
 * whether to push.
 */
export function resolveActiveConfig(
  profileId: string | null,
  profile: ProfileLoadResult | null,
  fallback: FallbackMenu,
): ActiveMenuConfig {
  if (profileId && profile && profile.status === 'loaded') {
    return {
      config: profile.config,
      mtime: profile.mtime,
      source: profile.path,
      profileId,
      appearance: profile.appearance,
    };
  }
  return { ...fallback, profileId: null, appearance: null };
}

/**
 * Build the active config for a plugin-provided menu (#76): the user's base
 * config (trigger / navigation / scale / everything) with the plugin's content
 * swapped in as `root`. Non-destructive by construction — it overlays only the
 * content and leaves the user's menu.json untouched. `source` is null, marking
 * it read-only (not backed by a writable file), so the editor can't save over
 * the user's config while a plugin menu is active. `appearance` stays null to
 * keep the user's global look.
 */
export function resolvePluginMenuConfig(
  root: MenuNode,
  fallback: FallbackMenu,
  id: string,
): ActiveMenuConfig {
  // `root` is aliased from the plugin's loaded manifest (not deep-copied).
  // Safe today: editor edits round-trip through IPC structured-clone and writes
  // are blocked while a plugin menu is active, and nothing in main mutates
  // menuConfig.root in place. Do not introduce in-place mutation of the active
  // root, or it would corrupt the loaded manifest.
  return {
    config: { ...fallback.config, root },
    mtime: null,
    source: null,
    profileId: id,
    appearance: null,
  };
}

/** A profile id filename: `<vid>-<pid>` in 4-digit lowercase hex. */
const PROFILE_ID_RE = /^[0-9a-f]{4}-[0-9a-f]{4}$/;

/** Whether `id` is a well-formed profile id (`046d-c62b`). Guards against
 *  stray files in the profiles dir and untrusted ids over IPC. */
export function isProfileId(id: string): boolean {
  return PROFILE_ID_RE.test(id);
}

/**
 * List the ids of existing profile files in `dir`, sorted. Ignores
 * anything that isn't a `<vid>-<pid>.json`. A missing dir (no profile
 * ever created) is simply an empty list.
 */
export async function listDeviceProfiles(dir: string = deviceProfilesDir()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter(isProfileId)
    .sort();
}

/** Validate the menu and build the profile-file body `{ menu, appearance }`
 *  (menu via serializeMenuConfig for the same key ordering as menu.json).
 *  Shared by the async + sync writers. */
function buildProfileWrapper(
  config: MenuConfig,
  appearance: PieAppearance,
): { ok: true; body: string; config: MenuConfig } | { ok: false; reason: string } {
  const validation = validateMenuConfig(config);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const wrapper = { menu: JSON.parse(serializeMenuConfig(validation.config)), appearance };
  return { ok: true, body: `${JSON.stringify(wrapper, null, 2)}\n`, config: validation.config };
}

/**
 * Write the profile for `id` (a "save current config as this device's
 * profile", or an appearance edit while the profile is active) as the
 * wrapper `{ menu, appearance }`. Validates the menu, then atomic temp-file
 * + rename, overwriting any existing file — no conflict check (this is a
 * deliberate overwrite, not the editor's background write-back).
 */
export async function writeDeviceProfile(
  id: string,
  config: MenuConfig,
  appearance: PieAppearance,
  dir: string = deviceProfilesDir(),
): Promise<MenuWriteResult> {
  const built = buildProfileWrapper(config, appearance);
  if (!built.ok) return { ok: false, reason: built.reason };

  const file = deviceProfilePath(id, dir);
  const tmp = path.join(dir, `.${id}.json.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, built.body, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // Temp file may not exist if writeFile itself failed — ignore.
    }
    return { ok: false, reason: describeError(err) };
  }

  try {
    return { ok: true, mtime: (await fs.stat(file)).mtimeMs, config: built.config };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/**
 * Synchronous best-effort profile write for the quit path (mirrors
 * saveAppSettingsSync): a debounced async appearance write pending at
 * quit-time wouldn't settle before the process exits. Atomic temp + rename.
 */
export function writeDeviceProfileSync(
  id: string,
  config: MenuConfig,
  appearance: PieAppearance,
  dir: string = deviceProfilesDir(),
): void {
  const built = buildProfileWrapper(config, appearance);
  if (!built.ok) return;
  const file = deviceProfilePath(id, dir);
  const tmp = path.join(dir, `.${id}.json.${process.pid}.${Date.now()}.sync.tmp`);
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(tmp, built.body, 'utf8');
    fsSync.renameSync(tmp, file);
  } catch {
    try {
      fsSync.unlinkSync(tmp);
    } catch {
      // temp file may not exist — ignore
    }
  }
}

/** Delete the profile file for `id`. A missing file is success (the end
 *  state — no profile — is already reached). */
export async function deleteDeviceProfile(
  id: string,
  dir: string = deviceProfilesDir(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await fs.unlink(deviceProfilePath(id, dir));
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
    return { ok: false, reason: describeError(err) };
  }
}
