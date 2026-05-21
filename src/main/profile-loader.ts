// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { MenuWriteResult } from '../shared/ipc.js';
import { type MenuConfig } from '../shared/menu.js';

import { migrateAndValidateMenuConfig, spaceuxConfigDirs } from './menu-loader.js';
import { writeMenuConfig } from './menu-writer.js';

/**
 * Per-device config profiles (#113).
 *
 * Each connected SpaceMouse model can have its own menu config, stored
 * at `$XDG_CONFIG_HOME/spaceux/profiles/<vid>-<pid>.json` (a plain
 * MenuConfig, same on-disk format as the global menu.json). The id is
 * the USB VID:PID in lowercase hex — evdev exposes no serial, so a
 * profile is per *model*, not per physical unit.
 *
 * This module is pure I/O + path logic so it stays unit-testable. Main
 * decides *when* to switch profiles (on a daemon device-change event)
 * and falls back to the global menu.json whenever a device has no
 * profile, is unknown, or its profile file is unreadable.
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
  | { status: 'loaded'; config: MenuConfig; mtime: number | null; path: string }
  | { status: 'absent' }
  | { status: 'invalid'; reason: string };

/**
 * Load the profile for `id` from `dir`. A missing file is `absent`
 * (the expected case for a device the user hasn't customised) and is
 * distinct from `invalid` (a present-but-broken file) so the caller can
 * stay quiet for the former and warn for the latter.
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

  const result = migrateAndValidateMenuConfig(parsed);
  if (!result.ok) return { status: 'invalid', reason: `${file}: ${result.reason}` };

  return { status: 'loaded', config: result.config, mtime, path: file };
}

/** The global menu.json baseline, as the inputs the resolver needs. */
export type FallbackMenu = { config: MenuConfig; mtime: number | null; source: string | null };

/** The menu config the app should run with right now, plus where it came
 *  from. `profileId` is the active profile's id, or null when the fallback
 *  is active. */
export type ActiveMenuConfig = FallbackMenu & { profileId: string | null };

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
    return { config: profile.config, mtime: profile.mtime, source: profile.path, profileId };
  }
  return { ...fallback, profileId: null };
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

/**
 * Write `config` as the profile for `id` (an explicit user "save current
 * config as this device's profile"). Validates + atomic-writes via the
 * shared menu writer, overwriting any existing file for the device — no
 * conflict check (this is a deliberate overwrite, not the editor's
 * background write-back).
 */
export async function writeDeviceProfile(
  id: string,
  config: MenuConfig,
  dir: string = deviceProfilesDir(),
): Promise<MenuWriteResult> {
  const file = deviceProfilePath(id, dir);
  // Pass the current on-disk mtime so the writer's conflict check always
  // agrees (force overwrite); null when the file doesn't exist yet.
  let mtime: number | null = null;
  try {
    mtime = (await fs.stat(file)).mtimeMs;
  } catch {
    mtime = null;
  }
  return writeMenuConfig(file, config, mtime);
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
