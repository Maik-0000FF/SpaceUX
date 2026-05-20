// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer } from 'electron';

import type { EditorBridge } from '../shared/bridge.js';
import { IpcChannel } from '../shared/ipc.js';
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
  getMenuConfig: () => ipcRenderer.invoke(IpcChannel.EDITOR_GET_MENU_CONFIG) as Promise<MenuConfig>,
};

contextBridge.exposeInMainWorld('editor', bridge);
