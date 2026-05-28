// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo } from 'react';

import { usePieAppearance } from '../hooks/usePieAppearance';
import { usePluginsState } from '../state/plugins';

import styles from './PieShapeSelect.module.scss';

/** The dropdown value for "Wedge (built-in default)". Kept distinct from
 *  any plugin-contributed id (those are namespaced `<pluginId>/<shapeId>`,
 *  which can't collide with this literal because a manifest id can't be
 *  the empty string). */
const WEDGE_VALUE = '';

/** Namespace a plugin's shape id (#107). The reverse-DNS plugin id plus
 *  the in-plugin shape id, joined by `/`, mirrors the action / nav-style
 *  preset conventions. Pure formatter so the picker, the appearance
 *  resolver, and the runtime store can all agree on one literal. */
function shapeKey(pluginId: string, shapeId: string): string {
  return `${pluginId}/${shapeId}`;
}

/**
 * Pie shape model quick-pick for the preview design bar (#107). Lists the
 * built-in wedge plus every installed shape plugin's contributed shape.
 * Selecting a value writes it to `PieAppearance.shapeModel`; `null` (the
 * wedge default) means "render via the unchanged wedge code path".
 *
 * Mirrors `PieThemeSelect` in shape so the design bar's selectors line up
 * visually. Plugin-state hydration is shared (`usePluginsState` is the
 * single source the Plugin Manager already populates), so a freshly
 * imported plugin shows up here without polling.
 */
export function PieShapeSelect() {
  const { appearance, setShapeModel } = usePieAppearance();
  const plugins = usePluginsState((s) => s.plugins);
  const ensureLoaded = usePluginsState((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  // Flatten every shape plugin's contributed descriptor into one merged
  // list, tagged with the namespaced dropdown key. Plugin name carried
  // alongside for disambiguation when two plugins ship the same shape
  // label (same pattern as NavigationStyle).
  const pluginShapes = useMemo(
    () =>
      plugins.flatMap((p) =>
        p.kind === 'shape' && p.shape
          ? [
              {
                key: shapeKey(p.id, p.shape.id),
                pluginName: p.name,
                label: p.shape.label,
                description: p.shape.description,
              },
            ]
          : [],
      ),
    [plugins],
  );

  const value = appearance.shapeModel ?? WEDGE_VALUE;
  const currentPlugin = pluginShapes.find((s) => s.key === value);
  const isUnknown = value !== WEDGE_VALUE && currentPlugin === undefined;
  // Tooltip walks the three states: orphan reference (plugin gone),
  // active plugin (its own description), or wedge default. The orphan
  // message has to acknowledge the broken reference explicitly — the
  // generic "rendering as wedge" text would imply the user picked wedge
  // when in fact they picked something the host can no longer resolve.
  const title = isUnknown
    ? `Plugin not installed: ${value}. The pie renders as wedge until you install it.`
    : (currentPlugin?.description ?? 'Render the pie as the built-in wedge slices (default).');

  return (
    <label className={styles.control}>
      <span className={styles.label}>Shape</span>
      <select
        className={styles.select}
        value={value}
        title={title}
        onChange={(e) => {
          const next = e.target.value;
          setShapeModel(next === WEDGE_VALUE ? null : next);
        }}
      >
        <option value={WEDGE_VALUE}>Wedge (default)</option>
        {pluginShapes.length > 0 && (
          <optgroup label="From plugins">
            {pluginShapes.map((s) => (
              <option key={s.key} value={s.key}>
                {/* Suppress the plugin-name suffix when it duplicates the
                    shape label (the single-shape-per-plugin common case
                    where plugin.name === shape.label). */}
                {s.pluginName && s.pluginName !== s.label
                  ? `${s.label} · ${s.pluginName}`
                  : s.label}
              </option>
            ))}
          </optgroup>
        )}
        {/* If the saved appearance references a plugin that isn't
            installed (or its shape was renamed), show it as an
            "unknown" option so the picker doesn't silently switch the
            user back to wedge. Choosing wedge or another shape resolves
            the orphan. */}
        {isUnknown && (
          <option value={value} disabled>
            (unknown: {value})
          </option>
        )}
      </select>
    </label>
  );
}
