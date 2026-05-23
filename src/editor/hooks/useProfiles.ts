// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { ProfilesState } from '@/shared/ipc';

const EMPTY: ProfilesState = { ids: [], override: null, pluginMenus: [] };

/**
 * The per-device profiles the editor knows about (#113): the saved profile
 * ids and the manual override. Pulled on mount, then kept live via the
 * EDITOR_PROFILES_CHANGED push so create / delete / override from any
 * source (incl. this editor's own actions) stay reflected.
 */
export function useProfiles(): ProfilesState {
  const [state, setState] = useState<ProfilesState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    window.editor
      .getProfiles()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        // Pull failed → keep EMPTY (no profiles / no override).
      });
    const off = window.editor.onProfilesChanged((next) => setState(next));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
