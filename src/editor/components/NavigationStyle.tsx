// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { resolveNavigation } from '@/shared/menu';
import { NAVIGATION_PRESETS, matchNavigationPreset } from '@/shared/navigation-presets';

import { useMenuSettings } from '../state/menu-settings';

import styles from './NavigationStyle.module.scss';

/**
 * Navigation-style quick-pick (#160), shown in the preview design bar next
 * to the pie it drives. Picking a style applies a whole coherent set of
 * navigation gestures in one go; the user then refines the individual
 * bindings (aim, deadzone, gestures) in the Properties "Navigation" section.
 * Once those no longer match any preset the dropdown reads "Custom".
 *
 * Applies only the `navigation` block — the detail editor lives in the
 * sidebar, this is the quick starting point beside the preview.
 */
export function NavigationStyle() {
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const hasConfig = useMenuSettings((s) => s.config !== null);
  const nav = resolveNavigation({ navigation });
  const styleId = matchNavigationPreset(nav);
  const current = NAVIGATION_PRESETS.find((p) => p.id === styleId);

  return (
    <label className={styles.control}>
      <span className={styles.label}>Navigation style</span>
      <select
        className={styles.select}
        value={styleId ?? 'custom'}
        disabled={!hasConfig}
        title={current?.description ?? 'Your own combination of navigation gestures.'}
        onChange={(e) => {
          const preset = NAVIGATION_PRESETS.find((p) => p.id === e.target.value);
          // Selecting "Custom" is a no-op — it only reflects edited bindings.
          if (preset) setNavigation(structuredClone(preset.navigation));
        }}
      >
        {/* "Custom" only appears while the bindings match no preset, so it's
            shown as the current selection rather than offered as a choice. */}
        {styleId === null && <option value="custom">Custom</option>}
        {NAVIGATION_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
