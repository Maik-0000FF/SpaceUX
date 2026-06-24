// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Base for bundled-but-external resources: the `assets/` dir (tray + window
 * icons) that lives next to the code rather than inside the JS bundle.
 *
 * The base is `SPACEUX_RESOURCE_ROOT` when set (the launcher / packaging step
 * points it at the install's resource dir), else the checkout root. This
 * module compiles to dist/main, so `../..` reaches the checkout root where
 * `assets/` sits when the core runs from a source install.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const resourceBase: string =
  process.env.SPACEUX_RESOURCE_ROOT ?? path.resolve(moduleDir, '..', '..');

/** Join path segments onto the resource base. */
export function resourcePath(...segments: string[]): string {
  return path.join(resourceBase, ...segments);
}
