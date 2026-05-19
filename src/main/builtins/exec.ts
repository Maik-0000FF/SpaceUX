// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';

import { describeError } from '../../shared/errors.js';
import type { ActionHandler } from '../../shared/plugin-types.js';

import { tokenize } from './tokenize.js';

/**
 * Built-in exec action.
 *
 * Spawns a command line as a detached subprocess so the spawned
 * program survives this Electron process and never blocks the
 * action dispatch path. Tokenisation is shlex-style (see
 * `./tokenize.ts`): whitespace splits, double / single quotes
 * group, so paths with spaces (`xdg-open "Mein File.pdf"`) reach
 * spawn() as a single argv entry instead of three corrupted ones.
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
  const tokens = tokenize(command);
  const bin = tokens[0];
  const args = tokens.slice(1);
  if (!bin) {
    // Reachable when the tokenizer yields an empty first token,
    // typically an empty quoted segment at the start (e.g. `""` or
    // `"" foo`). Rare in real menu.json configs but a typo can
    // produce it; log instead of silently no-op'ing so the user
    // sees their command get rejected. JSON.stringify keeps the
    // log readable when the command itself contains quotes.
    ctx.log(`exec: command ${JSON.stringify(command)} parsed to no binary — refusing to spawn`);
    return;
  }
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
