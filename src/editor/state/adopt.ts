// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuConfigSnapshot } from '@/shared/ipc';

import { useAppState } from './app-state';
import { useMenuSettings } from './menu-settings';

/**
 * Adopt a remote snapshot (initial load / external change / Reload).
 *
 * The single chokepoint for accepting a config from outside the editor:
 * it sets the config and drops the undo history. A remote snapshot is
 * not an undoable step, and undo must never cross a reload boundary —
 * routing every adoption through here keeps that structural rather than
 * a "remember to call clear()" convention at each call site.
 */
export function adopt(snapshot: MenuConfigSnapshot): void {
  useMenuSettings.getState().setConfig(snapshot);
  useMenuSettings.temporal.getState().clear();
  // A reload may change the menu structure, so reset navigation to the
  // top level (also clears the selection) rather than risk a stale view.
  useAppState.getState().drillTo(0);
}
