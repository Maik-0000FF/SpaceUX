// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { HostEnvironment } from '../shared/plugin-types.js';

import { tokenize } from './builtins/tokenize.js';
import { encodeIconFile } from './icon-encode.js';
import { resolveIconFile } from './icon-theme.js';
import { keyComboFill } from './keysym-icons.js';

/**
 * Resolve the icon a Launch program / Open file action should wear, as a data
 * URI, by mapping the target to a freedesktop icon name and handing it to the
 * shared resolver (#390):
 *
 *  - exec: the program's `.desktop` `Icon=` (matched by file name or by its
 *    `Exec=` binary), else the binary name itself as an icon name;
 *  - open-file: the file's MIME type (`xdg-mime`) as a themed mimetype icon
 *    (`application/pdf` -> `application-pdf`), else its default app's `Icon=`.
 *
 * Returns null when nothing resolves (the caller leaves the icon unset). All
 * environment-specific (the icon theme, `.desktop` dirs, `xdg-mime`) and so
 * distro-independent in mechanism, only the active theme varies by desktop.
 */

/** Action kinds that take a filesystem target (a command / a file path), the
 *  ones the Browse button + the on-disk path check apply to. */
export type FileActionKind = 'exec' | 'open-file';

/** Every action kind that can auto-resolve an icon: the file-target kinds plus
 *  `key-combo`, whose icon comes from its keysym (no filesystem target). */
export type ActionIconKind = FileActionKind | 'key-combo';

/** `applications` dirs, per the Desktop Entry Spec: the per-user dir first,
 *  then each `$XDG_DATA_DIRS/applications`. */
function appDirs(): string[] {
  const env = process.env;
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [join(dataHome, 'applications'), ...dataDirs.map((d) => join(d, 'applications'))];
}

/** First line-anchored `Key=value` from a desktop entry's body, trimmed, or
 *  null. Good enough for `Icon=` / `Exec=` in the `[Desktop Entry]` group. */
export function desktopField(content: string, key: string): string | null {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1]!.trim() : null;
}

/** The binary name of an `Exec=` value: its first shlex token, basenamed (so
 *  `/usr/bin/dolphin %u` -> `dolphin`). */
export function execBinary(exec: string): string {
  const first = tokenize(exec)[0];
  return first ? basename(first) : '';
}

/** Session cache: binary name -> the program's `.desktop` `Icon=` + `Name=`,
 *  built once by scanning every `.desktop` (so a `Exec=`-only match like
 *  dolphin -> org.kde.dolphin resolves without re-reading hundreds of files per
 *  lookup). */
let execIndex: Map<string, { icon?: string; name?: string }> | null = null;
function buildExecIndex(): Map<string, { icon?: string; name?: string }> {
  const idx = new Map<string, { icon?: string; name?: string }>();
  for (const dir of appDirs()) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // dir absent
    }
    for (const name of entries) {
      if (!name.endsWith('.desktop')) continue;
      let content: string;
      try {
        content = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const exec = desktopField(content, 'Exec');
      if (!exec) continue;
      const bin = execBinary(exec);
      if (!bin) continue;
      // Per-field first-writer-wins (the per-user dir is scanned first, so it
      // wins): fill a still-missing icon/name from a later entry, so an
      // icon-less (or name-less) .desktop can't shadow one that has it.
      const prev = idx.get(bin) ?? {};
      idx.set(bin, {
        icon: prev.icon ?? desktopField(content, 'Icon') ?? undefined,
        name: prev.name ?? desktopField(content, 'Name') ?? undefined,
      });
    }
  }
  return idx;
}

/** A field (`Icon=` / `Name=`) of the `.desktop` with this file name (id),
 *  across the app dirs. */
function fieldByDesktopId(id: string, key: string): string | null {
  const file = id.endsWith('.desktop') ? id : `${id}.desktop`;
  for (const dir of appDirs()) {
    const p = join(dir, file);
    if (existsSync(p)) {
      try {
        return desktopField(readFileSync(p, 'utf8'), key);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Icon file for a Launch program command: prefer the program's `.desktop`
 *  `Icon=` (by `<prog>.desktop` name, then by `Exec=` binary), else the binary
 *  name itself as an icon name. */
function programIconFile(command: string, host: HostEnvironment): string | null {
  const prog = execBinary(command);
  if (!prog) return null;
  execIndex ??= buildExecIndex();
  const iconName = fieldByDesktopId(prog, 'Icon') ?? execIndex.get(prog)?.icon ?? prog;
  return (
    resolveIconFile(iconName, host) ?? (iconName !== prog ? resolveIconFile(prog, host) : null)
  );
}

/** Display label for a Launch program command: the program's `.desktop` `Name=`
 *  (by `<prog>.desktop` name, then by `Exec=` binary), else the binary name
 *  itself (so a command with no desktop entry still gets a sensible label). */
function programLabel(command: string): string | null {
  const prog = execBinary(command);
  if (!prog) return null;
  execIndex ??= buildExecIndex();
  return fieldByDesktopId(prog, 'Name') ?? execIndex.get(prog)?.name ?? prog;
}

/** A short, no-shell, timeout-bounded `xdg-mime query` (filetype/default). */
function xdgMime(args: string[]): string | null {
  try {
    const out = execFileSync('xdg-mime', args, {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const v = out.trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Icon file for an Open file target: the MIME type's themed mimetype icon
 *  (`application/pdf` -> `application-pdf`), else the default app's `Icon=`. */
function fileIconFile(filePath: string, host: HostEnvironment): string | null {
  const mime = xdgMime(['query', 'filetype', filePath]);
  if (!mime) return null;
  const themed = resolveIconFile(mime.replace(/\//g, '-'), host);
  if (themed) return themed;
  const defaultApp = xdgMime(['query', 'default', mime]);
  const appIcon = defaultApp ? fieldByDesktopId(defaultApp, 'Icon') : null;
  return appIcon ? resolveIconFile(appIcon, host) : null;
}

/** An action target's auto-resolved icon (data URI) and display label; either
 *  may be null when nothing resolves. */
export type ActionFill = { icon: string | null; label: string | null };

/**
 * Resolve both the icon (as a data URI) and a display label for an action
 * target. `target` is the command line for `exec` (its first token is the
 * program), the file path for `open-file`, and the chord for `key-combo`:
 *
 *  - exec: the program's `.desktop` icon + `Name=` (else the binary name) (#419);
 *  - open-file: the file's mimetype icon + its file name (#419);
 *  - key-combo: the keysym's standard icon + short label, e.g. "Mute" (#511).
 */
export async function resolveActionFill(
  kind: ActionIconKind,
  target: string,
  host: HostEnvironment,
): Promise<ActionFill> {
  // The key-combo icon + label come from one keysym lookup, reused below.
  const combo = kind === 'key-combo' ? keyComboFill(target) : null;
  const file =
    kind === 'exec'
      ? programIconFile(target, host)
      : kind === 'open-file'
        ? fileIconFile(target, host)
        : combo
          ? resolveIconFile(combo.icon, host)
          : null;
  const encoded = file ? await encodeIconFile(file) : null;
  const icon = encoded && encoded.ok ? encoded.dataUri : null;
  const label =
    kind === 'exec'
      ? programLabel(target)
      : kind === 'open-file'
        ? basename(target) || null
        : (combo?.label ?? null);
  return { icon, label };
}

/**
 * Resolve just the icon for an action target to a data URI, or null. Thin
 * wrapper over {@link resolveActionFill} for callers that only want the icon.
 */
export async function resolveActionIcon(
  kind: ActionIconKind,
  target: string,
  host: HostEnvironment,
): Promise<string | null> {
  return (await resolveActionFill(kind, target, host)).icon;
}
