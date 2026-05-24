// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { CommandPalette } from './components/CommandPalette';
import { DeviceStatus } from './components/DeviceStatus';
import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { PieSelectors } from './components/PieSelectors';
import { PieSliders } from './components/PieSliders';
import { ProfileControls } from './components/ProfileControls';
import { Properties } from './components/Properties';
import { SettingsPage } from './components/SettingsPage';
import { useDeviceInfo } from './hooks/useDeviceInfo';
import { useExternalSync } from './hooks/useExternalSync';
import { useThemePreference } from './hooks/useThemePreference';
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts';
import { useWriteBack } from './hooks/useWriteBack';
import { adopt } from './state/adopt';
import { useMenuSettings } from './state/menu-settings';

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
  // current mtime so the write's own conflict check passes.
  const overwrite = (): void => {
    const { config, conflict: stashed } = useMenuSettings.getState();
    if (!config || !stashed) return;
    void window.editor.setMenuConfig(config, stashed.mtime).then((result) => {
      const s = useMenuSettings.getState();
      if (result.ok === true) {
        s.markSaved(result.mtime);
        s.clearConflict();
      } else if (result.ok === 'conflict') {
        // Raced another external write — refresh the stash to the current
        // on-disk version so a follow-up Reload adopts the latest, not
        // the now-superseded snapshot. A write race is a file-level
        // conflict regardless of what first raised the banner.
        void window.editor.getMenuConfig().then((snapshot) => s.setConflict(snapshot, 'external'));
      } else {
        s.setSaveError(result.reason);
      }
    });
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

      {tab === 'menu' ? (
        <div className={styles.shell}>
          <div className={styles.leftColumn}>
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
    </div>
  );
}
