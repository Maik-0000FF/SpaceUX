// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import { isSafePluginId, type PluginManifest } from '../shared/plugin-types.js';

import { pluginInstallDir, readPluginManifest, userExtensionsRoot } from './plugin-loader.js';

/**
 * Plugin installation: copy a downloaded plugin *folder* into the managed
 * user-writable extensions tree (`<userExtensionsRoot>/<kind>/<id>/`), and
 * remove it again. Users import rather than point the loader at arbitrary
 * paths, so the on-disk layout stays canonical and the loader only ever scans
 * trusted, host-owned directories.
 *
 * (Folder import only for now; archive/.zip import is a later addition.)
 */

export type ImportOutcome =
  | { ok: true; manifest: PluginManifest; dir: string }
  | { ok: false; reason: string };

/**
 * Import the plugin folder at `srcDir`: validate its manifest, then copy the
 * whole folder into the user-writable extensions tree under `<kind>/<id>/`.
 * Re-importing an id replaces the existing copy (an in-place update). Returns
 * the manifest and final directory on success, or a human-readable reason on
 * failure.
 */
export async function importPluginFromFolder(srcDir: string): Promise<ImportOutcome> {
  const resolvedSrc = path.resolve(srcDir);

  const read = await readPluginManifest(resolvedSrc);
  if (!read.ok) {
    return { ok: false, reason: `not a valid plugin folder: ${read.reason}` };
  }
  const { manifest } = read;

  const target = pluginInstallDir(manifest.kind, manifest.id);

  // Importing a folder already inside the managed tree (e.g. the user picked
  // an installed plugin) would copy a directory onto itself — refuse rather
  // than wipe it during the replace step below.
  if (resolvedSrc === target || resolvedSrc.startsWith(userExtensionsRoot() + path.sep)) {
    return { ok: false, reason: 'that folder is already managed by SpaceUX' };
  }

  // Copy to a sibling temp dir first, then swap it in with a single rename, so
  // a mid-copy failure can't leave the previous install half-overwritten:
  // either the whole new copy lands or the old one stays untouched.
  const tmp = `${target}.import-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.cp(resolvedSrc, tmp, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
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
