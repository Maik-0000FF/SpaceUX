// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ThemeChoice } from '@/shared/ipc';

import { LiveToggle } from './components/LiveToggle';
import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { PreviewHeader } from './components/PreviewHeader';
import { Properties } from './components/Properties';
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
  const saveError = useMenuSettings((s) => s.saveError);

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
        // the now-superseded snapshot.
        void window.editor.getMenuConfig().then((snapshot) => s.setConflict(snapshot));
      } else {
        s.setSaveError(result.reason);
      }
    });
  };

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <span className={styles.brand}>SpaceUX</span>
        <label className={styles.themeControl}>
          <span className={styles.themeLabel}>Theme</span>
          <select
            className={styles.themeSelect}
            value={theme}
            onChange={(e) => changeTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="spaceux">SpaceUX</option>
          </select>
        </label>
      </header>
      {conflict !== null ? (
        <div className={styles.bannerConflict} role="alert">
          <span className={styles.bannerText}>
            menu.json was changed outside the editor while you had unsaved edits.
          </span>
          <button type="button" className={styles.bannerButton} onClick={reload}>
            Reload
          </button>
          <button type="button" className={styles.bannerButton} onClick={overwrite}>
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

      <div className={styles.shell}>
        <MenuList />
        <main className={styles.center}>
          <div className={styles.breadcrumbSlot}>
            <PreviewHeader />
            <LiveToggle />
          </div>
          <div className={styles.previewArea}>
            <MenuPreview />
          </div>
        </main>
        <Properties />
      </div>
    </div>
  );
}
