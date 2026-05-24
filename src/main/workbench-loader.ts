// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { isRenderableIcon } from '../core/icon.js';
import { describeError } from '../shared/errors.js';
import type { MenuWriteResult } from '../shared/ipc.js';
import { MENU_CONFIG_VERSION, type MenuConfig } from '../shared/menu.js';
import {
  isWorkbenchMenuId,
  makeWorkbenchMenuId,
  parseWorkbenchMenuId,
  type PluginCatalogGroup,
} from '../shared/plugin-types.js';

import { migrateAndValidateMenuConfig, spaceuxConfigDirs } from './menu-loader.js';
import { writeMenuConfig } from './menu-writer.js';
import type { ActiveMenuConfig } from './profile-loader.js';

/**
 * Curated per-workbench FreeCAD pies (#193).
 *
 * Each (plugin, workbench) the user curates gets its own config, stored at
 * `$XDG_CONFIG_HOME/spaceux/workbench-menus/<pluginId>__<workbenchKey>.json`
 * as a bare {@link MenuConfig} — the same on-disk shape as menu.json, NOT the
 * `{ menu, appearance }` wrapper that per-device profiles use. A curated pie
 * inherits the global appearance (nothing to bundle), and a bare file lets the
 * editor's existing write-back ({@link writeMenuConfig} via main's write
 * target) and seeding write it unchanged — the whole point of treating a
 * curated pie as just another *writable* active source (#193, "Option B").
 *
 * The active-source id is `wb:<pluginId>:<workbenchKey>`
 * ({@link makeWorkbenchMenuId}); unlike a read-only `plugin:<id>` it resolves
 * to this writable file. Files are keyed by the workbench's stable *key* (its
 * class name, e.g. `PartDesignWorkbench`), never the display name, so the live
 * active workbench can be mapped to a file at runtime (#193 PR3).
 *
 * Pure I/O + path logic so it stays unit-testable; main decides when a curated
 * pie is the active source.
 */

const WORKBENCH_MENUS_SUBDIR = 'workbench-menus';

/** A reverse-DNS-style plugin id. Deliberately excludes `_` so the `__`
 *  filename separator is unambiguous (the first `__` splits plugin id from the
 *  workbench key, which may itself contain underscores). */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
/** A FreeCAD workbench key — a Python class identifier. */
const WORKBENCH_KEY_RE = /^[A-Za-z0-9_]+$/;

/** Directory holding the curated workbench-menu files, under the menu loader's
 *  primary config dir (the first {@link spaceuxConfigDirs} entry). */
export function workbenchMenusDir(): string {
  return path.join(spaceuxConfigDirs()[0]!, WORKBENCH_MENUS_SUBDIR);
}

/** Filename (no dir) for a workbench id, or null if the id is malformed or its
 *  parts aren't filename-safe. Encoding: `<pluginId>__<workbenchKey>.json`. */
function fileNameFor(id: string): string | null {
  const parsed = parseWorkbenchMenuId(id);
  if (!parsed) return null;
  if (!PLUGIN_ID_RE.test(parsed.pluginId)) return null;
  if (!WORKBENCH_KEY_RE.test(parsed.workbenchKey)) return null;
  return `${parsed.pluginId}__${parsed.workbenchKey}.json`;
}

/** Absolute path of a curated workbench-menu file, or null if `id` is
 *  malformed (guards against stray IPC / untrusted ids). */
export function workbenchMenuPath(id: string, dir: string = workbenchMenusDir()): string | null {
  const name = fileNameFor(id);
  return name === null ? null : path.join(dir, name);
}

/** Recover the `wb:` id from a filename in the workbench-menus dir, or null if
 *  it isn't a well-formed `<pluginId>__<workbenchKey>.json`. The plugin id has
 *  no underscore (validated on write), so the first `__` is the separator. */
function idForFileName(file: string): string | null {
  if (!file.endsWith('.json')) return null;
  const base = file.slice(0, -'.json'.length);
  const sep = base.indexOf('__');
  if (sep <= 0) return null;
  const pluginId = base.slice(0, sep);
  const workbenchKey = base.slice(sep + 2);
  if (!PLUGIN_ID_RE.test(pluginId) || !WORKBENCH_KEY_RE.test(workbenchKey)) return null;
  return makeWorkbenchMenuId(pluginId, workbenchKey);
}

/**
 * Outcome of loading a curated workbench pie:
 *   - `loaded`  — file present, parsed, migrated + validated; use it.
 *   - `absent`  — no file yet (the workbench hasn't been curated); caller
 *                 seeds it or falls back to the dynamic pie.
 *   - `invalid` — present but unreadable/bad JSON/failed validation; caller
 *                 falls back and should log `reason`.
 */
export type WorkbenchMenuLoadResult =
  | { status: 'loaded'; config: MenuConfig; mtime: number | null; path: string }
  | { status: 'absent' }
  | { status: 'invalid'; reason: string };

/**
 * Load the curated pie for `id` from `dir`. A missing file is `absent` (the
 * expected case for an un-curated workbench) and distinct from `invalid` (a
 * present-but-broken file), so the caller stays quiet for the former and warns
 * for the latter. The file is a bare MenuConfig, routed through
 * {@link migrateAndValidateMenuConfig} for the same version/migration +
 * validation as menu.json.
 */
export async function loadWorkbenchMenu(
  id: string,
  dir: string = workbenchMenusDir(),
): Promise<WorkbenchMenuLoadResult> {
  const file = workbenchMenuPath(id, dir);
  if (file === null) return { status: 'invalid', reason: `malformed workbench id: ${id}` };

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent' };
    return { status: 'invalid', reason: `${file}: ${describeError(err)}` };
  }

  // Best-effort mtime for the editor's conflict baseline (a stat failure right
  // after a successful read just means "no baseline").
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

/**
 * List the ids of curated workbench pies in `dir`, sorted. Ignores anything
 * that isn't a well-formed `<pluginId>__<workbenchKey>.json`. A missing dir
 * (nothing curated yet) is simply an empty list.
 */
export async function listWorkbenchMenus(dir: string = workbenchMenusDir()): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .map(idForFileName)
    .filter((id): id is string => id !== null)
    .sort();
}

/**
 * Write the curated pie for `id` via the editor's conflict-aware writer
 * ({@link writeMenuConfig}): validate, mtime conflict-check against
 * `expectedMtime`, atomic temp + rename. This is the editor's background
 * write-back target while a `wb:` source is active (and the seed write for a
 * new workbench), so it needs the conflict guard — unlike profile saves, which
 * are deliberate overwrites.
 */
export async function writeWorkbenchMenu(
  id: string,
  config: MenuConfig,
  expectedMtime: number | null,
  dir: string = workbenchMenusDir(),
): Promise<MenuWriteResult> {
  const file = workbenchMenuPath(id, dir);
  if (file === null) return { ok: false, reason: `malformed workbench id: ${id}` };
  return writeMenuConfig(file, config, expectedMtime);
}

/** Delete the curated pie for `id`. A missing file is success (the end state —
 *  no curated pie — is already reached); a malformed id is a no-op success. */
export async function deleteWorkbenchMenu(
  id: string,
  dir: string = workbenchMenusDir(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const file = workbenchMenuPath(id, dir);
  if (file === null) return { ok: true };
  try {
    await fs.unlink(file);
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
    return { ok: false, reason: describeError(err) };
  }
}

/**
 * Resolve a curated workbench pie to the active config, or null when there's no
 * usable file (`absent` — not seeded yet — or `invalid`); the caller then drops
 * the override and re-resolves normally, exactly like a gone plugin menu.
 *
 * A loaded pie is a *writable* source: `source` is its file path (so main's
 * write target points at it — unlike a read-only `plugin:` menu whose source is
 * null), and `appearance` is null so the curated pie inherits the global look
 * (the file bundles none).
 */
export function resolveWorkbenchMenuConfig(
  id: string,
  load: WorkbenchMenuLoadResult,
): ActiveMenuConfig | null {
  if (load.status !== 'loaded') return null;
  return {
    config: load.config,
    mtime: load.mtime,
    source: load.path,
    profileId: id,
    appearance: null,
  };
}

/**
 * Build a seeded curated pie from a catalog group (#193): the user's `base`
 * config (trigger / navigation / scale kept for consistency) with one submenu
 * per toolbar, each holding that toolbar's commands as run-action leaves — so
 * the curated editing tree mirrors the dynamic pie's structure (subfolders per
 * toolbar) instead of one flat ring. The full workbench is seeded (no
 * truncation); the user edits down. The centre label is empty, matching the
 * dynamic pie. Icons are kept only when renderable (same filter as the
 * palette), and commands missing a name/label are dropped (a label-less,
 * icon-less leaf is unsavable); a toolbar left with no usable command is
 * omitted (an empty submenu is invalid). Validation happens on write.
 */
export function seedWorkbenchConfig(
  group: PluginCatalogGroup,
  base: MenuConfig,
  pluginId: string,
): MenuConfig {
  return {
    ...base,
    version: MENU_CONFIG_VERSION,
    root: {
      label: '',
      branches: group.toolbars
        // Skip an empty-named toolbar: the submenu label would be empty and
        // (with no icon) unsavable — symmetric with the command-label filter.
        .filter((tb) => tb.name.trim() !== '')
        .map((tb) => ({
          label: tb.name,
          branches: tb.commands
            .filter((c) => c.command && c.label)
            .map((c) => ({
              label: c.label,
              ...(c.icon && isRenderableIcon(c.icon) ? { icon: c.icon } : {}),
              action: { id: `${pluginId}/run`, config: { command: c.command } },
            })),
        }))
        .filter((tb) => tb.branches.length > 0),
    },
  };
}

export { isWorkbenchMenuId, makeWorkbenchMenuId, parseWorkbenchMenuId };
