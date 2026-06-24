// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Drop null / undefined entries from an array and de-duplicate while
 * keeping the first-seen order. Used by the XDG path resolvers
 * (menu config, plugin search) where each candidate path is either
 * pinned from an env var or null when the var isn't set, and the
 * first directory that contains a file wins.
 */
export function dedupPreserveOrder<T>(items: ReadonlyArray<T | null | undefined>): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (item === null || item === undefined) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
