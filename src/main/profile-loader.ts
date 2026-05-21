// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import { type MenuConfig } from '../shared/menu.js';

import { migrateAndValidateMenuConfig } from './menu-loader.js';

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
const CONFIG_SUBDIR = 'spaceux';

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

/** Directory holding the per-device profile files. Mirrors the menu
 *  loader's primary XDG location (XDG_CONFIG_HOME if set, else ~/.config). */
export function deviceProfilesDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, CONFIG_SUBDIR, PROFILES_SUBDIR);
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
