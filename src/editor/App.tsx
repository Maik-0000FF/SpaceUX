// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import Mousetrap from 'mousetrap';
import { useEffect, useState } from 'react';

import type { MenuConfigSnapshot, ThemeChoice } from '@/shared/ipc';

import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { PreviewHeader } from './components/PreviewHeader';
import { Properties } from './components/Properties';
import { useAppState } from './state/app-state';
import { useMenuSettings } from './state/menu-settings';

import styles from './App.module.scss';

// Coalesce a burst of edits (typing in a text field) into one disk
// write. The watcher's self-write window is wider than this so the
// resulting save doesn't echo back as an external change.
const WRITE_DEBOUNCE_MS = 300;

/**
 * Adopt a remote snapshot (initial load / external change / Reload).
 *
 * The single chokepoint for accepting a config from outside the editor:
 * it sets the config and drops the undo history. A remote snapshot is
 * not an undoable step, and undo must never cross a reload boundary —
 * routing every adoption through here keeps that structural rather than
 * a "remember to call clear()" convention at each call site.
 */
function adopt(snapshot: MenuConfigSnapshot): void {
  useMenuSettings.getState().setConfig(snapshot);
  useMenuSettings.temporal.getState().clear();
  // A reload may change the menu structure, so reset navigation to the
  // top level (also clears the selection) rather than risk a stale view.
  useAppState.getState().drillTo(0);
}

/**
 * Editor root. Owns the write-back loop and conflict handling:
 *  - on mount, pull the config snapshot into the store (origin remote);
 *  - subscribe to local edits and write them back, debounced;
 *  - on an external change, adopt it when clean but raise a conflict
 *    banner when there are unsaved local edits (don't clobber them);
 *  - Reload adopts the on-disk version, Overwrite writes the local one.
 */
export function App() {
  const conflict = useMenuSettings((s) => s.conflict);
  const saveError = useMenuSettings((s) => s.saveError);

  const [theme, setTheme] = useState<ThemeChoice>('system');

  // Load the persisted theme on mount.
  useEffect(() => {
    void window.editor.getTheme().then((t) => setTheme(t));
  }, []);

  // Apply the theme to <html>: 'system' resolves to light/dark via
  // prefers-color-scheme and tracks OS changes; the others map directly.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      root.dataset.theme =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme;
    };
    apply();
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const changeTheme = (next: ThemeChoice): void => {
    setTheme(next);
    window.editor.setTheme(next); // persist (best-effort)
  };

  // Initial load.
  useEffect(() => {
    window.editor.ready();
    let cancelled = false;
    void window.editor.getMenuConfig().then((snapshot) => {
      if (!cancelled) adopt(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // External changes (file edited outside the editor). Adopt when the
  // editor has no unsaved edits; otherwise it's a conflict — stash the
  // on-disk snapshot and let the banner decide, rather than silently
  // overwriting the user's in-progress edits.
  useEffect(
    () =>
      window.editor.onMenuConfigChanged((snapshot) => {
        const store = useMenuSettings.getState();
        if (store.dirty) store.setConflict(snapshot);
        else adopt(snapshot);
      }),
    [],
  );

  // Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y or Shift+Z). Only the config is
  // tracked (zundo temporal, see the store). Mousetrap ignores these
  // inside text inputs, so editing a field keeps the field's own native
  // undo.
  useEffect(() => {
    const step = (direction: 'undo' | 'redo'): boolean => {
      const temporal = useMenuSettings.temporal.getState();
      const available = direction === 'undo' ? temporal.pastStates : temporal.futureStates;
      if (available.length === 0) return false;
      // Tag the restored config `local` so the write-back subscription
      // persists it. Note: undoing all the way back to the on-disk state
      // still flags dirty and re-writes identical content — harmless (the
      // self-write window absorbs the echo), but a future "unsaved
      // changes" indicator would need to reconcile this.
      useMenuSettings.setState({ origin: 'local', dirty: true });
      if (direction === 'undo') temporal.undo();
      else temporal.redo();
      return false;
    };
    Mousetrap.bind('mod+z', () => step('undo'));
    Mousetrap.bind(['mod+y', 'mod+shift+z'], () => step('redo'));
    return () => {
      Mousetrap.unbind('mod+z');
      Mousetrap.unbind(['mod+y', 'mod+shift+z']);
    };
  }, []);

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
            // Backup path: the dirty-check on EDITOR_MENU_CONFIG_CHANGED
            // normally raises the banner first, so reaching a write-time
            // conflict is rare. getMenuConfig() returns main's in-memory
            // config, which may briefly lag the watcher's debounce — but
            // that same external change's change-push arrives moments
            // later and re-stashes the authoritative snapshot (we're
            // still dirty), so any staleness here self-corrects.
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
          <PreviewHeader />
          <div className={styles.previewArea}>
            <MenuPreview />
          </div>
        </main>
        <Properties />
      </div>
    </div>
  );
}
