// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { EditorAction } from '@/shared/ipc';

/**
 * The actions the editor can offer in the node Action dropdown
 * (builtins + loaded plugins), pulled from main on mount. Static for the
 * session — plugins load at startup — so a one-shot pull (no push) is
 * enough. Empty until the pull resolves, or if it fails (the Action field
 * then falls back to its raw-text "Custom" entry, so nothing is lost).
 */
export function useAvailableActions(): EditorAction[] {
  const [actions, setActions] = useState<EditorAction[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.editor
      .getAvailableActions()
      .then((next) => {
        if (!cancelled) setActions(next);
      })
      .catch(() => {
        // Keep empty → the Action field stays usable via its Custom entry.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return actions;
}
