// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { EditorBridge } from '../shared/bridge.js';
import { IpcChannel, type MenuConfigSnapshot, type MenuWriteResult } from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';

/**
 * Implementation of the EditorBridge contract from @/shared/bridge.
 * The editor window loads this preload instead of the pie's
 * preload.cjs, so its renderer sees `window.editor` (config
 * read/write) rather than `window.spaceux` (live puck stream). Both
 * are bundled to .cjs by esbuild for the same ESM-in-sandbox reason
 * documented on the pie preload.
 */

const bridge: EditorBridge = {
  ready: () => ipcRenderer.send(IpcChannel.EDITOR_READY),
  getMenuConfig: () =>
    ipcRenderer.invoke(IpcChannel.EDITOR_GET_MENU_CONFIG) as Promise<MenuConfigSnapshot>,
  setMenuConfig: (config: MenuConfig, expectedMtime: number | null) =>
    ipcRenderer.invoke(
      IpcChannel.EDITOR_SET_MENU_CONFIG,
      config,
      expectedMtime,
    ) as Promise<MenuWriteResult>,
  onMenuConfigChanged: (handler) => {
    const listener = (_evt: IpcRendererEvent, snapshot: MenuConfigSnapshot) => handler(snapshot);
    ipcRenderer.on(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, listener);
    return () => ipcRenderer.off(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld('editor', bridge);
