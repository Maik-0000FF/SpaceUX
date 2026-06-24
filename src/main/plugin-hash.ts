// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { PluginTrust } from '../shared/ipc.js';
import { expectedOfficialHash } from '../shared/official-plugins.js';

// Volatile or generated trees/files that are not part of a plugin's authored
// content; excluded so a runtime-generated file (Python bytecode, an editor's OS
// cruft) can't change a genuine plugin's hash.
const IGNORED_SEGMENTS = new Set(['__pycache__', 'node_modules', '.git']);
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

function isIgnoredFile(name: string): boolean {
  return IGNORED_NAMES.has(name) || name.endsWith('.pyc') || name.endsWith('.pyo');
}

function collectFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Skip symlinks deliberately: a Dirent describes the link itself, not its
    // target, so a symlinked subdir would otherwise be pushed as a "file" and
    // readFileSync would throw EISDIR, failing a genuine plugin's hash.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      // Prune ignored trees here so a plugin's node_modules/.git/__pycache__ is
      // never walked just to discard its files afterwards.
      if (!IGNORED_SEGMENTS.has(entry.name)) collectFiles(join(dir, entry.name), base, out);
      continue;
    }
    if (entry.isFile() && !isIgnoredFile(entry.name)) {
      out.push(relative(base, join(dir, entry.name)));
    }
  }
}

/**
 * Deterministic content hash of a plugin directory: every authored file's path
 * and content folded into one sha256, with paths normalised to forward slashes
 * and sorted, so the result is stable across machines and directory read order.
 *
 * Hashes the raw file bytes (no line-ending normalisation), so regenerate the
 * shipped OFFICIAL_PLUGIN_HASHES from the exact artefact users receive.
 */
export function hashPluginDir(dir: string): string {
  const rels: string[] = [];
  collectFiles(dir, dir, rels);
  const files = rels.sort();
  const digest = createHash('sha256');
  for (const rel of files) {
    const normalised = rel.split(sep).join('/');
    const fileHash = createHash('sha256')
      .update(readFileSync(join(dir, rel)))
      .digest('hex');
    digest.update(`${normalised}\0${fileHash}\n`);
  }
  return digest.digest('hex');
}

/**
 * Content-verified trust state of the plugin at `dir`:
 *  - `community` when its id is not on the curated official list;
 *  - `verified` when it is and the content matches the expected hash;
 *  - `mismatch` when it claims an official id but the content provably does not
 *    match (an impersonator or a tampered copy);
 *  - `unknown` when an official id's content can't be read to compare (a
 *    transient I/O error), so the caller shows no badge instead of a false
 *    tamper alarm.
 */
export function pluginTrust(id: string, dir: string): PluginTrust {
  const expected = expectedOfficialHash(id);
  if (expected === undefined) return 'community';
  try {
    return hashPluginDir(dir) === expected ? 'verified' : 'mismatch';
  } catch {
    return 'unknown';
  }
}
