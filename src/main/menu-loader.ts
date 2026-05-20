// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import { DEFAULT_MENU_CONFIG, validateMenuConfig, type MenuConfig } from '../shared/menu.js';
import { dedupPreserveOrder } from '../shared/util.js';

/**
 * Loader for the user's pie-menu config.
 *
 * Search order (first hit wins):
 *   1. $XDG_CONFIG_HOME/spaceux/menu.json
 *   2. ~/.config/spaceux/menu.json
 *
 * Anything missing or malformed falls back to DEFAULT_MENU_CONFIG so
 * a fresh install always has a working pie. The reason for the
 * fallback is logged so the user knows why their (broken) config did
 * not take effect.
 *
 * Hot-reload lives next door in menu-watcher.ts: it watches the
 * config directories and re-runs this loader on every edit, pushing
 * the result to the renderer over IPC.
 */

const MENU_CONFIG_FILENAME = 'menu.json';
const MENU_CONFIG_SUBDIR = 'spaceux';

export type MenuLoadResult = {
  /** The config the app should run with. Always populated — either
   *  the validated user config or the default. */
  config: MenuConfig;
  /** Absolute path the user config was loaded from, or null if the
   *  loader fell back. Useful for logs and future hot-reload. */
  source: string | null;
  /** Modification time (ms) of the file `source` points at, or null
   *  when no file was read. The editor snapshots this and sends it
   *  back on a write so main can reject a save that would clobber an
   *  edit made to the file behind the editor's back (conflict
   *  detection in menu-writer). */
  mtime: number | null;
  /** Human-readable reason for the fallback, or null on success. */
  fallbackReason: string | null;
};

/** Build the ordered list of paths the loader will probe. Exposed
 *  so tests can substitute fake locations. */
export function menuConfigSearchPaths(): string[] {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const home = os.homedir();
  return dedupPreserveOrder<string>([
    xdg ? path.join(xdg, MENU_CONFIG_SUBDIR, MENU_CONFIG_FILENAME) : null,
    path.join(home, '.config', MENU_CONFIG_SUBDIR, MENU_CONFIG_FILENAME),
  ]);
}

export async function loadMenuConfig(
  searchPaths: string[] = menuConfigSearchPaths(),
): Promise<MenuLoadResult> {
  for (const candidate of searchPaths) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, 'utf8');
    } catch {
      continue;
    }

    // Best-effort mtime for conflict detection. A stat failure right
    // after a successful read is unlikely (and racy either way), so a
    // null mtime there just means "no conflict baseline" — the writer
    // treats that conservatively.
    let mtime: number | null = null;
    try {
      mtime = (await fs.stat(candidate)).mtimeMs;
    } catch {
      mtime = null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        config: DEFAULT_MENU_CONFIG,
        source: candidate,
        mtime,
        fallbackReason: `${candidate}: not valid JSON (${describeError(err)})`,
      };
    }

    const result = validateMenuConfig(parsed);
    if (!result.ok) {
      return {
        config: DEFAULT_MENU_CONFIG,
        source: candidate,
        mtime,
        fallbackReason: `${candidate}: ${result.reason}`,
      };
    }

    return { config: result.config, source: candidate, mtime, fallbackReason: null };
  }

  return {
    config: DEFAULT_MENU_CONFIG,
    source: null,
    mtime: null,
    fallbackReason: 'no menu.json found in any XDG config path',
  };
}
