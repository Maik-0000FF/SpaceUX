// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { isRenderableIcon } from '../core/icon.js';
import { describeError } from '../shared/errors.js';
import type { MenuWriteResult } from '../shared/ipc.js';
import { MENU_CONFIG_VERSION, type MenuConfig, type MenuNode } from '../shared/menu.js';
import {
  isContextMenuId,
  makeContextMenuId,
  parseContextMenuId,
  type PluginCatalogCommand,
  type PluginCatalogGroup,
} from '../shared/plugin-types.js';

import { migrateAndValidateMenuConfig, spaceuxConfigDirs } from './menu-loader.js';
import { writeMenuConfig } from './menu-writer.js';
import type { ActiveMenuConfig } from './profile-loader.js';

/**
 * Curated per-context pies (#193).
 *
 * Each (plugin, context) the user curates gets its own config, stored at
 * `$XDG_CONFIG_HOME/spaceux/context-menus/<pluginId>__<contextKey>.json`
 * as a bare {@link MenuConfig} — the same on-disk shape as menu.json, NOT the
 * `{ menu, appearance }` wrapper that per-device profiles use. A curated pie
 * inherits the global appearance (nothing to bundle), and a bare file lets the
 * editor's existing write-back ({@link writeMenuConfig} via main's write
 * target) and seeding write it unchanged — the whole point of treating a
 * curated pie as just another *writable* active source (#193, "Option B").
 *
 * The active-source id is `ctx:<pluginId>:<contextKey>`
 * ({@link makeContextMenuId}); unlike a read-only `plugin:<id>` it resolves
 * to this writable file. Files are keyed by the plugin's stable context *key*
 * (for FreeCAD a workbench class name, e.g. `PartDesignWorkbench`), never the
 * display name, so the live active context can be mapped to a file at runtime
 * (#193 PR3).
 *
 * Pure I/O + path logic so it stays unit-testable; main decides when a curated
 * pie is the active source.
 */

const CONTEXT_MENUS_SUBDIR = 'context-menus';

/** The legacy subdir name (#288). Curated pies used to live under this name
 *  when the concept was FreeCAD-specific ("workbench"); {@link
 *  migrateContextMenusDir} renames it to {@link CONTEXT_MENUS_SUBDIR} once. */
const LEGACY_WORKBENCH_MENUS_SUBDIR = 'workbench-menus';

/** A reverse-DNS-style plugin id. Deliberately excludes `_` so the `__`
 *  filename separator is unambiguous (the first `__` splits plugin id from the
 *  context key, which may itself contain underscores). */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
/** A context key — for FreeCAD a Python class identifier (workbench class). */
const CONTEXT_KEY_RE = /^[A-Za-z0-9_]+$/;

/** Directory holding the curated context-menu files, under the menu loader's
 *  primary config dir (the first {@link spaceuxConfigDirs} entry). */
export function contextMenusDir(): string {
  return path.join(spaceuxConfigDirs()[0]!, CONTEXT_MENUS_SUBDIR);
}

/**
 * One-time on-disk rename of the legacy `workbench-menus/` dir to
 * `context-menus/` (#288). Renames ONLY when the legacy dir exists AND the new
 * one does not, so it never merges or clobbers: if both exist (e.g. an old and
 * a new build ran against the same config) it leaves both untouched and warns.
 * Old-absent / neither-exist are no-ops, so the call is idempotent across
 * launches. Never throws — a failed migration must not block startup. Filenames
 * inside the dir are unchanged (`<pluginId>__<contextKey>.json`).
 */
export async function migrateContextMenusDir(
  configDir: string = spaceuxConfigDirs()[0]!,
): Promise<void> {
  const legacy = path.join(configDir, LEGACY_WORKBENCH_MENUS_SUBDIR);
  const next = path.join(configDir, CONTEXT_MENUS_SUBDIR);
  try {
    // No legacy dir → nothing to migrate (the common case after the first run).
    try {
      await fs.access(legacy);
    } catch {
      return;
    }
    // New dir already present → don't merge/overwrite; keep both, warn once.
    try {
      await fs.access(next);
      // eslint-disable-next-line no-console
      console.warn(
        `[context] both ${LEGACY_WORKBENCH_MENUS_SUBDIR}/ and ${CONTEXT_MENUS_SUBDIR}/ exist in ` +
          `${configDir}; leaving the legacy dir in place (no automatic merge).`,
      );
      return;
    } catch {
      // New dir absent → safe to rename.
    }
    await fs.rename(legacy, next);
    // eslint-disable-next-line no-console
    console.log(
      `[context] migrated ${LEGACY_WORKBENCH_MENUS_SUBDIR}/ → ${CONTEXT_MENUS_SUBDIR}/ in ${configDir}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[context] dir migration skipped: ${describeError(err)}`);
  }
}

/** Filename (no dir) for a context id, or null if the id is malformed or its
 *  parts aren't filename-safe. Encoding: `<pluginId>__<contextKey>.json`. */
function fileNameFor(id: string): string | null {
  const parsed = parseContextMenuId(id);
  if (!parsed) return null;
  if (!PLUGIN_ID_RE.test(parsed.pluginId)) return null;
  if (!CONTEXT_KEY_RE.test(parsed.contextKey)) return null;
  return `${parsed.pluginId}__${parsed.contextKey}.json`;
}

/** Absolute path of a curated context-menu file, or null if `id` is
 *  malformed (guards against stray IPC / untrusted ids). */
export function contextMenuPath(id: string, dir: string = contextMenusDir()): string | null {
  const name = fileNameFor(id);
  return name === null ? null : path.join(dir, name);
}

/** Recover the `ctx:` id from a filename in the context-menus dir, or null if
 *  it isn't a well-formed `<pluginId>__<contextKey>.json`. The plugin id has
 *  no underscore (validated on write), so the first `__` is the separator. */
function idForFileName(file: string): string | null {
  if (!file.endsWith('.json')) return null;
  const base = file.slice(0, -'.json'.length);
  const sep = base.indexOf('__');
  if (sep <= 0) return null;
  const pluginId = base.slice(0, sep);
  const contextKey = base.slice(sep + 2);
  if (!PLUGIN_ID_RE.test(pluginId) || !CONTEXT_KEY_RE.test(contextKey)) return null;
  return makeContextMenuId(pluginId, contextKey);
}

/**
 * Outcome of loading a curated context pie:
 *   - `loaded`  — file present, parsed, migrated + validated; use it.
 *   - `absent`  — no file yet (the context hasn't been curated); caller
 *                 seeds it or falls back to the dynamic pie.
 *   - `invalid` — present but unreadable/bad JSON/failed validation; caller
 *                 falls back and should log `reason`.
 */
export type ContextMenuLoadResult =
  | { status: 'loaded'; config: MenuConfig; mtime: number | null; path: string }
  | { status: 'absent' }
  | { status: 'invalid'; reason: string };

/**
 * Load the curated pie for `id` from `dir`. A missing file is `absent` (the
 * expected case for an un-curated context) and distinct from `invalid` (a
 * present-but-broken file), so the caller stays quiet for the former and warns
 * for the latter. The file is a bare MenuConfig, routed through
 * {@link migrateAndValidateMenuConfig} for the same version/migration +
 * validation as menu.json.
 */
export async function loadContextMenu(
  id: string,
  dir: string = contextMenusDir(),
): Promise<ContextMenuLoadResult> {
  const file = contextMenuPath(id, dir);
  if (file === null) return { status: 'invalid', reason: `malformed context id: ${id}` };

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
    // stat failed; the null default above stands as "no baseline".
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
 * List the ids of curated context pies in `dir`, sorted. Ignores anything
 * that isn't a well-formed `<pluginId>__<contextKey>.json`. A missing dir
 * (nothing curated yet) is simply an empty list.
 */
export async function listContextMenus(dir: string = contextMenusDir()): Promise<string[]> {
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
 * write-back target while a `ctx:` source is active (and the seed write for a
 * new context), so it needs the conflict guard — unlike profile saves, which
 * are deliberate overwrites.
 */
export async function writeContextMenu(
  id: string,
  config: MenuConfig,
  expectedMtime: number | null,
  dir: string = contextMenusDir(),
): Promise<MenuWriteResult> {
  const file = contextMenuPath(id, dir);
  if (file === null) return { ok: false, reason: `malformed context id: ${id}` };
  return writeMenuConfig(file, config, expectedMtime);
}

/** Delete the curated pie for `id`. A missing file is success (the end state —
 *  no curated pie — is already reached); a malformed id is a no-op success. */
export async function deleteContextMenu(
  id: string,
  dir: string = contextMenusDir(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const file = contextMenuPath(id, dir);
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
 * Resolve a curated context pie to the active config, or null when there's no
 * usable file (`absent` — not seeded yet — or `invalid`); the caller then drops
 * the override and re-resolves normally, exactly like a gone plugin menu.
 *
 * A loaded pie is a *writable* source: `source` is its file path (so main's
 * write target points at it — unlike a read-only `plugin:` menu whose source is
 * null), and `appearance` is null so the curated pie inherits the global look
 * (the file bundles none).
 */
export function resolveContextMenuConfig(
  id: string,
  load: ContextMenuLoadResult,
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
 * toolbar) instead of one flat ring. The full group is seeded (no truncation);
 * the user edits down. The centre label is empty, matching the dynamic pie.
 * Icons are kept only when renderable (same filter as the palette), and commands
 * missing a name/label are dropped (a label-less, icon-less leaf is unsavable);
 * a toolbar left with no usable command is omitted (an empty submenu is
 * invalid). Validation happens on write.
 */
export function seedContextConfig(
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
            .map((c) => seedCommandNode(c, pluginId))
            .filter((n): n is MenuNode => n !== null),
        }))
        .filter((tb) => tb.branches.length > 0),
    },
  };
}

/** One catalog command → a seeded MenuNode, or null when unusable. A command
 *  group (#208, `members`) becomes a submenu (third level) over its member
 *  leaves — dropped if it has no usable members or no label; a plain command
 *  becomes a run leaf — dropped if it lacks a command or label (a label-less,
 *  icon-less node is unsavable). Icons kept only when renderable. */
function seedCommandNode(c: PluginCatalogCommand, pluginId: string): MenuNode | null {
  const icon = c.icon && isRenderableIcon(c.icon) ? { icon: c.icon } : {};
  if (c.members && c.members.length > 0) {
    const branches = c.members
      .map((m) => seedCommandNode(m, pluginId))
      .filter((n): n is MenuNode => n !== null);
    if (!c.label || branches.length === 0) return null;
    return { label: c.label, ...icon, branches };
  }
  if (!c.command || !c.label) return null;
  return {
    label: c.label,
    ...icon,
    action: { id: `${pluginId}/run`, config: { command: c.command } },
  };
}

export { isContextMenuId, makeContextMenuId, parseContextMenuId };
