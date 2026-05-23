// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { EditorAction } from '@/shared/ipc';

/**
 * The actions the editor can offer in the node Action dropdown
 * (builtins + loaded plugins), pulled from main on mount and re-pulled on
 * EDITOR_ACTIONS_CHANGED — so importing/uninstalling a plugin updates the
 * dropdown without an editor restart. Empty until the pull resolves, or if
 * it fails (the Action field then falls back to its raw-text "Custom" entry,
 * so nothing is lost).
 */
export function useAvailableActions(): EditorAction[] {
  const [actions, setActions] = useState<EditorAction[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pull = (): void => {
      window.editor
        .getAvailableActions()
        .then((next) => {
          if (!cancelled) setActions(next);
        })
        .catch(() => {
          // Keep current → the Action field stays usable via its Custom entry.
        });
    };
    pull();
    const off = window.editor.onActionsChanged(pull);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return actions;
}
