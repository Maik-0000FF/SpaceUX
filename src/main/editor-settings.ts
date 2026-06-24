// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { ThemeChoice } from '../shared/ipc.js';
import { atomicWriteFile } from './atomic-write.js';

/**
 * Persisted editor preferences — window geometry and the chosen theme —
 * stored next to menu.json at $XDG_CONFIG_HOME/spaceux/editor-settings.json
 * (or ~/.config/spaceux/...). Separate from menu.json: this is editor UI
 * state, not pie-menu content, and must never affect the loaded menu.
 *
 * Everything here is best-effort: a missing or corrupt file yields empty
 * settings (sensible defaults apply), and a failed write is logged, not
 * thrown — losing a remembered window size must never break the editor.
 */

export type { ThemeChoice };
export type WindowBounds = { width: number; height: number; x?: number; y?: number };
export type EditorSettings = { window?: WindowBounds; theme?: ThemeChoice };

/** Whether a wire value is a usable window size (finite positive numbers).
 *  Boundary guard for SetEditorWindow: load-side tolerance lives in
 *  {@link loadEditorSettings}, but a write must never persist garbage. */
export function isWindowSize(value: unknown): value is { width: number; height: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.width === 'number' &&
    Number.isFinite(v.width) &&
    v.width > 0 &&
    typeof v.height === 'number' &&
    Number.isFinite(v.height) &&
    v.height > 0
  );
}

const FILENAME = 'editor-settings.json';
const SUBDIR = 'spaceux';
const THEMES: ReadonlySet<string> = new Set<ThemeChoice>(['system', 'light', 'dark', 'spaceux']);

function settingsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, SUBDIR, FILENAME);
}

/** Load editor settings, tolerating a missing or malformed file. */
export async function loadEditorSettings(): Promise<EditorSettings> {
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
  const out: EditorSettings = {};

  if (typeof obj.window === 'object' && obj.window !== null) {
    const w = obj.window as Record<string, unknown>;
    if (typeof w.width === 'number' && typeof w.height === 'number') {
      const bounds: WindowBounds = { width: w.width, height: w.height };
      if (typeof w.x === 'number') bounds.x = w.x;
      if (typeof w.y === 'number') bounds.y = w.y;
      out.window = bounds;
    }
  }
  if (typeof obj.theme === 'string' && THEMES.has(obj.theme)) {
    out.theme = obj.theme as ThemeChoice;
  }
  return out;
}

/**
 * Merge a partial update into the saved settings and write atomically
 * (temp file + rename). Best-effort: a failure is logged, not thrown.
 *
 * Note: the read-modify-write is not serialized — two saves firing close
 * together (e.g. a debounced geometry save and a setTheme) can interleave
 * so the later read misses the earlier write, dropping one field. This is
 * last-writer-wins, acceptable for UI prefs; the dropped field re-saves on
 * the next interaction. Add a queue if this ever needs to be lossless.
 */
export async function saveEditorSettings(patch: EditorSettings): Promise<void> {
  const merged: EditorSettings = { ...(await loadEditorSettings()), ...patch };
  try {
    await atomicWriteFile(settingsPath(), JSON.stringify(merged, null, 2) + '\n');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[editor-settings] save failed: ${describeError(err)}`);
  }
}
