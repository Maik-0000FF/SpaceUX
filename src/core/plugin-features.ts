// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginInfo } from '../shared/ipc.js';

/** A feature chip: its short label plus a tooltip explaining it. */
export type Feature = { label: string; tip: string };

/**
 * What a plugin brings, as labelled chips (#220): catalog / bridge / menu /
 * actions / nav-style presets / a shape model. Derived purely from the
 * already-loaded {@link PluginInfo} flags, so the plugin manager shows the
 * plugin's surface at a glance without the user installing it to find out.
 *
 * Returns them in a stable order (most "active" first: actions, then the
 * function integrations, then nav-style / shape). Empty for a plugin that
 * contributes nothing executable (e.g. a bare theme today).
 */
export function features(p: PluginInfo): Feature[] {
  const feats: Feature[] = [];
  // Label is the bare feature (uniform with Menu / Catalog / Bridge); the
  // count lives in the tooltip so the chip stays clean.
  if (p.actionCount > 0)
    feats.push({
      label: 'Actions',
      tip: `${p.actionCount} runnable action${p.actionCount === 1 ? '' : 's'} this plugin exposes for menu items.`,
    });
  if (p.hasMenu) feats.push({ label: 'Menu', tip: 'Ships a ready-made pie menu.' });
  if (p.hasCatalog)
    feats.push({
      label: 'Catalog',
      tip: 'Provides a live command catalog for the editor palette.',
    });
  if (p.hasBridge)
    feats.push({
      label: 'Bridge',
      tip: 'Ships a companion that installs into the host app (e.g. FreeCAD).',
    });
  if (p.navStylePresets?.length)
    feats.push({
      label: 'Presets',
      tip: `${p.navStylePresets.length} navigation-style preset${p.navStylePresets.length === 1 ? '' : 's'} it adds to the picker.`,
    });
  if (p.shape)
    feats.push({ label: `Shape: ${p.shape.label}`, tip: 'Contributes a pie shape model.' });
  return feats;
}
