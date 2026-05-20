// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { describeError } from '../shared/errors.js';
import type { MenuWriteResult } from '../shared/ipc.js';
import { serializeMenuConfig, validateMenuConfig, type MenuConfig } from '../shared/menu.js';

/**
 * Atomic, conflict-aware writer for the user's menu.json — the disk
 * half of the editor's write-back loop. Returns a {@link MenuWriteResult}:
 *   - `{ ok: true, mtime }`       — written; `mtime` is the new on-disk
 *                                   mtime the editor adopts as its next
 *                                   baseline.
 *   - `{ ok: false, reason }`     — config failed validation, or the
 *                                   write errored. Nothing on disk
 *                                   changed (validation runs first; the
 *                                   write is temp-file + rename).
 *   - `{ ok: 'conflict', mtime }` — the file changed behind the editor's
 *                                   back since it loaded. Nothing is
 *                                   written; the editor surfaces a banner
 *                                   and can re-send with this `mtime` to
 *                                   force an overwrite.
 */

/**
 * Whether the on-disk state still matches what the editor loaded.
 *
 * `expected === null` means "no file existed when I loaded": a file
 * existing now is someone else's creation (conflict). `actual === null`
 * with a non-null expected means the file was deleted under us
 * (conflict). Otherwise the mtimes must be identical.
 */
function mtimesAgree(expected: number | null, actual: number | null): boolean {
  if (expected === null) return actual === null;
  if (actual === null) return false;
  return expected === actual;
}

export async function writeMenuConfig(
  targetPath: string,
  config: MenuConfig,
  expectedMtime: number | null,
): Promise<MenuWriteResult> {
  // 1. Validate before touching disk. The editor builds configs from a
  //    valid base, but the properties panel lets the user hand-edit the
  //    action config as JSON — a bad edit must fail loudly, not write a
  //    file the loader will later reject and fall back from.
  const validation = validateMenuConfig(config);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  // 2. Conflict detection against the mtime the editor last saw.
  let actualMtime: number | null = null;
  try {
    actualMtime = (await fs.stat(targetPath)).mtimeMs;
  } catch {
    actualMtime = null; // no file yet (fresh install / never saved)
  }
  if (!mtimesAgree(expectedMtime, actualMtime)) {
    return { ok: 'conflict', mtime: actualMtime };
  }

  // 3. Atomic write: serialize, write a sibling temp file, rename over
  //    the target. rename(2) is atomic within one filesystem, so a
  //    reader (the daemon-side loader, another editor) never sees a
  //    half-written file. mkdir -p covers a fresh ~/.config/spaceux.
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.menu.json.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, serializeMenuConfig(validation.config), 'utf8');
    await fs.rename(tmp, targetPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // Temp file may not exist if writeFile itself failed — ignore.
    }
    return { ok: false, reason: describeError(err) };
  }

  try {
    // Return the normalized (validated) config so the caller's in-memory
    // copy matches what actually landed on disk, byte-for-byte.
    return { ok: true, mtime: (await fs.stat(targetPath)).mtimeMs, config: validation.config };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}
