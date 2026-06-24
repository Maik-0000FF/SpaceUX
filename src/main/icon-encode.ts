// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';

import { ICON_MIME, MAX_ICON_BYTES, sanitizeSvg } from '../core/icon.js';
import { describeError } from '../shared/errors.js';

/** The non-cancelled outcomes of encoding an icon file. */
export type EncodedIcon = { ok: true; dataUri: string } | { ok: false; reason: string };

/**
 * Read an image file and encode it as an inline data URI for a node icon, the
 * way the editor draws every icon. Rejects an unsupported type and a file over
 * {@link MAX_ICON_BYTES} (checked via stat before the read, so a huge file
 * isn't loaded into memory), and sanitises SVG.
 *
 * Shared by the icon picker (EDITOR_PICK_ICON) and the program/file icon
 * resolver (#390) so both produce the same guarded, sanitised data URI from a
 * file on disk.
 */
export async function encodeIconFile(file: string): Promise<EncodedIcon> {
  const mime = ICON_MIME[path.extname(file).toLowerCase()];
  if (mime === undefined) return { ok: false, reason: 'unsupported image type' };

  let buf: Buffer;
  try {
    const { size } = await fs.stat(file);
    if (size > MAX_ICON_BYTES) {
      return {
        ok: false,
        reason: `image too large (${Math.round(size / 1024)} KB; max ${MAX_ICON_BYTES / 1024} KB)`,
      };
    }
    buf = await fs.readFile(file);
  } catch (err) {
    return { ok: false, reason: `cannot read file: ${describeError(err)}` };
  }

  const payload =
    mime === 'image/svg+xml' ? Buffer.from(sanitizeSvg(buf.toString('utf8')), 'utf8') : buf;
  return { ok: true, dataUri: `data:${mime};base64,${payload.toString('base64')}` };
}
