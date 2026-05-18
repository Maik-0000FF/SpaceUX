// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import type {
  ActionContext,
  ActionDescriptor,
  ActionHandler,
  PluginManifest,
  PluginModule,
} from '../shared/plugin-types.js';

/**
 * Discover plugins under the standard XDG paths, validate their
 * manifest, and import their handler module.
 *
 * Search order (first hit wins per plugin id):
 *   1. $XDG_DATA_HOME/spaceux/plugins/<id>/
 *   2. ~/.local/share/spaceux/plugins/<id>/
 *   3. /usr/local/share/spaceux/plugins/<id>/
 *   4. /usr/share/spaceux/plugins/<id>/
 *   5. The repo-local `plugins/` directory (development convenience).
 *
 * The loader never throws on a bad plugin — it logs and skips so one
 * misbehaving plugin can't take the whole UI down. Plugin authors get
 * structured error messages via the returned `errors` array.
 */

export type LoadedPlugin = {
  manifest: PluginManifest;
  dir: string;
  handlers: Record<string, ActionHandler>;
};

export type LoadResult = {
  plugins: LoadedPlugin[];
  errors: { dir: string; reason: string }[];
};

export function pluginSearchPaths(repoRoot?: string): string[] {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const home = os.homedir();
  const paths = [
    xdg ? path.join(xdg, 'spaceux', 'plugins') : null,
    path.join(home, '.local', 'share', 'spaceux', 'plugins'),
    '/usr/local/share/spaceux/plugins',
    '/usr/share/spaceux/plugins',
    repoRoot ? path.join(repoRoot, 'plugins') : null,
  ];
  // Dedup while preserving order. Filter out empty strings + nulls.
  const seen = new Set<string>();
  return paths.filter((p): p is string => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

export async function loadPlugins(searchPaths: string[]): Promise<LoadResult> {
  const out: LoadResult = { plugins: [], errors: [] };
  const seenIds = new Set<string>();

  for (const root of searchPaths) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = path.join(root, entry);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const result = await loadOne(dir);
      if ('reason' in result) {
        out.errors.push({ dir, reason: result.reason });
        continue;
      }
      if (seenIds.has(result.manifest.id)) {
        // Earlier path won — that's the override semantics users
        // expect ("my local copy shadows the system one").
        continue;
      }
      seenIds.add(result.manifest.id);
      out.plugins.push(result);
    }
  }
  return out;
}

async function loadOne(dir: string): Promise<LoadedPlugin | { reason: string }> {
  const manifestPath = path.join(dir, 'manifest.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    return { reason: `cannot read manifest.json: ${describeError(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { reason: `manifest.json is not valid JSON: ${describeError(err)}` };
  }

  const manifestErr = validateManifest(parsed);
  if (manifestErr) return { reason: manifestErr };
  const manifest = parsed as PluginManifest;

  // Module resolution: relative file:// URL so ESM and CJS both work.
  const indexPath = path.join(dir, 'index.js');
  let mod: PluginModule;
  try {
    const imported = (await import(pathToFileURL(indexPath).href)) as
      | PluginModule
      | { default: PluginModule };
    mod = 'actions' in imported ? imported : (imported as { default: PluginModule }).default;
  } catch (err) {
    return { reason: `cannot import index.js: ${describeError(err)}` };
  }
  if (!mod || typeof mod.actions !== 'object' || mod.actions === null) {
    return { reason: 'index.js does not export an `actions` object' };
  }

  // Every action named in the manifest must have a matching handler.
  const handlers: Record<string, ActionHandler> = {};
  for (const action of manifest.actions) {
    const fn = mod.actions[action.name];
    if (typeof fn !== 'function') {
      return {
        reason: `manifest declares action "${action.name}" but index.js has no matching handler`,
      };
    }
    handlers[action.name] = fn;
  }

  return { manifest, dir, handlers };
}

function validateManifest(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'manifest is not a JSON object';
  const m = value as Record<string, unknown>;
  for (const key of ['id', 'name', 'version', 'license'] as const) {
    if (typeof m[key] !== 'string' || (m[key] as string).trim() === '') {
      return `manifest field "${key}" must be a non-empty string`;
    }
  }
  if (!Array.isArray(m.actions) || m.actions.length === 0) {
    return 'manifest field "actions" must be a non-empty array';
  }
  for (const action of m.actions as unknown[]) {
    if (typeof action !== 'object' || action === null) return 'every action must be an object';
    const a = action as Record<string, unknown>;
    if (typeof a.name !== 'string' || a.name.trim() === '')
      return 'action.name must be a non-empty string';
    if (typeof a.label !== 'string' || a.label.trim() === '')
      return 'action.label must be a non-empty string';
  }
  return null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Build a per-plugin ActionContext with a logger that prefixes every
 *  message with the plugin id. */
export function makeActionContext(pluginId: string): ActionContext {
  return {
    pluginId,
    log: (message: string) => {
      // eslint-disable-next-line no-console
      console.log(`[plugin ${pluginId}] ${message}`);
    },
  };
}

/** Convenience reducer: flatten every loaded plugin's actions into one
 *  map keyed by "<pluginId>/<actionName>". The renderer addresses
 *  actions by this composite key so two plugins can both expose
 *  e.g. "launch" without clashing. */
export function indexActions(
  plugins: LoadedPlugin[],
): Record<string, { plugin: LoadedPlugin; descriptor: ActionDescriptor }> {
  const idx: Record<string, { plugin: LoadedPlugin; descriptor: ActionDescriptor }> = {};
  for (const plugin of plugins) {
    for (const descriptor of plugin.manifest.actions) {
      idx[`${plugin.manifest.id}/${descriptor.name}`] = { plugin, descriptor };
    }
  }
  return idx;
}
