// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import { adopt } from '../state/adopt';
import { useMenuSettings } from '../state/menu-settings';

/**
 * Brings the config in from main: pulls the initial snapshot on mount,
 * then adopts out-of-band changes — except when there are unsaved local
 * edits, where it stashes the on-disk snapshot as a conflict (for the
 * banner) instead of silently overwriting the user's work.
 */
export function useExternalSync(): void {
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

  // External changes (file edited outside the editor). Adopt when clean;
  // otherwise it's a conflict — stash the on-disk snapshot and let the
  // banner decide, rather than clobbering in-progress edits.
  useEffect(
    () =>
      window.editor.onMenuConfigChanged((change) => {
        const store = useMenuSettings.getState();
        if (store.dirty)
          store.setConflict({ config: change.config, mtime: change.mtime }, change.cause);
        else adopt(change);
      }),
    [],
  );
}
