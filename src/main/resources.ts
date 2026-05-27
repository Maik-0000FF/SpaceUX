// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packaging-aware base for bundled-but-external resources: the `assets/` dir
 * (tray + window icons) and the `extensions/` dir (built-in plugins) that live
 * next to the code rather than inside the JS bundle.
 *
 * Unpackaged (npm run dev / start): the repo root. This module compiles to
 * dist-electron/main, so `../..` reaches the checkout root where assets/ and
 * extensions/ sit.
 *
 * Packaged: process.resourcesPath. The packaging step (electron-builder, the
 * #69 follow-up) must copy assets/ and extensions/ there via `extraResources`
 * for this contract to hold — code inside the asar can't read sibling dirs
 * that were never extracted. Files bundled *into* the JS (preload.cjs,
 * index.html) still resolve via their own __dirname inside the asar and don't
 * go through this helper.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const resourceBase: string = app.isPackaged
  ? process.resourcesPath
  : path.resolve(moduleDir, '..', '..');

/** Join path segments onto the packaging-aware resource base. */
export function resourcePath(...segments: string[]): string {
  return path.join(resourceBase, ...segments);
}
