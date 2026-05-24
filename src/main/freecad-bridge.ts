// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describeError } from '../shared/errors.js';

/**
 * In-app installer for the FreeCAD bridge addon (#189).
 *
 * The bridge addon (the plugin's `freecad/` folder) must live in FreeCAD's
 * user `Mod/` directory, which is **version-specific** (FreeCAD 1.2 →
 * `~/.local/share/FreeCAD/v1-2/Mod/`) and packaging-specific. SpaceUX can't ask
 * FreeCAD (`getUserAppDataDir()`), so we resolve it from the filesystem: pick
 * the highest `vMAJOR-MINOR/` data dir, else the legacy unversioned layout.
 *
 * Flatpak/Snap are reported unsupported — the bridge's UNIX socket can't cross
 * the sandbox boundary, so installing there is a dead end.
 *
 * Pure path/IO logic so the resolution is unit-testable; main owns when to run
 * it and where the addon source is (the loaded plugin's `freecad/` dir).
 */

/** A `vMAJOR-MINOR` FreeCAD data-dir name (e.g. `v1-2`). */
const VERSION_DIR_RE = /^v(\d+)-(\d+)$/;

/** The subdir the addon is installed as under `Mod/`. */
const ADDON_NAME = 'SpaceUX';

export type ModDirResolution =
  | { ok: true; modDir: string; label: string }
  | { ok: false; reason: string; sandbox: boolean };

function isDir(p: string): boolean {
  try {
    return fsSync.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve FreeCAD's user `Mod/` directory by scanning the filesystem. Order:
 *   1. the highest versioned data dir — `<data>/FreeCAD/v<MAJ>-<MIN>/Mod`;
 *   2. the legacy unversioned `<data>/FreeCAD/Mod` (older FreeCAD);
 *   3. the very old `~/.FreeCAD/Mod`.
 * Returns the resolved Mod path (which may not exist yet — install creates it),
 * or a failure: a Flatpak/Snap install (`sandbox: true`, the socket can't reach
 * it) or no FreeCAD data dir at all.
 */
export function resolveFreecadModDir(
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): ModDirResolution {
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const base = path.join(dataHome, 'FreeCAD');

  // 1. Highest versioned dir (v1-2 > v1-1 > v0-21).
  let best: { major: number; minor: number; name: string } | null = null;
  let entries: string[] = [];
  try {
    entries = fsSync.readdirSync(base);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const m = VERSION_DIR_RE.exec(name);
    if (m === null || !isDir(path.join(base, name))) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (best === null || major > best.major || (major === best.major && minor > best.minor)) {
      best = { major, minor, name };
    }
  }
  if (best !== null)
    return { ok: true, modDir: path.join(base, best.name, 'Mod'), label: best.name };

  // 2./3. Legacy unversioned layouts.
  if (isDir(base)) return { ok: true, modDir: path.join(base, 'Mod'), label: 'unversioned' };
  const dotFreecad = path.join(home, '.FreeCAD');
  if (isDir(dotFreecad))
    return { ok: true, modDir: path.join(dotFreecad, 'Mod'), label: '~/.FreeCAD' };

  // Sandboxed installs: the socket can't cross the boundary, so the bridge
  // can't work there — report rather than install into a dead end.
  const sandboxed =
    isDir(path.join(home, '.var', 'app', 'org.freecad.FreeCAD')) ||
    isDir(path.join(home, 'snap', 'freecad'));
  if (sandboxed) {
    return {
      ok: false,
      sandbox: true,
      reason:
        "FreeCAD is installed as Flatpak/Snap — the bridge's socket can't cross the sandbox. Use a native or AppImage FreeCAD, or set it up manually.",
    };
  }
  return {
    ok: false,
    sandbox: false,
    reason: 'No FreeCAD user data directory found — install FreeCAD and run it once.',
  };
}

/** Whether the addon is installed in `modDir` (a `SpaceUX/` dir is present). */
export function bridgeInstalledAt(modDir: string): boolean {
  return isDir(path.join(modDir, ADDON_NAME));
}

/**
 * Copy the addon (`srcAddonDir` = the plugin's `freecad/`) to
 * `<modDir>/SpaceUX`, replacing any existing install (so a re-run updates it)
 * and skipping `__pycache__`. The Mod dir is created if missing.
 */
export async function installBridge(
  srcAddonDir: string,
  modDir: string,
): Promise<{ ok: true; dest: string } | { ok: false; reason: string }> {
  const dest = path.join(modDir, ADDON_NAME);
  // Guard the addon source up front so a misconfigured plugin (no bundled
  // freecad/ dir) gives a clear reason rather than a raw ENOENT from cp.
  if (!isDir(srcAddonDir)) {
    return { ok: false, reason: `bridge addon not found in the plugin (${srcAddonDir})` };
  }
  try {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(modDir, { recursive: true });
    await fs.cp(srcAddonDir, dest, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('__pycache__'),
    });
    return { ok: true, dest };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}

/** Remove the installed addon (`<modDir>/SpaceUX`). A missing dir is success. */
export async function uninstallBridge(
  modDir: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await fs.rm(path.join(modDir, ADDON_NAME), { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }
}
