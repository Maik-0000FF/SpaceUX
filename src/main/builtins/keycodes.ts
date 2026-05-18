// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Symbolic key-name → Linux keycode map.
 *
 * Keycodes come straight from `<linux/input-event-codes.h>` — the same
 * numbers the kernel uses on the wire. ydotool's key subcommand
 * expects this numeric form ("56:1 15:1 15:0 56:0" for Alt+Tab) which
 * is friendlier to look up than every Wayland compositor's quirky
 * keysym dialect.
 *
 * Names are stored lowercase; lookups must lowercase first so case
 * in the user's config doesn't matter ("Alt+Tab", "alt+tab",
 * "ALT+TAB" all resolve to the same chord).
 *
 * The table covers the keys our default menu config uses plus the
 * common shortcut surface. Adding more is one line each.
 */
export const KEY_CODES: Record<string, number> = {
  // Modifiers. Each spelling resolves to the LEFT variant of the
  // chord-style modifier — the right-side variants are rarely
  // distinguished by user-facing shortcuts.
  ctrl: 29,
  control: 29,
  shift: 42,
  alt: 56,
  super: 125,
  meta: 125,
  win: 125,
  cmd: 125,

  // Whitespace / control keys
  tab: 15,
  enter: 28,
  return: 28,
  esc: 1,
  escape: 1,
  space: 57,
  backspace: 14,
  insert: 110,
  delete: 111,

  // Navigation
  left: 105,
  right: 106,
  up: 103,
  down: 108,
  home: 102,
  end: 107,
  pageup: 104,
  pagedown: 109,

  // Letters (the kernel uses the QWERTY physical-layout order, not
  // alphabetical — Q starts at 16, A at 30, Z at 44).
  q: 16,
  w: 17,
  e: 18,
  r: 19,
  t: 20,
  y: 21,
  u: 22,
  i: 23,
  o: 24,
  p: 25,
  a: 30,
  s: 31,
  d: 32,
  f: 33,
  g: 34,
  h: 35,
  j: 36,
  k: 37,
  l: 38,
  z: 44,
  x: 45,
  c: 46,
  v: 47,
  b: 48,
  n: 49,
  m: 50,

  // Function keys F1..F12
  f1: 59,
  f2: 60,
  f3: 61,
  f4: 62,
  f5: 63,
  f6: 64,
  f7: 65,
  f8: 66,
  f9: 67,
  f10: 68,
  f11: 87,
  f12: 88,

  // Media keys. XF86… spellings match X11 / GTK convention so a user
  // copying a shortcut out of their KDE keyboard editor pastes
  // without translation.
  xf86audiomute: 113,
  xf86audiolowervolume: 114,
  xf86audioraisevolume: 115,
  xf86audioplay: 164,
  xf86audiostop: 166,
  xf86audionext: 163,
  xf86audioprev: 165,
};

/**
 * Parse a chord specifier like "alt+Tab" or "Ctrl+Shift+S" into the
 * Linux keycodes the ydotool backend needs. The last token is the
 * end key; everything before it is treated as a modifier. Returns
 * null when any token is unknown so callers can refuse to fire a
 * partial chord. */
export function parseChord(spec: string): { modifiers: number[]; key: number } | null {
  const tokens = spec
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const codes: number[] = [];
  for (const t of tokens) {
    const code = KEY_CODES[t];
    if (code === undefined) return null;
    codes.push(code);
  }
  const key = codes[codes.length - 1];
  if (key === undefined) return null;
  return {
    modifiers: codes.slice(0, -1),
    key,
  };
}
