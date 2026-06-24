// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionPathCheck } from '../shared/ipc.js';

/**
 * Turn the on-disk facts about a Launch program / Open file target into an
 * editor warning, or null when the target fits its action (#457: core-owned
 * so the editor renders the one canonical wording).
 * The runtime only logs a mismatch to the daemon console, so this is the user's
 * one chance to see that an action won't fire before they try it. Pure and
 * UI-free; the async filesystem check (`checkActionPath`) lives in main.
 *
 *  - exec wants an existing, executable program (the target is run as a
 *    command); a folder or a non-executable file is flagged, with a nudge toward
 *    Open file for a document.
 *  - open-file wants a file the desktop can open; an actual program is flagged,
 *    with a nudge toward Launch program.
 */
export function actionPathHint(kind: 'exec' | 'open-file', check: ActionPathCheck): string | null {
  if (check.resolved === null) return null; // nothing parseable entered yet
  if (kind === 'exec') {
    if (!check.exists) {
      return check.fromPath
        ? `Not found on PATH: ${check.resolved}. Launch program needs a command that exists.`
        : `Not found: ${check.resolved}. Launch program needs a program that exists.`;
    }
    if (check.directory) return `That is a folder, not a program.`;
    if (!check.executable) {
      return `Not executable: ${check.resolved}. Launch program runs the target as a command; pick a program, or use Open file to open a document with its default app.`;
    }
    return null;
  }
  // open-file
  if (!check.exists) return `Not found: ${check.resolved}. Open file needs a file that exists.`;
  if (check.program) {
    return `${check.resolved} is a program. Open file hands the path to the desktop default app; use Launch program to run a program.`;
  }
  return null;
}
