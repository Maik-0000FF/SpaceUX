// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog, ipcMain } from 'electron';

import {
  IpcChannel,
  type EditorAction,
  type MenuConfigSnapshot,
  type ThemeChoice,
} from '../shared/ipc.js';
import { DEFAULT_MENU_CONFIG, type MenuConfig } from '../shared/menu.js';

import { loadEditorSettings, saveEditorSettings } from './editor-settings.js';
import { setEditorLive } from './editor-window.js';
import { markSelfWrite } from './menu-watcher.js';
import { writeMenuConfig } from './menu-writer.js';

/**
 * Hooks the editor IPC layer into main's live menu-config state. The
 * state itself stays in the app entry (it's shared with the pie trigger,
 * the watcher, and action dispatch); this layer reaches it through the
 * accessors here rather than owning it.
 */
export interface EditorIpcDeps {
  getConfig: () => MenuConfig | null;
  getMtime: () => number | null;
  /** Path the editor write should target, or undefined if none is known. */
  getWriteTarget: () => string | undefined;
  /** Adopt a successful write: update the in-memory config/mtime/source
   *  and hot-reload the live pie. */
  applyWrite: (config: MenuConfig, mtime: number, target: string) => void;
  /** The actions the editor can offer in the Action dropdown (builtins +
   *  loaded plugins), flattened from main's action index. */
  listActions: () => EditorAction[];
}

/**
 * Register the editor window's IPC handlers: config read/write, theme
 * get/set, and the native file picker.
 */
export function wireEditorIpc(deps: EditorIpcDeps): void {
  // Pull-based, like the renderer's GET_MENU_CONFIG: the editor gets the
  // current snapshot (config + mtime baseline) at mount without racing a
  // push. mtime feeds the editor's conflict detection on later writes.
  ipcMain.handle(
    IpcChannel.EDITOR_GET_MENU_CONFIG,
    (): MenuConfigSnapshot => ({
      config: deps.getConfig() ?? DEFAULT_MENU_CONFIG,
      mtime: deps.getMtime(),
    }),
  );

  // Editor write-back. Validate + atomic-write happen in menu-writer;
  // here we pick the target path, arm the watcher's self-write guard so
  // our own write doesn't echo back, and on success adopt the new mtime
  // and hot-reload the live pie (via deps.applyWrite). Conflicts /
  // validation errors are returned verbatim for the editor to surface.
  ipcMain.handle(
    IpcChannel.EDITOR_SET_MENU_CONFIG,
    async (_evt, config: MenuConfig, expectedMtime: number | null) => {
      const target = deps.getWriteTarget();
      if (target === undefined) {
        return { ok: false as const, reason: 'no writable config path available' };
      }
      // Arm before writing so the rename's inotify event is suppressed.
      markSelfWrite(target);
      const result = await writeMenuConfig(target, config, expectedMtime);
      // Adopt the normalized config the writer persisted (not the raw IPC
      // arg) so the in-memory copy matches the file exactly.
      if (result.ok === true) deps.applyWrite(result.config, result.mtime, target);
      return result;
    },
  );

  // Available actions for the sector Action dropdown. Pulled on mount;
  // static for the session (plugins load at startup), so no push channel.
  ipcMain.handle(IpcChannel.EDITOR_GET_ACTIONS, (): EditorAction[] => deps.listActions());

  // Editor mounted. No-op: the editor pulls via EDITOR_GET_MENU_CONFIG;
  // the handler exists so the renderer's fire-and-forget `ready()` has a
  // registered listener.
  ipcMain.on(IpcChannel.EDITOR_READY, () => {});

  // Live-preview on/off. Recorded in editor-window so the daemon-event path
  // can suppress the overlay pie (when focused) and gate axis forwarding.
  ipcMain.on(IpcChannel.EDITOR_LIVE, (_evt, on: boolean) => {
    setEditorLive(on === true);
  });

  // Theme preference, persisted in editor-settings.json (best-effort).
  ipcMain.handle(IpcChannel.EDITOR_GET_THEME, async (): Promise<ThemeChoice> => {
    return (await loadEditorSettings()).theme ?? 'system';
  });
  ipcMain.on(IpcChannel.EDITOR_SET_THEME, (_evt, theme: ThemeChoice) => {
    void saveEditorSettings({ theme });
  });

  // Native file-open dialog for the exec command path. Parented to the
  // focused window (the editor) so it's modal to it.
  ipcMain.handle(IpcChannel.EDITOR_PICK_FILE, async (): Promise<string | null> => {
    const parent = BrowserWindow.getFocusedWindow();
    const result = await (parent
      ? dialog.showOpenDialog(parent, { properties: ['openFile'] })
      : dialog.showOpenDialog({ properties: ['openFile'] }));
    return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
  });
}
