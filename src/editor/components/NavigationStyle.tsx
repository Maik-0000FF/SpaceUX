// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo } from 'react';

import { resolveNavigation } from '@/shared/menu';
import { NAVIGATION_PRESETS, matchNavigationPreset } from '@/shared/navigation-presets';
import { formatPluginKey } from '@/shared/plugin-key';

import { useMenuSettings } from '../state/menu-settings';
import { usePluginsState } from '../state/plugins';
import { PICKER_TOOLTIPS } from '../tooltips';

import { Tooltip } from './Tooltip';
import styles from './NavigationStyle.module.scss';

/**
 * Navigation-style quick-pick (#160), shown in the preview design bar next
 * to the pie it drives. Picking a style applies a whole coherent set of
 * navigation gestures in one go; the user then refines the individual
 * bindings (aim, deadzone, gestures) in the Properties "Navigation" section.
 * Once those no longer match any preset the dropdown reads "Custom".
 *
 * Applies only the `navigation` block; the detail editor lives in the
 * sidebar, this is the quick starting point beside the preview.
 *
 * Plugin-contributed presets (#195) are merged into the dropdown after the
 * built-ins, in install order. Their dropdown ids are namespaced
 * (`<pluginId>/<presetId>`), so two plugins shipping a preset called "twist"
 * stay distinguishable and a built-in id can never be shadowed.
 */
export function NavigationStyle() {
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const hasConfig = useMenuSettings((s) => s.config !== null);
  const pluginPlugins = usePluginsState((s) => s.plugins);
  const ensurePluginsLoaded = usePluginsState((s) => s.ensureLoaded);

  // Pull installed plugins once on mount so the dropdown lists any nav-style
  // presets a freshly imported plugin contributed. PluginManager pushes the
  // store back to date on import/uninstall, so we don't poll here.
  useEffect(() => {
    void ensurePluginsLoaded();
  }, [ensurePluginsLoaded]);

  // Flatten every nav-style plugin's contributed presets into one merged
  // list, each tagged with its namespaced dropdown key so the matcher and
  // the `onChange` lookup speak the same id.
  const pluginPresets = useMemo(
    () =>
      pluginPlugins.flatMap((p) =>
        p.kind === 'nav-style' && p.navStylePresets
          ? p.navStylePresets.map((preset) => ({
              key: formatPluginKey(p.id, preset.id),
              pluginName: p.name,
              label: preset.label,
              description: preset.description,
              navigation: preset.navigation,
            }))
          : [],
      ),
    [pluginPlugins],
  );

  const nav = resolveNavigation({ navigation });
  const styleId = matchNavigationPreset(
    nav,
    pluginPresets.map((p) => ({ id: p.key, navigation: p.navigation })),
  );
  const builtInCurrent = NAVIGATION_PRESETS.find((p) => p.id === styleId);
  const pluginCurrent = pluginPresets.find((p) => p.key === styleId);
  const currentDescription =
    builtInCurrent?.description ??
    pluginCurrent?.description ??
    'Your own combination of navigation gestures.';

  return (
    <label className={styles.control}>
      <Tooltip content={PICKER_TOOLTIPS.navStyle}>
        <span className={styles.label}>Navigation style</span>
      </Tooltip>
      <Tooltip content={currentDescription}>
        <select
          className={styles.select}
          value={styleId ?? 'custom'}
          disabled={!hasConfig}
          onChange={(e) => {
            const builtIn = NAVIGATION_PRESETS.find((p) => p.id === e.target.value);
            if (builtIn) {
              setNavigation(structuredClone(builtIn.navigation));
              return;
            }
            const fromPlugin = pluginPresets.find((p) => p.key === e.target.value);
            if (fromPlugin) setNavigation(structuredClone(fromPlugin.navigation));
            // Selecting "Custom" is a no-op; it only reflects edited bindings.
          }}
        >
          {/* "Custom" only appears while the bindings match no preset, so it's
            shown as the current selection rather than offered as a choice. */}
          {styleId === null && <option value="custom">Custom</option>}
          {NAVIGATION_PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.label}
            </option>
          ))}
          {pluginPresets.length > 0 && (
            <optgroup label="From plugins">
              {pluginPresets.map((p) => (
                <option key={p.key} value={p.key} title={p.description}>
                  {/* Append the source plugin's name when it adds information
                    (two plugins can ship a preset called "twist"). Suppress
                    when the plugin and the preset share a label, which is
                    the common single-preset-per-plugin case where the suffix
                    would just duplicate the line. */}
                  {p.pluginName && p.pluginName !== p.label
                    ? `${p.label} · ${p.pluginName}`
                    : p.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Tooltip>
    </label>
  );
}
