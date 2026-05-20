// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { MenuConfig } from '@/shared/menu';

/**
 * The editor's working copy of the menu config.
 *
 * PR Editor-2 is read-only: App fetches the config once on mount and
 * drops it here; the panels render from it. The write-back path
 * (`setConfig` → IPC → atomic disk write) and the temporal/undo
 * wrapper land in PR Editor-3a / 3b — at which point this store grows
 * mutating actions and a `zundo` temporal middleware. Keeping the
 * config in its own store now means that upgrade doesn't touch the
 * UI-only `app-state` store.
 */
type MenuSettingsState = {
  config: MenuConfig | null;
  setConfig: (config: MenuConfig) => void;
};

export const useMenuSettings = create<MenuSettingsState>()(
  immer((set) => ({
    config: null,
    setConfig: (config) =>
      set((state) => {
        state.config = config;
      }),
  })),
);
