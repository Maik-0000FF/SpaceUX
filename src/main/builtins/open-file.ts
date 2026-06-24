// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionHandler } from '../../shared/plugin-types.js';

import { launchDetached } from './launch-detached.js';

/**
 * Built-in open-file action.
 *
 * Opens a file or document with the desktop's default application by handing
 * the configured path to `xdg-open` as a single argument, detached from the
 * core process via `launchDetached` (own systemd scope when available, see
 * `./launch-detached.ts`). Unlike the exec action, the path is NOT tokenised:
 * it is one argv entry, so a path with spaces (`My Drawing.FCStd`) opens
 * correctly without any quoting in the config.
 *
 * Config schema:
 *   path (string, required): the file/document to open.
 */
export const openFileAction: ActionHandler = (config, ctx) => {
  const path = typeof config.path === 'string' ? config.path.trim() : '';
  if (!path) {
    ctx.log('open-file invoked without "path" config, nothing to open');
    return;
  }
  // xdg-open is short-lived: it picks the handler, launches it, and exits. A
  // non-zero exit means it opened nothing (xdg-open: 2 = no such file, 3 = tool
  // not found, 4 = action failed / no association). `systemd-run --scope`
  // propagates that code, so the onExit handler still sees it. Log it so a
  // silent "nothing happened" isn't masked.
  launchDetached('xdg-open', [path], ctx.log, {
    label: `xdg-open ${JSON.stringify(path)}`,
    onExit: (code) => {
      if (code) {
        ctx.log(
          `open-file: xdg-open exited with code ${code} (nothing opened: missing file or no associated application?)`,
        );
      }
    },
  });
};
