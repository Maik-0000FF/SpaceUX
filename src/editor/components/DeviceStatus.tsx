// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useDeviceInfo } from '../hooks/useDeviceInfo';

import { Tooltip } from './Tooltip';
import styles from './DeviceStatus.module.scss';

/** Zero-padded 4-digit lowercase hex for a USB id (matches the daemon's
 *  profile-id format, e.g. 046d:c62b). */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).padStart(4, '0');
}

/**
 * Read-only toolbar status: which SpaceMouse is connected and which
 * config profile is currently active (#113). The active config follows
 * the device — this is the visible confirmation of that. Profile
 * management (pick / create / rename) lands in a later PR; this just
 * surfaces the state main already resolves.
 */
export function DeviceStatus() {
  const info = useDeviceInfo();
  const connected = info.vendor !== 0 || info.product !== 0;
  const vidPid = `${hex4(info.vendor)}:${hex4(info.product)}`;
  const deviceLabel = connected ? info.name || vidPid : 'No device';
  // `profileId` is null when the global menu.json fallback is active.
  const profileLabel = connected ? (info.profileId ?? 'Default') : null;

  return (
    <div className={styles.status}>
      <span className={styles.label}>Device</span>
      <Tooltip content={connected ? vidPid : ''}>
        <span className={styles.value}>{deviceLabel}</span>
      </Tooltip>
      {profileLabel !== null && (
        <>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span className={styles.label}>Profile</span>
          <span className={styles.value}>{profileLabel}</span>
        </>
      )}
    </div>
  );
}
