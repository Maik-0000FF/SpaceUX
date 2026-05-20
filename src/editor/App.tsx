// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { Properties } from './components/Properties';
import { useMenuSettings } from './state/menu-settings';

import styles from './App.module.scss';

// Coalesce a burst of edits (typing in a text field) into one disk
// write. The watcher's self-write window is wider than this so the
// resulting save doesn't echo back as an external change.
const WRITE_DEBOUNCE_MS = 300;

/**
 * Editor root. Owns the write-back loop and conflict handling:
 *  - on mount, pull the config snapshot into the store (origin remote);
 *  - subscribe to local edits and write them back, debounced;
 *  - on an external change, adopt it when clean but raise a conflict
 *    banner when there are unsaved local edits (don't clobber them);
 *  - Reload adopts the on-disk version, Overwrite writes the local one.
 */
export function App() {
  const setConfig = useMenuSettings((s) => s.setConfig);
  const conflict = useMenuSettings((s) => s.conflict);
  const saveError = useMenuSettings((s) => s.saveError);

  // Initial load.
  useEffect(() => {
    window.editor.ready();
    let cancelled = false;
    void window.editor.getMenuConfig().then((snapshot) => {
      if (!cancelled) setConfig(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [setConfig]);

  // External changes (file edited outside the editor). Adopt when the
  // editor has no unsaved edits; otherwise it's a conflict — stash the
  // on-disk snapshot and let the banner decide, rather than silently
  // overwriting the user's in-progress edits.
  useEffect(
    () =>
      window.editor.onMenuConfigChanged((snapshot) => {
        const store = useMenuSettings.getState();
        if (store.dirty) store.setConflict(snapshot);
        else store.setConfig(snapshot);
      }),
    [],
  );

  // Write-back: persist local edits, debounced. Skips while a conflict
  // is pending (the user resolves it via the banner) and skips remote
  // changes via the `origin` tag. Reads the config at fire time so a
  // late edit isn't dropped.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useMenuSettings.subscribe((state, prev) => {
      if (state.config === prev.config || state.origin !== 'local' || !state.config) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const store = useMenuSettings.getState();
        if (store.conflict !== null || store.config === null) return;
        void window.editor.setMenuConfig(store.config, store.mtime).then((result) => {
          const s = useMenuSettings.getState();
          if (result.ok === true) {
            s.markSaved(result.mtime);
          } else if (result.ok === 'conflict') {
            // The file moved under us without a change-push reaching us
            // yet — fetch the on-disk version so the banner can offer it.
            void window.editor.getMenuConfig().then((snapshot) => s.setConflict(snapshot));
          } else {
            s.setSaveError(result.reason);
          }
        });
      }, WRITE_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Discard local edits, adopt the on-disk version stashed on conflict.
  const reload = (): void => {
    const stashed = useMenuSettings.getState().conflict;
    if (stashed) useMenuSettings.getState().setConfig(stashed);
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
      } else if (result.ok === false) {
        s.setSaveError(result.reason);
      }
      // Still a conflict (changed again in the gap) → leave the banner.
    });
  };

  return (
    <div className={styles.app}>
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
        </div>
      ) : null}

      <div className={styles.shell}>
        <MenuList />
        <main className={styles.center}>
          <MenuPreview />
        </main>
        <Properties />
      </div>
    </div>
  );
}
