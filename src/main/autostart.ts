// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BACKGROUND_FLAG } from '../shared/launch.js';

import { loadAppSettings, saveAppSettings } from './app-settings.js';

/**
 * Launch-on-login via an XDG autostart entry (the editor's "Launch on login"
 * toggle). We own a single desktop entry at
 * $XDG_CONFIG_HOME/autostart/spaceux.desktop (or ~/.config/autostart/...).
 *
 * The entry's *presence is the on/off state* — no flag is persisted in
 * app-settings.json. A stored boolean could disagree with the file once the
 * user removes the entry out-of-band (KDE's System Settings > Autostart), so
 * the toggle would lie; reading the file keeps it honest.
 *
 * The entry runs the same launcher the app-menu shortcut does
 * (~/.local/bin/spaceux, written by scripts/install.sh): it starts the daemon
 * and the core. The single-instance guard (#415) makes a redundant
 * login-time launch a clean no-op when one is already running. Unlike the
 * app-menu shortcut, the autostart entry passes BACKGROUND_FLAG so login stays
 * silent (no editor); an interactive launch opens the editor (#497).
 *
 * The optional icon path is injected by the caller (which can resolve it
 * packaging-aware) rather than resolved here, keeping the file logic
 * unit-testable under vitest's node env.
 */

/** XDG config base, honouring XDG_CONFIG_HOME like app-settings.ts. */
function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
}

/** Absolute path of the autostart entry we own. */
function autostartFile(): string {
  return path.join(configHome(), 'autostart', 'spaceux.desktop');
}

/** The launcher scripts/install.sh drops in ~/.local/bin. */
function launcherPath(): string {
  return path.join(os.homedir(), '.local', 'bin', 'spaceux');
}

/** Whether the launcher exists — i.e. install.sh has run. The autostart entry
 *  points at it, so seeding only makes sense once it's there. */
async function launcherInstalled(): Promise<boolean> {
  try {
    await fs.access(launcherPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the desktop entry, mirroring the app-menu shortcut (name, comment,
 * icon) so the desktop's autostart list shows a recognisable item. The
 * GNOME/KDE autostart hints keep it enabled. `iconPath` is omitted when the
 * caller can't resolve it (e.g. the unit test) rather than guessing a path.
 */
function desktopEntry(iconPath?: string): string {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=SpaceUX',
    'Comment=Radial pie menu for 3Dconnexion SpaceMouse devices',
    `Exec=${launcherPath()} ${BACKGROUND_FLAG}`,
  ];
  if (iconPath) lines.push(`Icon=${iconPath}`);
  lines.push(
    'Terminal=false',
    'Categories=Utility;',
    'X-GNOME-Autostart-enabled=true',
    '', // trailing newline
  );
  return lines.join('\n');
}

/** Whether launch-on-login is currently enabled (the entry exists). */
export async function isAutostartEnabled(): Promise<boolean> {
  try {
    await fs.access(autostartFile());
    return true;
  } catch {
    return false;
  }
}

/**
 * Enable or disable launch-on-login by writing or removing the entry. Returns
 * the resulting state, re-read from disk: a write that fails is logged (not
 * thrown), and the returned value reflects reality so an optimistic UI toggle
 * corrects itself instead of lying.
 */
export async function setAutostartEnabled(enabled: boolean, iconPath?: string): Promise<boolean> {
  const file = autostartFile();
  try {
    if (enabled) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, desktopEntry(iconPath), 'utf8');
    } else {
      await fs.rm(file, { force: true });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autostart] failed to update the autostart entry:', err);
  }
  return isAutostartEnabled();
}

/**
 * Seed launch-on-login ON the first time the app runs, then never again.
 * Autostart defaults to enabled, but since the entry's on-disk presence is the
 * sole source of truth, "default on" needs a way to tell a fresh install from a
 * user who deliberately turned it off — otherwise it would re-appear on every
 * launch. The one-shot `autostartSeeded` flag in app-settings.json provides
 * that: we write the entry and set the flag once. Afterwards the file alone
 * decides, so a later turn-off (the toggle or the desktop's autostart settings)
 * sticks. Best-effort: a failure is swallowed by the callees, never thrown into
 * startup.
 */
export async function ensureAutostartSeeded(iconPath?: string): Promise<void> {
  const settings = await loadAppSettings();
  if (settings.autostartSeeded) return;
  // Only seed once the launcher is actually installed (install.sh has run): a
  // dev run from source has no launcher, so seeding would drop a session
  // autostart entry pointing at a binary that doesn't exist. Skip it and leave
  // the flag unset, so a later real install still seeds on its first launch.
  if (!(await launcherInstalled())) return;
  await setAutostartEnabled(true, iconPath);
  await saveAppSettings({ autostartSeeded: true });
}

/**
 * Bring an autostart entry seeded before #497 up to the silent BACKGROUND_FLAG
 * form. Those entries point at the flagless launcher, so under the new "no flag
 * = open the editor" rule they would pop the editor at every login. Add the
 * flag once; naturally idempotent (the patched Exec already carries it, so the
 * next run is a no-op) so no extra persisted flag is needed.
 *
 * The flag is appended to the launcher's Exec line IN PLACE, leaving every other
 * key untouched. A full regenerate would discard out-of-band edits and, worse,
 * silently re-enable a disabled entry: the desktop's autostart settings disable
 * an entry by setting X-GNOME-Autostart-enabled=false / Hidden=true rather than
 * removing the file, so flipping it back to the canonical form would override
 * the user. A missing file (autostart off) and a dev run with no launcher are
 * both skipped. Best-effort, off the critical path.
 */
export async function migrateAutostartExecFlag(): Promise<void> {
  if (!(await launcherInstalled())) return;
  let content: string;
  try {
    content = await fs.readFile(autostartFile(), 'utf8');
  } catch {
    return; // no entry: autostart is off, nothing to migrate
  }
  if (content.includes(BACKGROUND_FLAG)) return; // already migrated

  const launcher = launcherPath();
  let patched = false;
  const lines = content.split('\n').map((line) => {
    if (!patched && line.startsWith('Exec=') && line.includes(launcher)) {
      patched = true;
      return `${line} ${BACKGROUND_FLAG}`;
    }
    return line;
  });
  if (!patched) return; // no launcher Exec line: not ours to touch

  try {
    await fs.writeFile(autostartFile(), lines.join('\n'), 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autostart] failed to migrate the autostart entry:', err);
  }
}
