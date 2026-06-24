// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';

import { loadPluginManifests, type InstalledPlugin } from './plugin-loader.js';

/**
 * The shape-plugin source cache (#107 PR2). The renderer resolves a shape
 * entry's source by id on demand; caching the manifests by id lets that lookup
 * be O(1) instead of re-walking the extensions tree on every pull. Mirrors
 * `loadedPlugins` for the function kind.
 */
let loadedShapeManifests: Map<string, InstalledPlugin> = new Map();
let shapeLoadErrors: { dir: string; reason: string }[] = [];

/** Re-scan the installed `shape` plugins into the lookup cache. */
export async function refreshShapeManifestCache(): Promise<void> {
  const { plugins, errors } = await loadPluginManifests('shape');
  loadedShapeManifests = new Map(plugins.map((p) => [p.manifest.id, p]));
  shapeLoadErrors = errors;
}

/** The cached shape manifests, for the plugin-manager listing. */
export function shapeManifests(): Map<string, InstalledPlugin> {
  return loadedShapeManifests;
}

/** The errors from the last shape scan, for the plugin-manager listing. */
export function shapeManifestErrors(): { dir: string; reason: string }[] {
  return shapeLoadErrors;
}

/**
 * Read the JS source of a shape plugin's `shape.entry` file (#107 PR2) for the
 * renderer's Blob-URL dynamic import. Returns null when the plugin isn't found /
 * wrong kind / source can't be read; logs the precise reason.
 */
export async function readShapeSourceById(pluginId: string): Promise<string | null> {
  try {
    const found = loadedShapeManifests.get(pluginId);
    if (!found || !found.manifest.shape) {
      // eslint-disable-next-line no-console
      console.warn(`[shape] getShapeSource: plugin "${pluginId}" not found / not a shape`);
      return null;
    }
    const entryPath = path.join(found.dir, found.manifest.shape.entry);
    // Stat first so we can reject non-regular files (a symlink resolving to a
    // character / block device, a pipe, a socket) before reading: fs.stat
    // reports `size: 0` for /dev/zero, so the size cap below alone wouldn't
    // catch that case. A legitimate plugin entry is always a regular `.js` file.
    const stat = await fs.stat(entryPath);
    if (!stat.isFile()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[shape] getShapeSource: plugin "${pluginId}" entry is not a regular file; rejecting`,
      );
      return null;
    }
    // Size cap: a shape plugin is pure compute; anything larger than 1 MiB is
    // almost certainly a packaged bundle the manifest's entry shouldn't point
    // at directly. Soft guard, applied to the stat'd size so we never pull an
    // oversized file into memory.
    const MAX_SOURCE_BYTES = 1 << 20;
    if (stat.size > MAX_SOURCE_BYTES) {
      // eslint-disable-next-line no-console
      console.warn(
        `[shape] getShapeSource: plugin "${pluginId}" entry exceeds ${MAX_SOURCE_BYTES} bytes; rejecting`,
      );
      return null;
    }
    return await fs.readFile(entryPath, 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[shape] getShapeSource("${pluginId}"): ${describeError(err)}`);
    return null;
  }
}
