// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomic file write: a sibling temp file then rename(2) (atomic within one
 * filesystem, so a reader never sees a half-written file), creating the
 * directory if needed. The single implementation for every settings / config
 * write (#457), so the temp-naming is correct in one place.
 *
 * The temp name carries a process-monotonic counter on top of pid + millisecond
 * timestamp: WITHOUT it, two writes that land in the same millisecond mint the
 * SAME `.<pid>.<ms>.tmp`, and after the first rename consumes it the second
 * renames a file that no longer exists -> ENOENT (hit by a slider drag firing
 * many appearance saves). The counter makes every temp path unique within the
 * process even under that burst.
 */
let counter = 0;

function tempPathFor(target: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${counter++}.tmp`,
  );
}

/** Write `data` to `target` atomically. Throws on failure (the temp file is
 *  cleaned up first); callers add their own logging / result handling. */
export async function atomicWriteFile(target: string, data: string): Promise<void> {
  const tmp = tempPathFor(target);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // the temp file may not exist if the write itself failed — ignore
    }
    throw err;
  }
}

/** Synchronous {@link atomicWriteFile}, for the quit-flush path. */
export function atomicWriteFileSync(target: string, data: string): void {
  const tmp = tempPathFor(target);
  try {
    fsSync.mkdirSync(path.dirname(target), { recursive: true });
    fsSync.writeFileSync(tmp, data, 'utf8');
    fsSync.renameSync(tmp, target);
  } catch (err) {
    try {
      fsSync.unlinkSync(tmp);
    } catch {
      // the temp file may not exist if the write itself failed — ignore
    }
    throw err;
  }
}
