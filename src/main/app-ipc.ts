// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { ipcMain } from 'electron';

import { IpcChannel, type PieAppearance } from '../shared/ipc.js';
import { clampPieOpacity, PIE_THEMES } from '../shared/pie-appearance.js';

/**
 * App-level IPC: the pie appearance setting, shared by the live pie and the
 * editor. Main owns the in-memory value (so GET returns it without a disk
 * read) and the persistence + broadcast on SET; this layer only routes and
 * sanitises the renderer's input — the editor renderer is the trust boundary,
 * so an out-of-range opacity or unknown theme is clamped/dropped here rather
 * than reaching the store or the live pie.
 */
export interface AppIpcDeps {
  getAppearance: () => PieAppearance;
  /** Apply a validated partial change: merge, persist, broadcast. */
  setAppearance: (patch: Partial<PieAppearance>) => void;
}

export function wireAppIpc(deps: AppIpcDeps): void {
  ipcMain.handle(IpcChannel.GET_PIE_APPEARANCE, () => deps.getAppearance());

  ipcMain.on(IpcChannel.SET_PIE_APPEARANCE, (_evt, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) return;
    const p = patch as Record<string, unknown>;
    const clean: Partial<PieAppearance> = {};
    if (typeof p.theme === 'string' && PIE_THEMES.has(p.theme)) {
      clean.theme = p.theme as PieAppearance['theme'];
    }
    if (typeof p.opacity === 'number' && Number.isFinite(p.opacity)) {
      clean.opacity = clampPieOpacity(p.opacity);
    }
    if (Object.keys(clean).length > 0) deps.setAppearance(clean);
  });
}
