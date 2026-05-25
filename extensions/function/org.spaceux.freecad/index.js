// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * FreeCAD plugin (#77, Phase D1) — a context-aware pie driven by the live
 * FreeCAD session over a UNIX socket.
 *
 * The bridge addon (freecad/, installed into FreeCAD's Mod/) runs a socket
 * server; this plugin connects per request:
 *   - `provideMenu` (called by the host at each open) asks the bridge for the
 *     active workbench's toolbars + commands and builds the pie: one branch
 *     per toolbar, a leaf per command (label + icon, running the command on
 *     commit). When FreeCAD or the bridge is down the connection fails and the
 *     host falls back to the static placeholder menu (manifest.menu).
 *   - the `run` action sends the command name back to the bridge to execute.
 *
 * Uses only `node:net` (a Node built-in) — no host internals — so it stays a
 * self-contained, copyable plugin. The socket path mirrors the addon's:
 * `$XDG_RUNTIME_DIR/spaceux/freecad.sock` (else /tmp).
 */

import net from 'node:net';
import path from 'node:path';

const PLUGIN_ID = 'org.spaceux.freecad';
// Below the host's 2s provideMenu timeout, so a slow-but-alive bridge still
// answers while a dead socket fails fast (ENOENT/ECONNREFUSED).
const REQUEST_TIMEOUT_MS = 1500;
// The editor catalog (esp. loadAll, which cycles every workbench) is a
// deliberate, non-interactive request — give it far longer than a pie open.
// Sits just above the host's loadAll cap (60s in index.ts) so the host stays
// the authoritative timeout (it reports the failure reason to the editor);
// this only guards against a truly hung socket.
const CATALOG_TIMEOUT_MS = 65000;

function socketPath() {
  const base = process.env.XDG_RUNTIME_DIR || '/tmp';
  return path.join(base, 'spaceux', 'freecad.sock');
}

/** Send one newline-delimited JSON request and resolve its single JSON reply.
 *  Rejects on connect error or timeout — the caller maps that to "bridge
 *  unreachable". */
function request(req, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath());
    let buf = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('bridge timed out')), timeoutMs);
    conn.on('connect', () => conn.write(JSON.stringify(req) + '\n'));
    conn.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      try {
        finish(resolve, JSON.parse(buf.slice(0, nl)));
      } catch (err) {
        finish(reject, err instanceof Error ? err : new Error(String(err)));
      }
    });
    conn.on('error', (err) => finish(reject, err));
  });
}

async function run(config, ctx) {
  const name = typeof config.command === 'string' ? config.command.trim() : '';
  if (!name) {
    ctx.log('no FreeCAD command configured');
    return;
  }
  try {
    const resp = await request({ op: 'run', name });
    if (!resp || resp.ok !== true) {
      ctx.log(`run ${name} failed: ${resp && resp.error ? resp.error : 'unknown error'}`);
    }
  } catch (err) {
    ctx.log(`FreeCAD bridge unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const actions = {
  run,
};

/**
 * Build the pie from the live FreeCAD context. One branch per toolbar, a leaf
 * per command. Throws on a bridge error so the host falls back to the static
 * placeholder menu (FreeCAD closed / addon not installed).
 */
export async function provideMenu(ctx) {
  const resp = await request({ op: 'context' });
  if (!resp || resp.ok !== true) {
    throw new Error(resp && resp.error ? resp.error : 'bridge returned no context');
  }
  const branches = (Array.isArray(resp.toolbars) ? resp.toolbars : [])
    .map((tb) => ({
      label: typeof tb.name === 'string' ? tb.name : 'Tools',
      branches: (Array.isArray(tb.commands) ? tb.commands : []).map(itemToNode),
    }))
    .filter((b) => b.branches.length > 0);
  ctx.log(`workbench ${resp.workbench || '?'}: ${branches.length} toolbar(s)`);
  // Empty centre label — the workbench-name indicator lands separately (#186).
  return { label: '', branches };
}

/** A catalog/context command → a pie node. A command group (#208, `members`
 *  present) becomes a submenu (third level) over its member leaves; a plain
 *  command becomes a run leaf. */
function itemToNode(c) {
  if (Array.isArray(c.members) && c.members.length) {
    return {
      label: c.label || c.name || 'Group',
      ...(c.icon ? { icon: c.icon } : {}),
      branches: c.members.map(itemToNode),
    };
  }
  return {
    label: c.label || c.name,
    ...(c.icon ? { icon: c.icon } : {}),
    action: { id: `${PLUGIN_ID}/run`, config: { command: c.name } },
  };
}

/** A bridge command entry → a PluginCatalogCommand (the editor's `command` is
 *  the bridge `name`). Carries `members` for a command group (#208). */
function catalogCmd(c) {
  const out = { command: c.name, label: c.label || c.name };
  if (c.icon) out.icon = c.icon;
  if (typeof c.enabled === 'boolean') out.enabled = c.enabled;
  if (Array.isArray(c.members) && c.members.length) out.members = c.members.map(catalogCmd);
  return out;
}

/**
 * The live context for #193 PR3 / #186 / #229: the active workbench class name
 * (`key`, to pick a curated per-workbench pie), FreeCAD's own app icon (`badge`,
 * active-plugin indicator, bottom-left) and the active workbench's icon (`icon`,
 * active-workbench indicator, bottom-right). Returns null when the bridge is
 * unreachable or reports no workbench (the host falls back to the dynamic menu).
 */
export async function provideContext() {
  try {
    const resp = await request({ op: 'context' });
    if (resp && resp.ok === true && typeof resp.workbench === 'string' && resp.workbench) {
      const badge = typeof resp.appIcon === 'string' && resp.appIcon ? resp.appIcon : undefined;
      const icon =
        typeof resp.workbenchIcon === 'string' && resp.workbenchIcon
          ? resp.workbenchIcon
          : undefined;
      return { key: resp.workbench, badge, icon };
    }
  } catch {
    // Bridge down / no context → null; the host falls back to the dynamic menu.
  }
  return null;
}

/**
 * Command catalog for the editor's palette (#76 D2): every workbench's commands
 * grouped by workbench. `opts.loadAll` makes FreeCAD briefly activate every
 * workbench so unloaded ones are included too (the GUI cycles through them) —
 * only on explicit request; without it, only already-loaded workbenches appear.
 * Each command carries the `run` action's config value (`command`) + a baked
 * icon, so the editor can drop it straight into a menu as a normal item.
 * Throws when the bridge is unreachable (FreeCAD closed / addon not installed).
 */
export async function provideCatalog(ctx, opts) {
  const loadAll = !!(opts && opts.loadAll);
  const resp = await request({ op: 'catalog', loadAll }, CATALOG_TIMEOUT_MS);
  if (!resp || resp.ok !== true) {
    throw new Error(resp && resp.error ? resp.error : 'bridge returned no catalog');
  }
  const groups = (Array.isArray(resp.workbenches) ? resp.workbenches : []).map((wb) => ({
    // Stable key (workbench class name) — used to key curated per-workbench
    // pies (#193) and match the live active workbench; falls back to the name.
    key:
      typeof wb.key === 'string' && wb.key
        ? wb.key
        : typeof wb.name === 'string'
          ? wb.name
          : 'Commands',
    name: typeof wb.name === 'string' ? wb.name : wb.key || 'Commands',
    // The workbench's own icon (#229), if the bridge resolved one.
    ...(typeof wb.icon === 'string' && wb.icon ? { icon: wb.icon } : {}),
    // Commands grouped by toolbar (#193) so a curated pie seeds one submenu per
    // toolbar (mirrors the dynamic pie); the palette flattens these for search.
    toolbars: (Array.isArray(wb.toolbars) ? wb.toolbars : []).map((tb) => ({
      name: typeof tb.name === 'string' ? tb.name : 'Tools',
      commands: (Array.isArray(tb.commands) ? tb.commands : []).map(catalogCmd),
    })),
  }));
  ctx.log(`catalog: ${groups.length} group(s), loadedAll=${resp.loadedAll === true}`);
  // FreeCAD's own app icon (#186), read live by the bridge — the active-plugin
  // badge. Undefined when the bridge couldn't read it (older bridge / no icon).
  const appBadge = typeof resp.appIcon === 'string' && resp.appIcon ? resp.appIcon : undefined;
  return { groups, complete: resp.loadedAll === true, appBadge };
}

/**
 * Reserve / release the pie-trigger button in FreeCAD (#191). FreeCAD reads the
 * same SpaceMouse via spacenavd, so a press on the pie-trigger button would both
 * open the SpaceUX pie *and* fire whatever FreeCAD bound to that button. The host
 * calls us with `reserve: true` to clear FreeCAD's binding for that button (the
 * bridge saves the original so it can be restored) and `reserve: false` to put
 * it back. The bridge keeps the original in FreeCAD's own parameter store, so the
 * call is idempotent and survives a bridge/FreeCAD restart.
 *
 * We throw on an unreachable bridge / error instead of logging: the host polls
 * this (FreeCAD is often closed), so a per-call log would spam — the host logs
 * once on a state change, and the bridge logs the actual clear in its Report view.
 */
export async function reserveTrigger(ctx, req) {
  const button = Number.isInteger(req && req.button) ? req.button : null;
  if (button === null || button < 0) {
    ctx.log(`reserveTrigger: ignoring invalid button ${req && req.button}`);
    return;
  }
  const op = req.reserve ? 'reserve-button' : 'release-button';
  const resp = await request({ op, button });
  if (!resp || resp.ok !== true) {
    throw new Error(resp && resp.error ? resp.error : `${op} failed`);
  }
}
