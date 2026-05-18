// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { IpcChannel, type DaemonStatusPayload, type MenuOpenPayload } from '../shared/ipc';
import type { MenuConfig } from '../shared/menu';

/**
 * Renderer-visible API.
 *
 * Everything the React UI is allowed to call against the main
 * process flows through here. contextIsolation keeps the renderer
 * sandboxed; the bridge object is the only thing window.spaceux can
 * see. Channel names live in @/shared/ipc so renaming one channel
 * needs a change in exactly two places (the main handler and this
 * file) — never grep across the renderer tree.
 */

type AxesValues = [number, number, number, number, number, number];

export type SpaceUxBridge = {
  onAxes(handler: (values: AxesValues) => void): () => void;
  onButton(handler: (payload: { bnum: number; pressed: boolean }) => void): () => void;
  onDaemonStatus(handler: (payload: DaemonStatusPayload) => void): () => void;
  /** Main pushes the resolved menu config (user file or default). */
  onMenuConfig(handler: (config: MenuConfig) => void): () => void;
  /** Pie menu opened at the given anchor (renderer-window coords). */
  onMenuOpen(handler: (payload: MenuOpenPayload) => void): () => void;
  /** Pie menu commit / dismiss request from main (no payload). */
  onMenuCommit(handler: () => void): () => void;
  invokeAction(key: string, config: Record<string, unknown>): Promise<void>;
};

function subscribe<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_evt: IpcRendererEvent, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const bridge: SpaceUxBridge = {
  onAxes: (handler) => subscribe<AxesValues>(IpcChannel.AXES, handler),
  onButton: (handler) => subscribe<{ bnum: number; pressed: boolean }>(IpcChannel.BUTTON, handler),
  onDaemonStatus: (handler) => subscribe<DaemonStatusPayload>(IpcChannel.DAEMON_STATUS, handler),
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
};

contextBridge.exposeInMainWorld('spaceux', bridge);
