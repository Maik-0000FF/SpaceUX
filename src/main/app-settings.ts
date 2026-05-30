// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { PieAppearance, PieThemeChoice } from '../shared/ipc.js';
import {
  clampFontFamily,
  clampPieIconScale,
  clampPieLabelScale,
  clampPieOpacity,
  clampPieBalance,
  clampPieScale,
  clampShapeModel,
  DEFAULT_PIE_APPEARANCE,
  PIE_THEMES,
} from '../shared/pie-appearance.js';

/**
 * App-wide preferences stored at $XDG_CONFIG_HOME/spaceux/app-settings.json
 * (or ~/.config/spaceux/...). Distinct from editor-settings.json (editor UI
 * state) and menu.json (menu content): this holds settings that affect the
 * live pie itself — currently its appearance (theme + opacity), with blur to
 * follow. Same best-effort contract as editor-settings: a missing or corrupt
 * file yields defaults, and a failed write is logged, not thrown.
 *
 * The pure validation (theme whitelist, opacity clamp, defaults) lives in
 * shared/pie-appearance so the editor renderer shares it; this module only
 * adds the file IO.
 */

export type AppSettings = {
  pieTheme?: PieThemeChoice;
  pieOpacity?: number;
  pieLabelScale?: number;
  pieIconScale?: number;
  pieScale?: number;
  pieRingBalance?: number;
  pieCenterBalance?: number;
  pieFontUi?: string;
  pieFontMono?: string;
  pieShapeModel?: string | null;
  pieShowSubmenuMarkers?: boolean;
  pieShowDepthDots?: boolean;
};

const FILENAME = 'app-settings.json';
const SUBDIR = 'spaceux';

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
  if (typeof obj.pieLabelScale === 'number' && Number.isFinite(obj.pieLabelScale)) {
    out.pieLabelScale = clampPieLabelScale(obj.pieLabelScale);
  }
  if (typeof obj.pieIconScale === 'number' && Number.isFinite(obj.pieIconScale)) {
    out.pieIconScale = clampPieIconScale(obj.pieIconScale);
  }
  if (typeof obj.pieScale === 'number' && Number.isFinite(obj.pieScale)) {
    out.pieScale = clampPieScale(obj.pieScale);
  }
  if (typeof obj.pieRingBalance === 'number' && Number.isFinite(obj.pieRingBalance)) {
    out.pieRingBalance = clampPieBalance(obj.pieRingBalance);
  }
  if (typeof obj.pieCenterBalance === 'number' && Number.isFinite(obj.pieCenterBalance)) {
    out.pieCenterBalance = clampPieBalance(obj.pieCenterBalance);
  }
  if (typeof obj.pieFontUi === 'string') {
    out.pieFontUi = clampFontFamily(obj.pieFontUi);
  }
  if (typeof obj.pieFontMono === 'string') {
    out.pieFontMono = clampFontFamily(obj.pieFontMono);
  }
  if (obj.pieShapeModel === null || typeof obj.pieShapeModel === 'string') {
    out.pieShapeModel = clampShapeModel(obj.pieShapeModel);
  }
  if (typeof obj.pieShowSubmenuMarkers === 'boolean') {
    out.pieShowSubmenuMarkers = obj.pieShowSubmenuMarkers;
  }
  if (typeof obj.pieShowDepthDots === 'boolean') {
    out.pieShowDepthDots = obj.pieShowDepthDots;
  }
  return out;
}

/** Resolve persisted settings into a complete appearance, applying defaults. */
export async function loadPieAppearance(): Promise<PieAppearance> {
  const s = await loadAppSettings();
  return {
    theme: s.pieTheme ?? DEFAULT_PIE_APPEARANCE.theme,
    opacity: s.pieOpacity ?? DEFAULT_PIE_APPEARANCE.opacity,
    labelScale: s.pieLabelScale ?? DEFAULT_PIE_APPEARANCE.labelScale,
    iconScale: s.pieIconScale ?? DEFAULT_PIE_APPEARANCE.iconScale,
    scale: s.pieScale ?? DEFAULT_PIE_APPEARANCE.scale,
    ringBalance: s.pieRingBalance ?? DEFAULT_PIE_APPEARANCE.ringBalance,
    centerBalance: s.pieCenterBalance ?? DEFAULT_PIE_APPEARANCE.centerBalance,
    fontUi: s.pieFontUi ?? DEFAULT_PIE_APPEARANCE.fontUi,
    fontMono: s.pieFontMono ?? DEFAULT_PIE_APPEARANCE.fontMono,
    shapeModel: s.pieShapeModel ?? DEFAULT_PIE_APPEARANCE.shapeModel,
    showSubmenuMarkers: s.pieShowSubmenuMarkers ?? DEFAULT_PIE_APPEARANCE.showSubmenuMarkers,
    showDepthDots: s.pieShowDepthDots ?? DEFAULT_PIE_APPEARANCE.showDepthDots,
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

/**
 * Synchronous best-effort write for the quit path: a debounced async save
 * pending at quit-time wouldn't settle before the process exits, so the flush
 * in `before-quit` writes synchronously instead. Writes the given full
 * settings (no merge — the caller passes the complete in-memory state, which
 * is authoritative for the only fields stored today). Atomic temp + rename.
 */
export function saveAppSettingsSync(settings: AppSettings): void {
  const target = settingsPath();
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${FILENAME}.${process.pid}.${Date.now()}.sync.tmp`);
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    fsSync.renameSync(tmp, target);
  } catch (err) {
    try {
      fsSync.unlinkSync(tmp);
    } catch {
      // temp file may not exist — ignore
    }
    // eslint-disable-next-line no-console
    console.warn(`[app-settings] sync save failed: ${describeError(err)}`);
  }
}
