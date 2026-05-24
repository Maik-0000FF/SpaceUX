// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';

import type { FreecadBridgeStatus } from '@/shared/ipc';

import styles from './FreecadBridgeInstaller.module.scss';

/**
 * FreeCAD bridge-addon status + install/uninstall (#189b), at the bottom of the
 * FreeCAD panel. The addon must live in FreeCAD's (version-specific) Mod dir
 * for the live pie to work; this resolves that dir, shows whether the addon is
 * installed, and installs/updates or removes the bundled copy — then reminds
 * the user to restart FreeCAD (addons load at startup). A Flatpak/Snap or
 * not-found FreeCAD shows the reason instead of an install button.
 */
export function FreecadBridgeInstaller({ pluginId }: { pluginId: string }) {
  const [status, setStatus] = useState<FreecadBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.editor.getFreecadBridge().then(setStatus);
  }, []);
  useEffect(() => refresh(), [refresh]);

  const install = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const res = await window.editor.installFreecadBridge(pluginId);
    setBusy(false);
    setNote(res.ok ? 'Installed — restart FreeCAD to load the bridge.' : res.reason);
    refresh();
  };

  const uninstall = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const res = await window.editor.uninstallFreecadBridge();
    setBusy(false);
    setNote(res.ok ? 'Removed — restart FreeCAD.' : res.reason);
    refresh();
  };

  if (status === null) return null; // status not pulled yet

  return (
    <div className={styles.bridge}>
      {status.resolved ? (
        <>
          <span className={styles.status}>
            Bridge addon:{' '}
            {status.installed ? `installed (${status.label})` : `not installed (${status.label})`}
          </span>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btn}
              disabled={busy}
              onClick={() => void install()}
              title={`Copy the bridge addon into FreeCAD's ${status.label} Mod directory`}
            >
              {status.installed ? 'Reinstall' : 'Install'}
            </button>
            {status.installed && (
              <button
                type="button"
                className={styles.btn}
                disabled={busy}
                onClick={() => void uninstall()}
              >
                Remove
              </button>
            )}
          </div>
        </>
      ) : (
        <span className={styles.status}>{status.reason}</span>
      )}
      {note !== null && <span className={styles.note}>{note}</span>}
    </div>
  );
}
