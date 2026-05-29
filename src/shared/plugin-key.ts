// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The `<pluginId>/<itemId>` namespace key format that the editor uses for
 * saved plugin-contributed selections: a plugin's shape id, nav-style preset
 * id, action name, theme palette key, and any future plugin-namespaced item
 * id. The first `/` separates the two halves; itemIds may themselves contain
 * `/` (for nested item names), so the format is "split on the FIRST slash"
 * rather than "split on every slash".
 *
 * Both halves are charset-constrained by the manifest validator (see
 * `isSafePluginId` in plugin-types.ts), so a well-formed key always parses;
 * a key from a corrupted / pre-namespaced config that doesn't conform falls
 * back to whatever the caller treats as "no plugin selected".
 */

export function formatPluginKey(pluginId: string, itemId: string): string {
  return `${pluginId}/${itemId}`;
}

/** Split a saved namespace key into its plugin and item halves. Returns null
 *  if the key is empty, lacks a slash, has nothing before the first slash, or
 *  has nothing after it; any of those is a malformed key the caller should
 *  treat as "no plugin selected" (e.g. fall back to the host default). The
 *  itemId may itself contain `/` so a nested item name like `Sketcher/Line`
 *  stays intact. */
export function parsePluginKey(key: string): { pluginId: string; itemId: string } | null {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) return null;
  return { pluginId: key.slice(0, slash), itemId: key.slice(slash + 1) };
}
