// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionHandler } from '../../shared/plugin-types.js';

import { launchCommand } from './launch-detached.js';

/**
 * Built-in exec action.
 *
 * Spawns a command line as a detached subprocess so the spawned program
 * survives the core process and never blocks the action dispatch path. The
 * launch goes through `launchCommand` (shlex-style tokenisation plus an own
 * systemd scope when available, see `./launch-detached.ts`), the same path the
 * plugin-facing `ctx.launch` capability uses.
 *
 * Config schema:
 *   command (string, required): the command line to run. The first
 *     token is the binary; the rest are passed as argv.
 */
export const execAction: ActionHandler = (config, ctx) => {
  const command = typeof config.command === 'string' ? config.command.trim() : '';
  if (!command) {
    ctx.log('exec invoked without "command" config, nothing to spawn');
    return;
  }
  launchCommand(command, ctx.log);
};
