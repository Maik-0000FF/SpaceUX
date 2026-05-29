// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { ActiveWorkbenchHeader } from './components/ActiveWorkbenchHeader';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DeviceStatus } from './components/DeviceStatus';
import { FreecadSourceControls } from './components/FreecadSourceControls';
import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { PieSelectors } from './components/PieSelectors';
import { PieSliders } from './components/PieSliders';
import { ProfileControls } from './components/ProfileControls';
import { Properties } from './components/Properties';
import { SettingsPage } from './components/SettingsPage';
import { ToastStack } from './components/ToastStack';
import { useDeviceInfo } from './hooks/useDeviceInfo';
import { useExternalSync } from './hooks/useExternalSync';
import { useReadOnlySource } from './hooks/useReadOnlySource';
import { useThemePreference } from './hooks/useThemePreference';
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts';
import { useWriteBack } from './hooks/useWriteBack';
import { adopt } from './state/adopt';
import { useMenuSettings } from './state/menu-settings';
import { notify } from './state/toasts';

import styles from './App.module.scss';

/**
 * Editor root. Composition only: the document sync (load + external
 * changes), write-back, undo/redo and theme live in hooks; this renders
 * the toolbar, the conflict/error banner, and the three-panel shell.
 */
export function App() {
  const conflict = useMenuSettings((s) => s.conflict);
  const conflictCause = useMenuSettings((s) => s.conflictCause);
  const saveError = useMenuSettings((s) => s.saveError);
  const device = useDeviceInfo();
  const [tab, setTab] = useState<'menu' | 'settings'>('menu');

  // A plugin-provided menu (e.g. the dynamic FreeCAD pie) is the active source
  // → the config is a read-only overlay. Sync that into the store so its
  // mutation guard blocks edits up front, and surface it in the banner below.
  const readOnly = useReadOnlySource();
  useEffect(() => {
    useMenuSettings.getState().setReadOnly(readOnly);
  }, [readOnly]);

  const { theme, changeTheme } = useThemePreference();
  useExternalSync();
  useWriteBack();
  useUndoRedoShortcuts();

  // Discard local edits, adopt the on-disk version stashed on conflict.
  const reload = (): void => {
    const stashed = useMenuSettings.getState().conflict;
    if (stashed) adopt(stashed);
  };

  // Keep local edits: write them over the on-disk version using its
  // current mtime so the write's own conflict check passes. If a follow-up
  // external save (e.g. VS Code autosave) lands between the conflict was
  // raised and the click, the first write returns ok:'conflict' with a
  // bumped mtime; retry up to a few times with the fresh mtime so a steady
  // external editor doesn't make Overwrite look like a silent no-op (#275).
  // After the bounded attempts, surface a toast so the user knows the
  // click did register and what they need to do.
  const overwrite = async (): Promise<void> => {
    const { config, conflict: stashed } = useMenuSettings.getState();
    if (!config || !stashed) return;
    const MAX_OVERWRITE_ATTEMPTS = 3;
    let expectedMtime: number | null = stashed.mtime;
    try {
      for (let attempt = 1; attempt <= MAX_OVERWRITE_ATTEMPTS; attempt++) {
        const result = await window.editor.setMenuConfig(config, expectedMtime);
        const s = useMenuSettings.getState();
        if (result.ok === true) {
          s.markSaved(result.mtime);
          s.clearConflict();
          return;
        }
        if (result.ok === false) {
          s.setSaveError(result.reason);
          return;
        }
        // result.ok === 'conflict'. Refresh the stash to the current on-disk
        // version so a follow-up Reload adopts the latest, not the now-
        // superseded snapshot, and use the new mtime for the next attempt.
        const snapshot = await window.editor.getMenuConfig();
        s.setConflict(snapshot, 'external');
        expectedMtime = snapshot.mtime;
      }
      notify(
        'error',
        'The active configuration kept changing while saving. Pause the external editor and try Overwrite again.',
      );
    } catch (err) {
      // Belt-and-suspenders: the setMenuConfig / getMenuConfig handlers return
      // result objects rather than throwing, but a future IPC reshape (or a
      // transport-level Electron error) could still reject the await. Surface
      // it as a save error instead of letting the rejection bubble out of the
      // onClick path silently.
      useMenuSettings.getState().setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.brand}>SpaceUX</span>
          <nav className={styles.tabs}>
            <button
              type="button"
              className={tab === 'menu' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab('menu')}
              aria-current={tab === 'menu'}
            >
              Menu
            </button>
            <button
              type="button"
              className={tab === 'settings' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab('settings')}
              aria-current={tab === 'settings'}
            >
              Settings
            </button>
          </nav>
          <DeviceStatus />
        </div>
        {tab === 'menu' && (
          <div className={styles.toolbarControls}>
            <ProfileControls />
          </div>
        )}
      </header>
      {conflict !== null ? (
        <div className={styles.bannerConflict} role="alert">
          <span className={styles.bannerText}>
            {conflictCause === 'device'
              ? device.name
                ? `The connected device changed to ${device.name} — its config differs from your unsaved edits.`
                : 'The connected device changed while you had unsaved edits.'
              : conflictCause === 'profile'
                ? `The active profile changed to ${device.profileId ?? 'Default'} — it differs from your unsaved edits.`
                : 'The active configuration was changed outside the editor while you had unsaved edits.'}
          </span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={reload}
            title={
              conflictCause === 'external'
                ? 'Discard your edits and load the changed config'
                : 'Discard your edits and load the now-active config'
            }
          >
            Reload
          </button>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={overwrite}
            title={
              conflictCause === 'external'
                ? 'Write your unsaved edits over the changed config'
                : 'Write your unsaved edits onto the now-active config'
            }
          >
            Overwrite
          </button>
        </div>
      ) : saveError !== null ? (
        <div className={styles.bannerError} role="alert">
          <span className={styles.bannerText}>Save failed: {saveError}</span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => useMenuSettings.getState().setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Read-only source: a plugin-provided menu (the dynamic FreeCAD pie,
          #77) is active. Its content is generated live and isn't editable —
          the edit controls are disabled and the store blocks mutations. Offer
          a one-click way back to an editable source (Auto = follow the device
          / menu.json). Persistent (no dismiss): it's a state, not an alert. */}
      {readOnly && (
        <div className={styles.bannerReadOnly} role="status">
          <span className={styles.bannerText}>
            This pie is provided by a plugin and is read-only — its content follows the live app.
            Switch the active source to edit your own pie.
          </span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => void window.editor.setProfileOverride(null)}
          >
            Switch to Auto
          </button>
        </div>
      )}

      {tab === 'menu' ? (
        <div className={styles.shell}>
          <div className={styles.leftColumn}>
            <FreecadSourceControls />
            <ActiveWorkbenchHeader />
            <MenuList />
            <CommandPalette />
          </div>
          <main className={styles.center}>
            <div className={styles.controlRow}>
              <PieSelectors />
              <PieSliders />
            </div>
            <div className={styles.previewArea}>
              <MenuPreview />
            </div>
          </main>
          <Properties />
        </div>
      ) : (
        <SettingsPage theme={theme} changeTheme={changeTheme} />
      )}

      {/* App-wide hosts (#223): one toast stack + one confirm dialog for the
          whole editor, so components don't roll their own. */}
      <ToastStack />
      <ConfirmDialog />
    </div>
  );
}
