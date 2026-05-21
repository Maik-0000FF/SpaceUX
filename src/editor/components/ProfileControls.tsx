// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useProfiles } from '../hooks/useProfiles';

import styles from './ProfileControls.module.scss';

const AUTO = ''; // the <select> value standing for "Auto" (no override)

/**
 * Toolbar control for per-device profiles (#113): pick which profile drives
 * the live config, save the current config as the connected device's
 * profile, or delete a profile.
 *
 * The dropdown is the manual *override*: "Auto" lets the connected device
 * pick its own profile (or the menu.json fallback), while choosing a
 * specific profile force-loads it. The active profile (what auto actually
 * resolved to) is shown read-only by DeviceStatus.
 */
export function ProfileControls() {
  const { ids, override } = useProfiles();
  const device = useDeviceInfo();
  const [error, setError] = useState<string | null>(null);

  const hasDevice = device.vendor !== 0 || device.product !== 0;

  const setOverride = (value: string): void => {
    setError(null);
    void window.editor.setProfileOverride(value === AUTO ? null : value);
  };

  const save = (): void => {
    setError(null);
    void window.editor.saveProfile().then((r) => {
      if (!r.ok) setError(r.reason);
    });
  };

  const remove = (): void => {
    if (override === null) return;
    setError(null);
    void window.editor.deleteProfile(override).then((r) => {
      if (!r.ok) setError(r.reason);
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
      </select>
      <button
        type="button"
        className={styles.button}
        onClick={save}
        disabled={!hasDevice}
        title={
          hasDevice
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
        disabled={override === null}
        title={override === null ? 'Select a profile to delete' : `Delete profile ${override}`}
      >
        Delete
      </button>
      {error !== null && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
