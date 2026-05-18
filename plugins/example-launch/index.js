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
  if (!bin) return;
  try {
    const child = spawn(bin, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    ctx.log(`spawned ${bin} (pid ${child.pid ?? 'unknown'})`);
  } catch (err) {
    ctx.log(`spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const actions = {
  launch,
};
