// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';

import { describeError } from '../../shared/errors.js';
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
    // node's child_process.spawn() returns the ChildProcess object
    // synchronously even when the binary cannot be found — the actual
    // success or failure arrives asynchronously as either a 'spawn'
    // event (process is live, pid is set) or an 'error' event (e.g.
    // ENOENT). Logging "spawned" off the synchronous return would
    // print a misleading success line before the error landed. The
    // 'error' handler is also load-bearing: without it, ENOENT
    // propagates as an uncaught exception in the Electron main
    // process and the user gets a crash dialog.
    child.on('spawn', () => {
      ctx.log(`spawned ${bin} (pid ${child.pid ?? 'unknown'})`);
    });
    child.on('error', (err) => {
      ctx.log(`exec: ${bin} failed: ${describeError(err)}`);
    });
    child.unref();
  } catch (err) {
    // Defensive catch for the synchronous failure modes (e.g. invalid
    // arguments to spawn); ENOENT and friends flow through the 'error'
    // handler above.
    ctx.log(`exec: spawn failed: ${describeError(err)}`);
  }
};
