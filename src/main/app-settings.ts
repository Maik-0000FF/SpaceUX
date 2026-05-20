// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { PieAppearance, PieThemeChoice } from '../shared/ipc.js';

/**
 * App-wide preferences stored at $XDG_CONFIG_HOME/spaceux/app-settings.json
 * (or ~/.config/spaceux/...). Distinct from editor-settings.json (editor UI
 * state) and menu.json (menu content): this holds settings that affect the
 * live pie itself — currently its appearance (theme + opacity), with blur to
 * follow. Same best-effort contract as editor-settings: a missing or corrupt
 * file yields defaults, and a failed write is logged, not thrown.
 */

export type AppSettings = { pieTheme?: PieThemeChoice; pieOpacity?: number };

const FILENAME = 'app-settings.json';
const SUBDIR = 'spaceux';

export const PIE_THEMES: ReadonlySet<string> = new Set<PieThemeChoice>([
  'dark',
  'light',
  'spaceux',
]);
/** Opacity is clamped to a usable band so the pie can't be made invisible. */
export const PIE_OPACITY_MIN = 0.2;
export const PIE_OPACITY_MAX = 1;
/** Defaults preserve the original look: dark palette, full opacity. */
export const DEFAULT_PIE_APPEARANCE: PieAppearance = { theme: 'dark', opacity: 1 };

export function clampPieOpacity(n: number): number {
  return Math.min(PIE_OPACITY_MAX, Math.max(PIE_OPACITY_MIN, n));
}

function settingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, SUBDIR, FILENAME);
}

/** Load app settings, tolerating a missing or malformed file. */
export async function loadAppSettings(): Promise<AppSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath(), 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const obj = parsed as Record<string, unknown>;
  const out: AppSettings = {};

  if (typeof obj.pieTheme === 'string' && PIE_THEMES.has(obj.pieTheme)) {
    out.pieTheme = obj.pieTheme as PieThemeChoice;
  }
  if (typeof obj.pieOpacity === 'number' && Number.isFinite(obj.pieOpacity)) {
    out.pieOpacity = clampPieOpacity(obj.pieOpacity);
  }
  return out;
}

/** Resolve persisted settings into a complete appearance, applying defaults. */
export async function loadPieAppearance(): Promise<PieAppearance> {
  const s = await loadAppSettings();
  return {
    theme: s.pieTheme ?? DEFAULT_PIE_APPEARANCE.theme,
    opacity: s.pieOpacity ?? DEFAULT_PIE_APPEARANCE.opacity,
  };
}

/**
 * Merge a partial update into the saved settings and write atomically
 * (temp file + rename). Best-effort: a failure is logged, not thrown. The
 * read-modify-write is last-writer-wins (see editor-settings for the same
 * note) — acceptable for UI prefs.
 */
export async function saveAppSettings(patch: AppSettings): Promise<void> {
  const merged: AppSettings = { ...(await loadAppSettings()), ...patch };
  const target = settingsPath();
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${FILENAME}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // temp file may not exist — ignore
    }
    // eslint-disable-next-line no-console
    console.warn(`[app-settings] save failed: ${describeError(err)}`);
  }
}
