// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { isPluginMenuId } from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useProfiles } from '../hooks/useProfiles';

import styles from './ProfileControls.module.scss';

const AUTO = ''; // the <select> value standing for "Auto" (no override)

type Feedback = { kind: 'ok' | 'error'; text: string };

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const hasDevice = device.vendor !== 0 || device.product !== 0;
  const deviceLabel = device.name || 'this device';

  // Drop stale feedback ("Saved profile for <old device>") when the
  // connected device changes — keyed on the identity, not profileId, so a
  // save that makes the device's own profile active doesn't wipe its own
  // just-shown confirmation.
  useEffect(() => {
    setFeedback(null);
  }, [device.vendor, device.product]);
  // Delete targets the *active* profile, so the connected device's
  // auto-resolved profile can be removed without first overriding to it.
  const activeProfile = device.profileId;

  const setOverride = (value: string): void => {
    setFeedback(null);
    void window.editor.setProfileOverride(value === AUTO ? null : value);
  };

  const save = (): void => {
    setFeedback(null);
    void window.editor.saveProfile().then((r) => {
      if (!r.ok) {
        setFeedback({ kind: 'error', text: r.reason });
        return;
      }
      // Saving targets the connected device's profile. When an override is
      // active it isn't what's live, so say so — otherwise it just took
      // effect (Auto resolves to the device's own profile).
      setFeedback({
        kind: 'ok',
        text:
          override === null
            ? `Saved profile for ${deviceLabel}.`
            : `Saved profile for ${deviceLabel}; still showing ${override}.`,
      });
    });
  };

  const remove = (): void => {
    if (activeProfile === null) return;
    setFeedback(null);
    void window.editor.deleteProfile(activeProfile).then((r) => {
      if (!r.ok) setFeedback({ kind: 'error', text: r.reason });
      else setFeedback({ kind: 'ok', text: `Deleted profile ${activeProfile}.` });
    });
  };

  return (
    <div className={styles.controls}>
      <span className={styles.label}>Profile</span>
      <select
        className={styles.select}
        value={override ?? AUTO}
        onChange={(e) => setOverride(e.target.value)}
        title="Which profile drives the live config (Auto = follow the connected device)"
      >
        <option value={AUTO}>Auto</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
        {pluginMenus.length > 0 && (
          <optgroup label="Plugin menus">
            {pluginMenus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
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
        onClick={remove}
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
      {feedback !== null && (
        <span
          className={feedback.kind === 'error' ? styles.error : styles.ok}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </span>
      )}
    </div>
  );
}
