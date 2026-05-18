// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';

import type { ActionHandler } from '../../shared/plugin-types.js';

/**
 * Built-in exec action.
 *
 * Spawns a command line as a detached subprocess so the spawned
 * program survives this Electron process and never blocks the
 * action dispatch path. Whitespace tokenisation is intentionally
 * the simplest possible split — quoted arguments with spaces are
 * not yet supported; that lands as part of a richer parser when
 * we wire the action-editor UI in Phase 2.
 *
 * Config schema:
 *   command (string, required): the command line to run. The first
 *     token is the binary; the rest are passed as argv.
 */

export const execAction: ActionHandler = async (config, ctx) => {
  const command = typeof config.command === 'string' ? config.command.trim() : '';
  if (!command) {
    ctx.log('exec invoked without "command" config — nothing to spawn');
    return;
  }
  const tokens = command.split(/\s+/);
  const bin = tokens[0];
  const args = tokens.slice(1);
  if (!bin) return;
  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    ctx.log(`spawned ${bin} (pid ${child.pid ?? 'unknown'})`);
  } catch (err) {
    ctx.log(`exec: spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};
