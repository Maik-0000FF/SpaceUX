// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { PLUGIN_MENU_ID_PREFIX, isPluginMenuId, parseWorkbenchMenuId } from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useProfiles } from '../hooks/useProfiles';
import { useCatalog } from '../state/catalog';
import { confirm } from '../state/confirm';
import { notify } from '../state/toasts';
import { PROFILE_TOOLTIP } from '../tooltips';

import { Tooltip } from './Tooltip';
import styles from './ProfileControls.module.scss';

const AUTO = ''; // the <select> value standing for "Auto" (no override)
// Value for the disabled "set it in the plugin panel" hint option (#209). A
// sentinel that can't collide with AUTO, a device profile id, or a plugin menu
// id, so it's never the selected value; it only ever renders as a pointer.
const CATALOG_HINT = '__catalog_source_hint__';

/**
 * Toolbar control for per-device profiles (#113): pick which profile drives
 * the live config, save the current config as the connected device's
 * profile, or delete the active profile.
 *
 * The dropdown is the manual *override*: "Auto" lets the connected device
 * pick its own profile (or the menu.json fallback), while choosing a
 * specific profile force-loads it. The active profile (what auto actually
 * resolved to) is shown read-only by DeviceStatus.
 */
// A plugin-provided menu is selected with a `plugin:<id>` id; Save/Delete are
// device-profile operations and don't apply while one is active. The
// predicate is shared with main (src/shared/plugin-types).

export function ProfileControls() {
  const { ids, override, pluginMenus } = useProfiles();
  const device = useDeviceInfo();

  // The catalog plugin (FreeCAD) owns its Dynamic/Curated choice via the
  // FreecadSourceControls switch (#193), so drop its `plugin:` entry here to
  // avoid two competing source controls. While a FreeCAD source (its dynamic
  // menu or a curated `wb:` pie) is active, the override won't match any listed
  // option, so the disabled hint below doubles as the shown value and points at
  // that panel; the user switches FreeCAD modes there, Auto/profiles here.
  const catalogPlugin = useCatalog((s) => s.plugin);
  const catalogPluginId = catalogPlugin?.id ?? null;
  // The catalog plugin's own name (FreeCAD today), so the dropdown hint and the
  // panel it points at stay plugin-driven rather than hardcoding "FreeCAD". `||`
  // (not `??`) so a plugin with an empty name still falls back, not a label with
  // a leading space.
  const catalogPluginName = catalogPlugin?.name || 'Plugin';
  const dynamicId = catalogPluginId === null ? null : `${PLUGIN_MENU_ID_PREFIX}${catalogPluginId}`;
  const freecadActive =
    override !== null &&
    catalogPluginId !== null &&
    (override === dynamicId || parseWorkbenchMenuId(override)?.pluginId === catalogPluginId);
  const otherPluginMenus = pluginMenus.filter((m) => m.id !== dynamicId);

  const hasDevice = device.vendor !== 0 || device.product !== 0;
  const deviceLabel = device.name || 'this device';

  // Delete targets the *active* profile, so the connected device's
  // auto-resolved profile can be removed without first overriding to it.
  const activeProfile = device.profileId;

  const setOverride = (value: string): void => {
    void window.editor.setProfileOverride(value === AUTO ? null : value);
  };

  const save = (): void => {
    void window.editor.saveProfile().then((r) => {
      if (!r.ok) {
        notify('error', r.reason);
        return;
      }
      // Saving targets the connected device's profile. When an override is
      // active it isn't what's live, so say so — otherwise it just took
      // effect (Auto resolves to the device's own profile).
      notify(
        'success',
        override === null
          ? `Saved profile for ${deviceLabel}.`
          : `Saved profile for ${deviceLabel}; still showing ${override}.`,
      );
    });
  };

  const remove = async (): Promise<void> => {
    if (activeProfile === null) return;
    const ok = await confirm({
      title: 'Delete profile?',
      message: `Delete the active profile (${activeProfile})?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const r = await window.editor.deleteProfile(activeProfile);
    notify(r.ok ? 'success' : 'error', r.ok ? `Deleted profile ${activeProfile}.` : r.reason);
  };

  return (
    <div className={styles.controls}>
      <Tooltip content={PROFILE_TOOLTIP}>
        <span className={styles.label}>Profile</span>
      </Tooltip>
      <Tooltip content="Which profile drives the live config (Auto = follow the connected device)">
        <select
          className={styles.select}
          value={override ?? AUTO}
          onChange={(e) => setOverride(e.target.value)}
        >
          <option value={AUTO}>Auto</option>
          {/* The catalog plugin (FreeCAD) owns its pie + Dynamic/Curated mode in
            its dedicated panel, not here (#193). Point users who still expect
            it in this dropdown at that panel with a disabled hint, shown
            whenever the plugin is loaded so it's found even before such a
            source is active, and doubling as the displayed value while one is
            (#209). The name comes from the plugin, so core stays
            plugin-agnostic. */}
          {catalogPlugin && (
            <option
              value={freecadActive && override !== null ? override : CATALOG_HINT}
              disabled
              title={`The ${catalogPluginName} pie (Dynamic or Curated) is chosen in the ${catalogPluginName} panel at the top of the left column, not in this dropdown.`}
            >
              {catalogPluginName} pie (set in the panel at top-left)
            </option>
          )}
          {ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          {otherPluginMenus.length > 0 && (
            <optgroup label="Plugin menus">
              {otherPluginMenus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Tooltip>
      <button
        type="button"
        className={styles.button}
        onClick={save}
        disabled={!hasDevice || isPluginMenuId(override)}
        title={
          isPluginMenuId(override)
            ? 'A plugin menu is active — Save/Delete apply to device profiles'
            : hasDevice
              ? "Save the current config as this device's profile"
              : 'Connect a device to save a profile for it'
        }
      >
        Save
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => void remove()}
        disabled={activeProfile === null || isPluginMenuId(activeProfile)}
        title={
          activeProfile === null
            ? 'No profile is active to delete'
            : isPluginMenuId(activeProfile)
              ? 'Uninstall plugin menus in the Plugins manager, not here'
              : `Delete the active profile (${activeProfile})`
        }
      >
        Delete
      </button>
    </div>
  );
}
