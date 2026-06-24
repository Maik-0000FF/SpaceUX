// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

import type { ActionPathCheck } from '../shared/ipc.js';

import type { FileActionKind } from './action-icon.js';
import { tokenize } from './builtins/tokenize.js';

/**
 * Check whether a Launch program / Open file target actually fits the action,
 * so the editor can warn before it silently fails at fire time (the runtime
 * only logs to the daemon console). Distro-independent in mechanism: a PATH
 * walk for a bare program name and `xdg-mime` for the file's type.
 *
 *  - exec: the command's first token is the program. A literal path (contains
 *    a slash) is stat'd directly; a bare name is looked up on PATH. We report
 *    whether it exists, is a directory, and carries an executable bit.
 *  - open-file: the path itself is inspected. `program` is set from its MIME
 *    type (an executable/shared-object), not the X bit, so a blanket +x from a
 *    FAT/NTFS mount can't misreport a document as a program.
 */

type StatFacts = { exists: boolean; directory: boolean; executable: boolean };

function statFacts(p: string): StatFacts {
  try {
    const st = statSync(p);
    if (st.isDirectory()) return { exists: true, directory: true, executable: false };
    let executable = false;
    try {
      accessSync(p, constants.X_OK);
      executable = true;
    } catch {
      executable = false;
    }
    return { exists: true, directory: false, executable };
  } catch {
    return { exists: false, directory: false, executable: false };
  }
}

/** Directories to search for a bare command name. The core is a long-running
 *  daemon and a GUI / session / autostart launch can hand it an almost-empty
 *  PATH, so an installed program would be wrongly flagged "not found". Always
 *  search the standard system bin dirs and the user's ~/.local/bin on top of
 *  whatever PATH was inherited (deduped), so the result doesn't depend on how
 *  the core was started. */
function commandSearchDirs(): string[] {
  const inherited = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const baseline = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/sbin',
    '/usr/sbin',
    '/sbin',
    join(homedir(), '.local', 'bin'),
  ];
  return [...new Set([...inherited, ...baseline])];
}

/** First executable match for a bare command name across the search dirs, else
 *  null. */
function resolveOnPath(name: string): string | null {
  for (const dir of commandSearchDirs()) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here, keep looking
    }
  }
  return null;
}

/** Whether `xdg-mime` reports the file as a program (executable / shared
 *  object). A short, no-shell, timeout-bounded query; any failure folds to
 *  false (treat as "not a program", so we never warn on a query we couldn't
 *  run). */
function isProgramByMime(filePath: string): boolean {
  try {
    const out = execFileSync('xdg-mime', ['query', 'filetype', filePath], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const mime = out.trim();
    return /executable|x-sharedlib|x-mach-binary|x-msdownload/.test(mime);
  } catch {
    return false;
  }
}

export function checkActionPath(kind: FileActionKind, target: string): ActionPathCheck {
  const value = target.trim();
  if (kind === 'open-file') {
    const facts = statFacts(value);
    return {
      resolved: value || null,
      fromPath: false,
      ...facts,
      program: facts.exists && !facts.directory ? isProgramByMime(value) : false,
    };
  }
  // exec: inspect the command's first token (the program to spawn).
  const first = tokenize(value)[0] ?? '';
  if (!first) {
    return {
      resolved: null,
      fromPath: false,
      exists: false,
      directory: false,
      executable: false,
      program: false,
    };
  }
  if (first.includes('/') || isAbsolute(first)) {
    return { resolved: first, fromPath: false, ...statFacts(first), program: false };
  }
  const onPath = resolveOnPath(first);
  if (onPath) {
    return {
      resolved: onPath,
      fromPath: true,
      exists: true,
      directory: false,
      executable: true,
      program: false,
    };
  }
  return {
    resolved: first,
    fromPath: true,
    exists: false,
    directory: false,
    executable: false,
    program: false,
  };
}
