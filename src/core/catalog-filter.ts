// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { isRenderableIcon } from './icon.js';
import type { PluginCatalogGroup } from '../shared/plugin-types.js';

// PaletteCommand / PaletteGroup live in shared/context-ui.ts (the dependency
// leaf, so the contract can carry them).
import type { PaletteGroup } from '../shared/context-ui.js';

/**
 * The pure transform behind the command palette (#76 D2 / #208 / #217): turn the
 * raw catalog groups into the flat, filtered list the UI renders.
 *
 * Per group it:
 *  - keeps only the scoped group when `scopeKey` is set (else all groups),
 *  - flattens toolbars into one list and **expands command groups** into their
 *    members (#208) — the group node itself isn't runnable, its members are,
 *  - drops entries missing a command/label,
 *  - applies the "currently usable" filter (#217) when `enabledOnly`: an entry
 *    survives unless `enabled === false`, so an unknown/older-bridge `enabled`
 *    (undefined) is treated as usable and nothing vanishes unexpectedly,
 *  - matches the (lower-cased) `query` against the label,
 *  - keeps only renderable icons,
 *  - and drops a group left with no commands.
 *
 * Kept side-effect-free (no store / `window`) so it's unit-testable on its own.
 */
export function flattenCatalogCommands(
  groups: PluginCatalogGroup[],
  opts: { scopeKey: string | null; query: string; enabledOnly: boolean },
): PaletteGroup[] {
  const q = opts.query.trim().toLowerCase();
  return groups
    .filter((g) => opts.scopeKey === null || g.key === opts.scopeKey)
    .map((g) => ({
      key: g.key,
      name: g.name,
      commands: g.toolbars
        .flatMap((t) => t.commands)
        .flatMap((c) => (c.members && c.members.length ? c.members : [c]))
        .filter(
          (c) =>
            typeof c.command === 'string' && c.command && typeof c.label === 'string' && c.label,
        )
        .filter((c) => !opts.enabledOnly || c.enabled !== false)
        .filter((c) => q === '' || c.label.toLowerCase().includes(q))
        .map((c) => ({
          command: c.command,
          label: c.label,
          icon: c.icon && isRenderableIcon(c.icon) ? c.icon : undefined,
        })),
    }))
    .filter((g) => g.commands.length > 0);
}
