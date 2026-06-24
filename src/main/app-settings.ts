// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_DESKTOP_SETTINGS, sanitizeDesktopSettings } from '../shared/desktop-settings.js';
import { describeError } from '../shared/errors.js';
import { atomicWriteFile, atomicWriteFileSync } from './atomic-write.js';
import { DEFAULT_INPUT_SETTINGS } from '../shared/input-settings.js';
import type {
  DesktopSettings,
  InputSettings,
  PieAppearance,
  PieThemeChoice,
  PieWedgeGapStyle,
  PieWedgeStyle,
} from '../shared/ipc.js';
import {
  clampFontFamily,
  clampPieIconScale,
  clampPieLabelScale,
  clampPieOpacity,
  clampPieBalance,
  clampPieScale,
  clampPieWedgeGap,
  clampPieWedgeHover,
  clampShapeModel,
  DEFAULT_PIE_APPEARANCE,
  PIE_THEMES,
  PIE_WEDGE_GAP_STYLES,
  PIE_WEDGE_STYLES,
} from '../shared/pie-appearance.js';

/**
 * App-wide preferences stored at $XDG_CONFIG_HOME/spaceux/app-settings.json
 * (or ~/.config/spaceux/...). Distinct from editor-settings.json (editor UI
 * state) and menu.json (menu content): this holds settings that affect the
 * live pie itself — its appearance (theme, opacity, frosted-background blur,
 * sizing, fonts, shape model). Same best-effort contract as editor-settings: a
 * missing or corrupt file yields defaults, and a failed write is logged, not
 * thrown.
 *
 * The pure validation (theme whitelist, opacity clamp, defaults) lives in
 * shared/pie-appearance so the editor renderer shares it; this module only
 * adds the file IO.
 */

export type AppSettings = {
  pieTheme?: PieThemeChoice;
  pieOpacity?: number;
  pieBlur?: boolean;
  pieLabelScale?: number;
  pieIconScale?: number;
  pieScale?: number;
  pieRingBalance?: number;
  pieCenterBalance?: number;
  pieFontUi?: string;
  pieFontMono?: string;
  pieShapeModel?: string | null;
  pieWedgeStyle?: PieWedgeStyle;
  pieWedgeGapStyle?: PieWedgeGapStyle;
  pieWedgeGap?: number;
  pieWedgeHoverOffset?: number;
  pieShowSubmenuMarkers?: boolean;
  pieShowDepthDots?: boolean;
  /** Grab the SpaceMouse while the pie is open (#327). Global input
   *  behaviour, not appearance, kept in the same file because they share
   *  app-settings.json, but resolved separately via loadInputSettings. */
  grabWhilePieOpen?: boolean;
  /** Desktop-mode config (#199). A nested object (per-action bindings) rather
   *  than flat fields; global input behaviour like grabWhilePieOpen, resolved
   *  separately via loadDesktopSettings. */
  desktop?: DesktopSettings;
  /** One-shot marker that launch-on-login has been seeded. Autostart
   *  defaults to ON, but the XDG autostart entry's presence is the source of
   *  truth — so we can't tell "fresh install" from "user turned it off"
   *  without this flag. Set true the first time the app seeds the entry;
   *  afterwards the file alone decides, so a later turn-off sticks. */
  autostartSeeded?: boolean;
};

const FILENAME = 'app-settings.json';
const SUBDIR = 'spaceux';

function settingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, SUBDIR, FILENAME);
}

/** Validate + whitelist a parsed JSON blob into AppSettings. Shared by the
 *  async and sync loaders so both apply the identical per-field rules. */
function sanitizeAppSettings(parsed: unknown): AppSettings {
  if (typeof parsed !== 'object' || parsed === null) return {};
  const obj = parsed as Record<string, unknown>;
  const out: AppSettings = {};

  if (typeof obj.pieTheme === 'string' && PIE_THEMES.has(obj.pieTheme)) {
    out.pieTheme = obj.pieTheme as PieThemeChoice;
  }
  if (typeof obj.pieOpacity === 'number' && Number.isFinite(obj.pieOpacity)) {
    out.pieOpacity = clampPieOpacity(obj.pieOpacity);
  }
  if (typeof obj.pieBlur === 'boolean') {
    out.pieBlur = obj.pieBlur;
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
  if (typeof obj.pieWedgeStyle === 'string' && PIE_WEDGE_STYLES.has(obj.pieWedgeStyle)) {
    out.pieWedgeStyle = obj.pieWedgeStyle as PieWedgeStyle;
  }
  if (typeof obj.pieWedgeGapStyle === 'string' && PIE_WEDGE_GAP_STYLES.has(obj.pieWedgeGapStyle)) {
    out.pieWedgeGapStyle = obj.pieWedgeGapStyle as PieWedgeGapStyle;
  }
  if (typeof obj.pieWedgeGap === 'number' && Number.isFinite(obj.pieWedgeGap)) {
    out.pieWedgeGap = clampPieWedgeGap(obj.pieWedgeGap);
  }
  if (typeof obj.pieWedgeHoverOffset === 'number' && Number.isFinite(obj.pieWedgeHoverOffset)) {
    out.pieWedgeHoverOffset = clampPieWedgeHover(obj.pieWedgeHoverOffset);
  }
  if (typeof obj.pieShowSubmenuMarkers === 'boolean') {
    out.pieShowSubmenuMarkers = obj.pieShowSubmenuMarkers;
  }
  if (typeof obj.pieShowDepthDots === 'boolean') {
    out.pieShowDepthDots = obj.pieShowDepthDots;
  }
  if (typeof obj.grabWhilePieOpen === 'boolean') {
    out.grabWhilePieOpen = obj.grabWhilePieOpen;
  }
  if (obj.desktop !== undefined) {
    // The nested blob carries its own per-field validation; a malformed value
    // resolves to a complete defaults-filled config rather than being dropped.
    out.desktop = sanitizeDesktopSettings(obj.desktop);
  }
  if (typeof obj.autostartSeeded === 'boolean') {
    out.autostartSeeded = obj.autostartSeeded;
  }
  return out;
}

/** Load app settings, tolerating a missing or malformed file. */
export async function loadAppSettings(): Promise<AppSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath(), 'utf8');
  } catch {
    return {};
  }
  try {
    return sanitizeAppSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Synchronous counterpart of loadAppSettings, so the quit-path sync save can
 *  read-merge against the current file instead of overwriting it. Same
 *  tolerate-missing/corrupt contract. */
function loadAppSettingsSync(): AppSettings {
  let raw: string;
  try {
    raw = fsSync.readFileSync(settingsPath(), 'utf8');
  } catch {
    return {};
  }
  try {
    return sanitizeAppSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Resolve persisted settings into complete input settings, applying defaults.
 *  Separate from the appearance resolver: input behaviour is global, not part
 *  of the per-device-profile appearance. */
export async function loadInputSettings(): Promise<InputSettings> {
  const s = await loadAppSettings();
  return {
    grabWhilePieOpen: s.grabWhilePieOpen ?? DEFAULT_INPUT_SETTINGS.grabWhilePieOpen,
  };
}

/** Resolve persisted settings into complete desktop-mode settings, applying
 *  defaults. Separate from the appearance/input resolvers: desktop control is
 *  global behaviour, not per-device-profile appearance. The stored value is
 *  already sanitised on load (see sanitizeAppSettings), so this only fills the
 *  whole-object default when the section is absent. */
export async function loadDesktopSettings(): Promise<DesktopSettings> {
  const s = await loadAppSettings();
  return s.desktop ?? DEFAULT_DESKTOP_SETTINGS;
}

/** Resolve persisted settings into a complete appearance, applying defaults. */
export async function loadPieAppearance(): Promise<PieAppearance> {
  const s = await loadAppSettings();
  return {
    theme: s.pieTheme ?? DEFAULT_PIE_APPEARANCE.theme,
    opacity: s.pieOpacity ?? DEFAULT_PIE_APPEARANCE.opacity,
    blur: s.pieBlur ?? DEFAULT_PIE_APPEARANCE.blur,
    labelScale: s.pieLabelScale ?? DEFAULT_PIE_APPEARANCE.labelScale,
    iconScale: s.pieIconScale ?? DEFAULT_PIE_APPEARANCE.iconScale,
    scale: s.pieScale ?? DEFAULT_PIE_APPEARANCE.scale,
    ringBalance: s.pieRingBalance ?? DEFAULT_PIE_APPEARANCE.ringBalance,
    centerBalance: s.pieCenterBalance ?? DEFAULT_PIE_APPEARANCE.centerBalance,
    fontUi: s.pieFontUi ?? DEFAULT_PIE_APPEARANCE.fontUi,
    fontMono: s.pieFontMono ?? DEFAULT_PIE_APPEARANCE.fontMono,
    shapeModel: s.pieShapeModel ?? DEFAULT_PIE_APPEARANCE.shapeModel,
    wedgeStyle: s.pieWedgeStyle ?? DEFAULT_PIE_APPEARANCE.wedgeStyle,
    wedgeGapStyle: s.pieWedgeGapStyle ?? DEFAULT_PIE_APPEARANCE.wedgeGapStyle,
    wedgeGap: s.pieWedgeGap ?? DEFAULT_PIE_APPEARANCE.wedgeGap,
    wedgeHoverOffset: s.pieWedgeHoverOffset ?? DEFAULT_PIE_APPEARANCE.wedgeHoverOffset,
    showSubmenuMarkers: s.pieShowSubmenuMarkers ?? DEFAULT_PIE_APPEARANCE.showSubmenuMarkers,
    showDepthDots: s.pieShowDepthDots ?? DEFAULT_PIE_APPEARANCE.showDepthDots,
  };
}

/** The inverse of {@link loadPieAppearance}: map a PieAppearance back onto its
 *  AppSettings fields for persistence (a global appearance save). */
export function appearanceToAppSettings(a: PieAppearance): AppSettings {
  return {
    pieTheme: a.theme,
    pieOpacity: a.opacity,
    pieBlur: a.blur,
    pieLabelScale: a.labelScale,
    pieIconScale: a.iconScale,
    pieScale: a.scale,
    pieRingBalance: a.ringBalance,
    pieCenterBalance: a.centerBalance,
    pieFontUi: a.fontUi,
    pieFontMono: a.fontMono,
    pieShapeModel: a.shapeModel,
    pieWedgeStyle: a.wedgeStyle,
    pieWedgeGapStyle: a.wedgeGapStyle,
    pieWedgeGap: a.wedgeGap,
    pieWedgeHoverOffset: a.wedgeHoverOffset,
    pieShowSubmenuMarkers: a.showSubmenuMarkers,
    pieShowDepthDots: a.showDepthDots,
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
  try {
    await atomicWriteFile(settingsPath(), JSON.stringify(merged, null, 2) + '\n');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[app-settings] save failed: ${describeError(err)}`);
  }
}

/**
 * Synchronous best-effort write for the quit path: a debounced async save
 * pending at quit-time wouldn't settle before the process exits, so the flush
 * in `before-quit` writes synchronously instead. Read-merges with the current
 * file (like the async saveAppSettings) so a field the caller doesn't pass —
 * e.g. the one-shot autostartSeeded flag — survives the write instead of being
 * clobbered. Atomic temp + rename.
 */
export function saveAppSettingsSync(patch: AppSettings): void {
  const settings: AppSettings = { ...loadAppSettingsSync(), ...patch };
  try {
    atomicWriteFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[app-settings] sync save failed: ${describeError(err)}`);
  }
}
