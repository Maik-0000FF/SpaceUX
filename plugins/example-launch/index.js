// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Example plugin: launch an arbitrary command.
 *
 * Demonstrates the minimum shape a plugin handler must take: a named
 * export of `actions` mapping the action.name strings from manifest.json
 * to an async (or sync) function that receives the per-instance config
 * the user filled in via the editor.
 *
 * The command is split with the same lazy whitespace heuristic the
 * Stream-Deck-style daemons use; richer parsing (shlex-style quoting)
 * is intentionally left to a follow-up plugin so this example stays
 * the smallest thing that demonstrates the contract.
 */

import { spawn } from 'node:child_process';

async function launch(config, ctx) {
  const command = typeof config.command === 'string' ? config.command.trim() : '';
  if (!command) {
    ctx.log('no command configured');
    return;
  }
  const tokens = command.split(/\s+/);
  const [bin, ...args] = tokens;
  if (!bin) {
    // See src/main/builtins/exec.ts for the rationale — the earlier
    // `!command` guard makes this branch unreachable with the current
    // whitespace split, but logging defends against a future parser
    // tweak that could yield an empty first token.
    ctx.log(`command "${command}" parsed to no binary — refusing to spawn`);
    return;
  }
  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: 'ignore',
    });
    // spawn() returns a ChildProcess synchronously even when the
    // binary cannot be found; it then emits either 'spawn' on success
    // (pid is set) or 'error' on failure (e.g. ENOENT). Logging
    // "spawned" off the synchronous return would print a misleading
    // success line before the error event arrived. The 'error'
    // listener is also load-bearing: without it the failure becomes
    // an uncaught exception in the host process and the user sees a
    // crash dialog. Third-party plugin authors that spawn subprocesses
    // should always attach an 'error' handler the same way.
    child.on('spawn', () => {
      ctx.log(`spawned ${bin} (pid ${child.pid ?? 'unknown'})`);
    });
    child.on('error', (err) => {
      ctx.log(`${bin} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    child.unref();
  } catch (err) {
    ctx.log(`spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const actions = {
  launch,
};
