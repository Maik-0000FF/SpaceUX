// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import type { HostEnvironment } from '../shared/plugin-types.js';

/**
 * Resolve an icon *name* (as a `.desktop` `Icon=` or a `xdg-mime` icon name
 * gives it) to an icon *file* on disk, following the freedesktop Icon Theme
 * Spec: the active theme, the themes it inherits, then `hicolor`, then the
 * legacy pixmaps dir. The mechanism is the same on every distro; only the
 * active theme and how to read it vary by desktop (#386), handled best-effort
 * with a `hicolor` fallback so an unknown desktop still resolves common icons.
 *
 * Returns a path to an `.svg`/`.png` we can encode, or null when nothing
 * matches (the caller then leaves the icon unset). An absolute `Icon=` is used
 * directly. The pure parsing helpers are split out so they're unit-testable
 * without a real icon tree; `resolveIconFile` is the IO entry point.
 */

/** Extensions we can encode, in preference order (scalable vector first). */
const ENCODABLE_EXTS = ['svg', 'png'] as const;

/** Parse a theme's `index.theme`: the `Directories=` it lists (each a relative
 *  subdir like `apps/48` or `48x48/apps` or `scalable/apps`, the layout varies
 *  per theme, which is exactly why it's read rather than guessed) and the
 *  themes it `Inherits=`. Both are comma-separated in the `[Icon Theme]`
 *  section; absent keys yield []. */
export function parseThemeIndex(content: string): { directories: string[]; inherits: string[] } {
  const field = (key: string): string[] => {
    // Match at line start to avoid catching a key inside a [dir] section.
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m
      ? m[1]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  };
  return { directories: field('Directories'), inherits: field('Inherits') };
}

/** Sort rank for a theme subdir, so the largest / scalable variant is tried
 *  first: `scalable` is best (vector), else the largest size integer embedded
 *  in the dir name (`apps/48` and `48x48/apps` both rank 48). */
export function dirSizeRank(dir: string): number {
  if (/scalable/i.test(dir)) return Number.POSITIVE_INFINITY;
  const sizes = dir.match(/\d+/g);
  return sizes ? Math.max(...sizes.map(Number)) : 0;
}

/** Icon-theme base dirs, most specific first: the per-user dirs, then each
 *  `$XDG_DATA_DIRS/icons` (defaulting to the spec's `/usr/local/share` +
 *  `/usr/share`). The legacy `/usr/share/pixmaps` is searched separately. */
function iconBaseDirs(env: NodeJS.ProcessEnv): string[] {
  const home = homedir();
  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [join(dataHome, 'icons'), join(home, '.icons'), ...dataDirs.map((d) => join(d, 'icons'))];
}

/** Best-effort name of the active icon theme. KDE keeps it in kdeglobals;
 *  GNOME-family desktops expose it via gsettings; bare wlroots compositors
 *  (Wayland shells like noctalia on mango, sway, Hyprland) have neither, but
 *  the icon theme is still configured GTK-style in gtk-3.0/gtk-4.0 settings.ini,
 *  so that is read too. Null when none answer, in which case the chain still
 *  falls back to hicolor. Ordered by the detected desktop (#386) so the likely
 *  source is tried first. */
function detectIconThemeName(host: HostEnvironment, env: NodeJS.ProcessEnv): string | null {
  const configHome = (): string => env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const fromKde = (): string | null => {
    try {
      const cfg = join(configHome(), 'kdeglobals');
      const m = existsSync(cfg)
        ? readFileSync(cfg, 'utf8').match(/^\[Icons\][^[]*?^Theme=(.+)$/m)
        : null;
      return m ? m[1]!.trim() : null;
    } catch {
      return null;
    }
  };
  const fromGsettings = (): string | null => {
    try {
      const out = execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'icon-theme'], {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const name = out.trim().replace(/^'(.*)'$/, '$1');
      return name || null;
    } catch {
      return null;
    }
  };
  // GTK settings.ini: `gtk-icon-theme-name=<name>` under [Settings]. The
  // standard place an icon theme is set on a bare wlroots session with no DE.
  const fromGtk = (): string | null => {
    for (const ver of ['gtk-3.0', 'gtk-4.0']) {
      try {
        const cfg = join(configHome(), ver, 'settings.ini');
        if (!existsSync(cfg)) continue;
        const m = readFileSync(cfg, 'utf8').match(/^\s*gtk-icon-theme-name\s*=\s*(.+)$/m);
        const name = m ? m[1]!.trim() : '';
        if (name) return name;
      } catch {
        // Unreadable settings.ini, try the next GTK version / source.
      }
    }
    return null;
  };
  const order =
    host.desktop === 'kde' ? [fromKde, fromGsettings, fromGtk] : [fromGsettings, fromGtk, fromKde];
  for (const probe of order) {
    const name = probe();
    if (name) return name;
  }
  return null;
}

/** Every icon theme actually installed under the base dirs (a subdir with an
 *  index.theme that declares icon `Directories=`), discovered from disk rather
 *  than hard-coded. This is the universal fallback for a session with no
 *  configured theme at all (a bare wlroots compositor without KDE/GNOME/GTK
 *  settings): without it the chain would collapse to the sparse hicolor and
 *  named icons (audio-volume-high, ...) would go missing. The `Directories=`
 *  filter skips cursor-only themes (they declare no icon dirs). Deterministic
 *  order (base-dir order, then name) so the result is stable; hicolor is added
 *  separately by the chain and excluded here. */
function discoverInstalledThemes(baseDirs: string[]): string[] {
  const names = new Set<string>();
  for (const base of baseDirs) {
    let entries: string[];
    try {
      entries = readdirSync(base).sort();
    } catch {
      continue; // base dir absent / unreadable
    }
    for (const name of entries) {
      if (name === 'hicolor' || names.has(name)) continue;
      const idx = join(base, name, 'index.theme');
      if (!existsSync(idx)) continue;
      try {
        if (parseThemeIndex(readFileSync(idx, 'utf8')).directories.length > 0) names.add(name);
      } catch {
        // Unreadable index.theme, skip this theme.
      }
    }
  }
  return [...names];
}

/** Build the theme lookup chain: the active theme, the themes it inherits
 *  (depth-first, deduped), then hicolor (the spec's universal fallback), then
 *  every other installed theme as a last resort. Reads each theme's index.theme
 *  to follow `Inherits=`. The configured theme + hicolor are tried first, so the
 *  installed-theme tail only fills gaps and never changes an icon that already
 *  resolved (no regression); it just lets a system with no configured theme
 *  still resolve icons from whatever is installed. */
function themeChain(themeName: string | null, baseDirs: string[]): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  const visit = (theme: string | null): void => {
    if (!theme || seen.has(theme)) return;
    seen.add(theme);
    chain.push(theme);
    for (const base of baseDirs) {
      const idx = join(base, theme, 'index.theme');
      if (existsSync(idx)) {
        try {
          parseThemeIndex(readFileSync(idx, 'utf8')).inherits.forEach(visit);
        } catch {
          // Unreadable index.theme, skip its inheritance but keep the chain.
        }
        break;
      }
    }
  };
  visit(themeName);
  visit('hicolor');
  for (const theme of discoverInstalledThemes(baseDirs)) visit(theme);
  return chain;
}

/** Session cache of the detected theme chain + base dirs: the active theme and
 *  what it inherits don't change within a run, and detection spawns gsettings /
 *  reads kdeglobals, so it's resolved once rather than per icon (#390). */
let chainCache: { baseDirs: string[]; ordered: { theme: string; dirs: string[] }[] } | null = null;

/** A theme's `Directories=`, sorted largest/scalable first, cached per
 *  (base, theme) so a multi-icon resolve doesn't re-read the same index.theme.
 *  null = no index.theme in that base dir for that theme. */
const themeDirsCache = new Map<string, string[] | null>();

function themeDirectories(base: string, theme: string): string[] | null {
  const key = `${base}\n${theme}`;
  const cached = themeDirsCache.get(key);
  if (cached !== undefined) return cached;
  const idx = join(base, theme, 'index.theme');
  let dirs: string[] | null = null;
  if (existsSync(idx)) {
    try {
      dirs = [...parseThemeIndex(readFileSync(idx, 'utf8')).directories].sort(
        (a, b) => dirSizeRank(b) - dirSizeRank(a),
      );
    } catch {
      dirs = null;
    }
  }
  themeDirsCache.set(key, dirs);
  return dirs;
}

/** The (theme, dirs) lookup order for this session, built once. */
function iconLookup(host: HostEnvironment): {
  baseDirs: string[];
  ordered: { theme: string; dirs: string[] }[];
} {
  if (chainCache) return chainCache;
  const baseDirs = iconBaseDirs(process.env);
  const ordered: { theme: string; dirs: string[] }[] = [];
  for (const theme of themeChain(detectIconThemeName(host, process.env), baseDirs)) {
    // A theme's `Directories=` list is a property of the theme, not of one base
    // dir: per the spec a theme's data may be spread across base dirs, so union
    // the `Directories=` declared by every base that defines an index.theme for
    // it (a base may ship a partial index.theme), then re-sort the merged list
    // largest/scalable first. The icons themselves can live under any base that
    // has the theme, not only the one carrying the index.theme (e.g. a program
    // installed to /usr/local puts its icon in /usr/local/share/icons/hicolor
    // while only /usr/share/icons/hicolor has the index.theme). Probe the shared
    // dir list under every base that has the theme, most-specific first, so a
    // per-user override still wins.
    const dirSet = new Set<string>();
    for (const base of baseDirs) {
      const found = themeDirectories(base, theme);
      if (found) for (const dir of found) dirSet.add(dir);
    }
    if (dirSet.size === 0) continue;
    const dirs = [...dirSet].sort((a, b) => dirSizeRank(b) - dirSizeRank(a));
    for (const base of baseDirs) {
      if (existsSync(join(base, theme))) ordered.push({ theme: join(base, theme), dirs });
    }
  }
  chainCache = { baseDirs, ordered };
  return chainCache;
}

/**
 * Resolve an icon name (or absolute path) to an encodable icon file, or null.
 * Walks the active theme, its inherited themes, hicolor, then pixmaps. The
 * theme chain + directory lists are detected once per session and cached, so a
 * batch of resolves doesn't re-spawn gsettings or re-read index.theme.
 */
export function resolveIconFile(name: string, host: HostEnvironment): string | null {
  if (!name) return null;
  if (isAbsolute(name)) return existsSync(name) ? name : null;

  for (const { theme, dirs } of iconLookup(host).ordered) {
    for (const dir of dirs) {
      for (const ext of ENCODABLE_EXTS) {
        const file = join(theme, dir, `${name}.${ext}`);
        if (existsSync(file)) return file;
      }
    }
  }
  // Legacy flat pixmaps dir (no theme structure).
  for (const ext of ENCODABLE_EXTS) {
    const file = join('/usr/share/pixmaps', `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}
