// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import { useMenuSettings } from '../state/menu-settings';

// Coalesce a burst of edits (typing in a text field) into one disk
// write. The watcher's self-write window is wider than this so the
// resulting save doesn't echo back as an external change.
const WRITE_DEBOUNCE_MS = 300;

/**
 * Persists local edits to disk, debounced. Skips while a conflict is
 * pending (the user resolves it via the banner) and skips remote changes
 * via the `origin` tag. Reads the config at fire time so a late edit
 * isn't dropped.
 */
export function useWriteBack(): void {
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
            void window.editor
              .getMenuConfig()
              .then((snapshot) => s.setConflict(snapshot, 'external'));
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
}
