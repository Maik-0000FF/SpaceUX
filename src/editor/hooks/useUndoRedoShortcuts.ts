// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import Mousetrap from 'mousetrap';
import { useEffect } from 'react';

import { useMenuSettings } from '../state/menu-settings';

/**
 * Wires Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Y / Shift+Z (redo) to the config
 * store's temporal history. Only the config is tracked (zundo); Mousetrap
 * ignores these inside text inputs, so editing a field keeps the field's
 * own native undo.
 */
export function useUndoRedoShortcuts(): void {
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
}
