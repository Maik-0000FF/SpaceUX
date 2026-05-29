// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { resolveShapeModel, type MenuConfig, type MenuNode } from '../shared/menu.js';
import { type PieAppearance, type PluginCategory, type PluginUsageReport } from '../shared/ipc.js';

/**
 * Scan saved menu configs + the global appearance for references to a
 * specific plugin (#265). The renderer's Plugin Manager runs this before a
 * Remove and shows the affected menus in the confirm dialog so the user sees
 * the consequence (which menus fall back to the host default after the
 * uninstall) up-front, without rewriting any saved state.
 *
 * Per kind:
 *   - `shape`: a menu uses the plugin iff its `shapeModel` is the namespace
 *     key `<pluginId>/<shapeId>`. The global appearance points at the
 *     plugin iff `appearance.shapeModel` is too.
 *   - `function`: a menu uses the plugin iff any node in its tree carries an
 *     `action.id` that starts with `<pluginId>/`.
 *   - `nav-style`: skipped today. A nav-style plugin contributes a preset
 *     bundle; once applied to a menu the user typically tweaks the gestures,
 *     so the saved `navigation` block no longer matches the preset exactly,
 *     making "uses this preset" unreliable to detect after the fact. Track
 *     when the picker grows preset-id provenance (a saved id alongside the
 *     gesture block) before turning this on.
 *   - `theme`: skipped today. The theme plugin contract (#47) has not
 *     shipped, so there's no `appearance.theme` field to scan yet. Add the
 *     `<pluginId>/<themeId>` check here when the field lands.
 *
 * Pure / no IO: the caller assembles the list of `MenuRef`s (loading
 * profiles, the global menu, workbench-curated pies) and passes them in
 * along with the current global appearance. That keeps the scanner
 * unit-testable without the filesystem.
 */
export type MenuRef = {
  /** Human-readable label for the report (e.g. "Device profile 256f:c652"). */
  name: string;
  config: MenuConfig;
  /** The appearance that effectively applies to this menu. For a device
   *  profile with a bundled appearance (#113) it's that bundle; otherwise
   *  it's the global app-level appearance. Used to resolve the per-menu
   *  shape model when `config.shapeModel` is `undefined` (inherit). */
  appearance: PieAppearance;
};

/** True iff any node in the (sub)tree carries an action id starting with
 *  `<prefix>` (i.e. namespaced under the target plugin). */
function treeHasPluginAction(node: MenuNode, prefix: string): boolean {
  if (node.action !== undefined && node.action.id.startsWith(prefix)) return true;
  if (node.branches !== undefined) {
    for (const child of node.branches) {
      if (treeHasPluginAction(child, prefix)) return true;
    }
  }
  return false;
}

export function scanPluginUsage(
  pluginId: string,
  kind: PluginCategory,
  menus: readonly MenuRef[],
  globalAppearance: PieAppearance,
): PluginUsageReport {
  const report: PluginUsageReport = { menus: [], globalAppearance: false };
  const prefix = `${pluginId}/`;

  if (kind === 'shape') {
    for (const m of menus) {
      // Use the same resolver the renderer uses, so a menu with
      // `shapeModel: undefined` (inherit) under a profile-bundled
      // appearance that targets the plugin still gets caught — and stays
      // bit-equivalent to the runtime path if the precedence ever evolves.
      const effective = resolveShapeModel(m.config.shapeModel, m.appearance.shapeModel);
      if (typeof effective === 'string' && effective.startsWith(prefix)) {
        report.menus.push(m.name);
      }
    }
    if (
      typeof globalAppearance.shapeModel === 'string' &&
      globalAppearance.shapeModel.startsWith(prefix)
    ) {
      report.globalAppearance = true;
    }
  } else if (kind === 'function') {
    for (const m of menus) {
      if (treeHasPluginAction(m.config.root, prefix)) {
        report.menus.push(m.name);
      }
    }
  }
  // nav-style and theme: see the module doc; no detection today.

  return report;
}
