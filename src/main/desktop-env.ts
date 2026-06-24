// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { KNOWN_DESKTOPS, type HostEnvironment, type SessionType } from '../shared/plugin-types.js';

/**
 * Detect the running desktop environment + distro from the standard
 * freedesktop signals, so both the host's own commands and plugins (via
 * `ctx.host.environment`) can resolve generic commands per environment
 * instead of hard-coding one desktop's tools (#386). One detector feeds the
 * whole app: the host imports these functions directly (e.g. the KDE-Wayland
 * cursor workaround), plugins read the resulting descriptor off the context.
 *
 * The parsing is split into pure functions that take their inputs explicitly
 * (env object, /etc/os-release text) so they're unit-testable without
 * touching the real process environment or filesystem; `readHostEnvironment`
 * is the thin IO wrapper the host calls once at startup.
 */

/** Standard path of the distro identity file. */
const OS_RELEASE_PATH = '/etc/os-release';

/** The desktop-name vars to consult, most authoritative first. Older display
 *  managers set only `$DESKTOP_SESSION`. */
const DESKTOP_ENV_KEYS = ['XDG_CURRENT_DESKTOP', 'XDG_SESSION_DESKTOP', 'DESKTOP_SESSION'];

/** Collapse a single token (already lowercased) to a known desktop id, or
 *  null when it isn't one we recognise. Only handles aliases and membership;
 *  unrecognised tokens are left for the caller to keep verbatim. */
function canonicalDesktop(token: string): string | null {
  // KDE reports "KDE"; the compositor is Plasma, so accept both.
  if (token === 'kde' || token === 'plasma') return 'kde';
  // Cinnamon reports "X-Cinnamon" in XDG_CURRENT_DESKTOP.
  if (token === 'cinnamon' || token === 'x-cinnamon') return 'cinnamon';
  return (KNOWN_DESKTOPS as readonly string[]).includes(token) ? token : null;
}

/**
 * Normalise a raw desktop string (the value of `$XDG_CURRENT_DESKTOP` etc.)
 * to a desktop id, or "" when empty.
 *
 * The value is a colon-separated, case-insensitive list that may carry a
 * vendor prefix ("ubuntu:GNOME"). We return the first *recognised* token
 * (collapsing aliases, skipping the vendor prefix). When none is recognised
 * the desktop is still reported, by its own name: we take the *last* token,
 * since the vendor prefix conventionally comes first ("pop:cosmic" -> "cosmic",
 * "Hyprland" -> "hyprland"). Nothing is flattened to a sentinel.
 */
export function normaliseDesktop(raw: string | undefined): string {
  if (!raw) return '';
  const tokens = raw
    .toLowerCase()
    .split(':')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return '';
  for (const token of tokens) {
    const id = canonicalDesktop(token);
    if (id) return id;
  }
  return tokens[tokens.length - 1]!;
}

/** The raw desktop string the session reported, from the first env var that
 *  carries one, or "" when none is set. Paired with {@link normaliseDesktop}
 *  so the descriptor keeps both the normalised id and the original. */
export function detectDesktopRaw(env: NodeJS.ProcessEnv): string {
  for (const key of DESKTOP_ENV_KEYS) {
    const value = env[key];
    if (value) return value;
  }
  return '';
}

/** Read the session type from `$XDG_SESSION_TYPE`. */
export function detectSessionType(env: NodeJS.ProcessEnv): SessionType {
  const raw = (env.XDG_SESSION_TYPE ?? '').toLowerCase();
  if (raw === 'wayland') return 'wayland';
  if (raw === 'x11') return 'x11';
  return 'unknown';
}

/** Strip one matching pair of surrounding quotes from an os-release value.
 *  os-release permits `ID="ubuntu"` and `ID=arch`; only a balanced pair is
 *  stripped so a stray quote is left untouched. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the `ID` and `ID_LIKE` fields out of /etc/os-release content.
 * `ID` is the distro id (e.g. "arch"); `ID_LIKE` is a whitespace-separated
 * list of parent distros (e.g. `ID_LIKE="ubuntu debian"`). Both are
 * lowercased. Missing fields yield "" / []. Unrecognised lines are ignored,
 * so a malformed or empty file degrades to the unknown distro.
 */
export function parseOsRelease(content: string): { id: string; idLike: string[] } {
  let id = '';
  let idLike: string[] = [];
  for (const line of content.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = unquote(line.slice(eq + 1).trim()).toLowerCase();
    if (key === 'ID') id = value;
    else if (key === 'ID_LIKE') idLike = value.split(/\s+/).filter(Boolean);
  }
  return { id, idLike };
}

/** Assemble a {@link HostEnvironment} from an env object and the os-release
 *  text (null when the file couldn't be read, e.g. off Linux). Pure, so the
 *  whole descriptor is testable from fixtures. */
export function detectEnvironment(
  env: NodeJS.ProcessEnv,
  osReleaseContent: string | null,
): HostEnvironment {
  const desktopRaw = detectDesktopRaw(env);
  return {
    desktop: normaliseDesktop(desktopRaw),
    desktopRaw,
    sessionType: detectSessionType(env),
    distro: osReleaseContent !== null ? parseOsRelease(osReleaseContent) : { id: '', idLike: [] },
  };
}

/** Read the live host environment from `process.env` + `/etc/os-release`.
 *  Called once at host startup. A missing/unreadable os-release (non-Linux,
 *  minimal container) just leaves the distro unknown. */
export function readHostEnvironment(): HostEnvironment {
  let osRelease: string | null = null;
  try {
    osRelease = readFileSync(OS_RELEASE_PATH, 'utf8');
  } catch {
    // No /etc/os-release (non-Linux, or a stripped container): distro unknown.
  }
  return detectEnvironment(process.env, osRelease);
}
