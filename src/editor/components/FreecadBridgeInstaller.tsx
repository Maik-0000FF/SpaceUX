// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FreecadBridgeStatus } from '@/shared/ipc';

import { Tooltip } from './Tooltip';
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
  // Guard the async setState paths (mount pull + install/uninstall) so a late
  // resolve after the panel unmounts (tab switch) doesn't set state on a gone
  // component — matches the cancelled-flag pattern used elsewhere (useWorkbenchMenus).
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    void window.editor.getFreecadBridge().then((s) => {
      if (mounted.current) setStatus(s);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const install = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const res = await window.editor.installFreecadBridge(pluginId);
    if (!mounted.current) return;
    setBusy(false);
    setNote(res.ok ? 'Installed — restart FreeCAD to load the bridge.' : res.reason);
    refresh();
  };

  const uninstall = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    const res = await window.editor.uninstallFreecadBridge();
    if (!mounted.current) return;
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
            <Tooltip content={`Copy the bridge addon into FreeCAD's ${status.label} Mod directory`}>
              <button
                type="button"
                className={styles.btn}
                disabled={busy}
                onClick={() => void install()}
              >
                {status.installed ? 'Reinstall' : 'Install'}
              </button>
            </Tooltip>
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
