// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_MENU_CONFIG, type MenuConfig, type MenuNode } from '../shared/menu.js';
import type { HostEnvironment } from '../shared/plugin-types.js';

import { encodeIconFile } from './icon-encode.js';
import { resolveIconFile } from './icon-theme.js';

/**
 * First-run icons for the showcase default menu (pre-alpha). The structural
 * default lives in `DEFAULT_MENU_CONFIG` (shared, icon-free, the validator
 * baseline); this main-side layer attaches icons resolved from the user's icon
 * theme at startup, using the very pipeline the editor's auto-icon uses
 * (`resolveIconFile` -> `encodeIconFile`). A node whose icon name the theme
 * doesn't carry just stays label-only, so a sparse theme degrades gracefully
 * and never errors.
 *
 * Keyed by the node's label, which is enough for this small fixed default (all
 * labels are unique). The keys MUST match `DEFAULT_MENU_CONFIG` exactly,
 * including the U+2212 minus in "Volume −"; the default-menu test guards that.
 */
const DEFAULT_ICON_NAMES: Readonly<Record<string, string>> = {
  'Switch Window': 'preferences-system-windows',
  Sound: 'multimedia-volume-control',
  'Volume +': 'audio-volume-high',
  Mute: 'audio-volume-muted',
  'Volume −': 'audio-volume-low',
  'Show Desktop': 'user-desktop',
};

async function resolveIconDataUri(
  name: string,
  host: HostEnvironment,
): Promise<string | undefined> {
  const file = resolveIconFile(name, host);
  if (!file) return undefined;
  const encoded = await encodeIconFile(file);
  return encoded.ok ? encoded.dataUri : undefined;
}

async function enrichNode(node: MenuNode, host: HostEnvironment): Promise<MenuNode> {
  const iconName = DEFAULT_ICON_NAMES[node.label];
  const icon = iconName ? await resolveIconDataUri(iconName, host) : undefined;
  const branches = node.branches
    ? await Promise.all(node.branches.map((child) => enrichNode(child, host)))
    : undefined;
  return {
    ...node,
    ...(icon !== undefined ? { icon } : {}),
    ...(branches !== undefined ? { branches } : {}),
  };
}

/**
 * The default menu with theme icons attached, for use as the first-run / no-
 * config fallback. Resolve once at startup (icon-theme lookups are cached per
 * session, #390) and thread the result into the fallback sites that otherwise
 * use the raw `DEFAULT_MENU_CONFIG`. `centerIconFile` is the bundled wave icon
 * shown in the centre (see {@link applyCenterIcon}).
 */
export async function buildDefaultMenu(
  host: HostEnvironment,
  centerIconFile?: string,
): Promise<MenuConfig> {
  const root = await enrichNode(DEFAULT_MENU_CONFIG.root, host);
  const centered = await applyCenterIcon(root, centerIconFile);
  return { ...DEFAULT_MENU_CONFIG, root: centered };
}

/**
 * Show the bundled wave as a crisp vector centre instead of the structural
 * default's 👋 text glyph (#403): Qt's QSvgRenderer falls back to a system
 * emoji font with smaller metrics than the browser, so the overlay's centre
 * emoji rendered smaller than the preview. Routed through the pie's node-icon
 * vector-flatten path, it renders identically in both. `centerIconFile` is the
 * bundled asset, passed in so this module stays free of the packaging-aware
 * path helper (and thus testable in isolation); a missing/unreadable file
 * degrades gracefully to the original emoji label.
 */
async function applyCenterIcon(root: MenuNode, centerIconFile?: string): Promise<MenuNode> {
  if (!centerIconFile) return root;
  const encoded = await encodeIconFile(centerIconFile);
  if (!encoded.ok) return root;
  // Clear the label so the centre shows the wave alone (icon + label would stack).
  return { ...root, icon: encoded.dataUri, label: '' };
}
