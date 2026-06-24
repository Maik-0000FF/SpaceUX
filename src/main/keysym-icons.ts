// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Media / function keysym -> { icon name, short label } map (#511).
 *
 * A key combination is neither a program nor a file, so there is nothing to
 * derive an icon or name from the way exec/open-file targets do. There is also
 * no OS or freedesktop database that maps an `XF86*` keysym to an icon or a
 * label, and neither is algorithmically derivable. So, like the keysym ->
 * keycode table in `keycodes.ts`, this is a small curated reference table with a
 * documented source: the icon names are from the freedesktop Icon Naming
 * Specification (Status `audio-volume-*`, Actions `media-*`), which every icon
 * theme implements; the labels are the short, conventional English names for
 * those keys. Only the names are curated here, the actual image is resolved from
 * the active icon theme at runtime (see `resolveIconFile`), nothing is bundled.
 *
 * Keys are stored lowercase; lookups lowercase first, so case in the user's
 * config doesn't matter (matching `keycodes.ts`). A keysym with no confident,
 * widely-shipped icon is omitted rather than guessed: it simply gets no auto
 * fill. The brightness / mic entries are outside the spec proper but resolve in
 * the common themes (Breeze, Adwaita); where a theme lacks one, the resolver
 * returns null for the icon while the label still applies. Adding more is one
 * line each.
 */
export type KeyComboFill = { icon: string; label: string };

export const KEY_COMBO_FILL: Record<string, KeyComboFill> = {
  // Volume (freedesktop Status icons).
  xf86audiomute: { icon: 'audio-volume-muted', label: 'Mute' },
  xf86audioraisevolume: { icon: 'audio-volume-high', label: 'Volume up' },
  xf86audiolowervolume: { icon: 'audio-volume-low', label: 'Volume down' },
  // Microphone (GNOME/Breeze; outside the core spec).
  xf86audiomicmute: { icon: 'microphone-sensitivity-muted', label: 'Mic mute' },
  // Playback (freedesktop Action icons).
  xf86audioplay: { icon: 'media-playback-start', label: 'Play' },
  xf86audiopause: { icon: 'media-playback-pause', label: 'Pause' },
  xf86audiostop: { icon: 'media-playback-stop', label: 'Stop' },
  xf86audionext: { icon: 'media-skip-forward', label: 'Next' },
  xf86audioprev: { icon: 'media-skip-backward', label: 'Previous' },
  // Display brightness (Breeze/Adwaita; outside the core spec).
  xf86monbrightnessup: { icon: 'display-brightness-high', label: 'Brightness up' },
  xf86monbrightnessdown: { icon: 'display-brightness-low', label: 'Brightness down' },
};

/**
 * The icon name + short label a key chord should wear, or null. Scans the
 * chord's tokens (split on `+`, the same separator the chord parser uses) for
 * the first recognised media/function keysym; a plain shortcut like `alt+Tab`
 * matches nothing and returns null. Case-insensitive, mirroring the chord parser.
 */
export function keyComboFill(keys: string): KeyComboFill | null {
  for (const token of keys.split('+')) {
    const fill = KEY_COMBO_FILL[token.trim().toLowerCase()];
    if (fill) return fill;
  }
  return null;
}
