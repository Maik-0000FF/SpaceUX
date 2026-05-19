// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { AxesValues, ButtonEventPayload, SpaceUxBridge } from '../shared/bridge.js';
import { IpcChannel, type DaemonStatusPayload, type MenuOpenPayload } from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';

/**
 * Implementation of the SpaceUxBridge contract from
 * @/shared/bridge. contextIsolation keeps the renderer sandboxed; the
 * bridge object is the only thing window.spaceux can see. Channel
 * names live in @/shared/ipc so renaming one channel needs a change
 * in exactly two places (the main handler and this file) — never
 * grep across the renderer tree.
 */

function subscribe<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_evt: IpcRendererEvent, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const bridge: SpaceUxBridge = {
  onAxes: (handler) => subscribe<AxesValues>(IpcChannel.AXES, handler),
  onButton: (handler) => subscribe<ButtonEventPayload>(IpcChannel.BUTTON, handler),
  onDaemonStatus: (handler) => subscribe<DaemonStatusPayload>(IpcChannel.DAEMON_STATUS, handler),
  getMenuConfig: () => ipcRenderer.invoke(IpcChannel.GET_MENU_CONFIG) as Promise<MenuConfig>,
  onMenuConfig: (handler) => subscribe<MenuConfig>(IpcChannel.MENU_CONFIG, handler),
  onMenuOpen: (handler) => subscribe<MenuOpenPayload>(IpcChannel.MENU_OPEN, handler),
  // MENU_COMMIT has no payload — wrap the subscribe helper so the
  // handler signature stays () => void instead of (_: void) => void.
  onMenuCommit: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(IpcChannel.MENU_COMMIT, listener);
    return () => ipcRenderer.off(IpcChannel.MENU_COMMIT, listener);
  },
  invokeAction: (key, config) => ipcRenderer.invoke(IpcChannel.INVOKE_ACTION, key, config),
  closeMenu: () => ipcRenderer.invoke(IpcChannel.CLOSE_MENU) as Promise<void>,
};

contextBridge.exposeInMainWorld('spaceux', bridge);
