// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { PluginManifest } from '../shared/plugin-types.js';

import { pluginInstallDir, readPluginManifest, userExtensionsRoot } from './plugin-loader.js';

/**
 * Plugin installation: copy a downloaded plugin *folder* into the managed
 * `extensions/<kind>/<id>/` tree, and remove it again. Users import rather
 * than point the loader at arbitrary paths, so the on-disk layout stays
 * canonical and the loader only ever scans trusted, host-owned directories.
 *
 * (Folder import only for now; archive/.zip import is a later addition.)
 */

export type ImportOutcome =
  | { ok: true; manifest: PluginManifest; dir: string }
  | { ok: false; reason: string };

/**
 * A plugin id is used verbatim as a single path segment (the install dir) and
 * as the prefix of every action key, so it must be one safe segment — no
 * separators, no `..` traversal. validateManifest only checks it's non-empty;
 * this is the boundary where it becomes a filesystem path, so the stricter
 * rule lives here. Reverse-DNS dots/dashes/underscores are allowed.
 */
function isSafePluginId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..');
}

/**
 * Import the plugin folder at `srcDir`: validate its manifest, then copy the
 * whole folder into the user-writable `extensions/<kind>/<id>/`. Re-importing
 * an id replaces the existing copy (an in-place update). Returns the manifest
 * and final directory on success, or a human-readable reason on failure.
 */
export async function importPluginFromFolder(srcDir: string): Promise<ImportOutcome> {
  const resolvedSrc = path.resolve(srcDir);

  const manifest = await readPluginManifest(resolvedSrc);
  if ('reason' in manifest) {
    return { ok: false, reason: `not a valid plugin folder: ${manifest.reason}` };
  }
  if (!isSafePluginId(manifest.id)) {
    return { ok: false, reason: `manifest id "${manifest.id}" is not a valid plugin identifier` };
  }

  const target = pluginInstallDir(manifest.kind, manifest.id);

  // Importing a folder already inside the managed tree (e.g. the user picked
  // an installed plugin) would copy a directory onto itself — refuse rather
  // than wipe it during the replace step below.
  if (resolvedSrc === target || resolvedSrc.startsWith(userExtensionsRoot() + path.sep)) {
    return { ok: false, reason: 'that folder is already managed by SpaceUX' };
  }

  try {
    // Replace any existing copy so re-import is a clean update, not a merge
    // that could leave orphaned files from a previous version.
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(resolvedSrc, target, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `copy failed: ${describeError(err)}` };
  }

  return { ok: true, manifest, dir: target };
}

/**
 * Remove an installed plugin by kind + id (delete its managed folder). A
 * missing folder is treated as success — the end state is the same. Returns a
 * reason only on an actual filesystem error.
 */
export async function uninstallPlugin(
  kind: PluginManifest['kind'],
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isSafePluginId(id)) {
    return { ok: false, reason: `"${id}" is not a valid plugin identifier` };
  }
  try {
    await fs.rm(pluginInstallDir(kind, id), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}
