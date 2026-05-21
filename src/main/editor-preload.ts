// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { AxesValues, ButtonEventPayload, EditorBridge } from '../shared/bridge.js';
import {
  IpcChannel,
  type EditorDeviceInfo,
  type MenuConfigSnapshot,
  type MenuWriteResult,
  type PieAppearance,
  type ProfileActionResult,
  type ProfilesState,
  type ThemeChoice,
} from '../shared/ipc.js';
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
  getTheme: () => ipcRenderer.invoke(IpcChannel.EDITOR_GET_THEME) as Promise<ThemeChoice>,
  setTheme: (theme: ThemeChoice) => ipcRenderer.send(IpcChannel.EDITOR_SET_THEME, theme),
  pickFile: () => ipcRenderer.invoke(IpcChannel.EDITOR_PICK_FILE) as Promise<string | null>,
  onAxes: (handler) => {
    const listener = (_evt: IpcRendererEvent, values: AxesValues) => handler(values);
    ipcRenderer.on(IpcChannel.EDITOR_AXES, listener);
    return () => ipcRenderer.off(IpcChannel.EDITOR_AXES, listener);
  },
  onButton: (handler) => {
    const listener = (_evt: IpcRendererEvent, payload: ButtonEventPayload) => handler(payload);
    ipcRenderer.on(IpcChannel.EDITOR_BUTTON, listener);
    return () => ipcRenderer.off(IpcChannel.EDITOR_BUTTON, listener);
  },
  setLive: (on: boolean) => ipcRenderer.send(IpcChannel.EDITOR_LIVE, on),
  getDeviceInfo: () =>
    ipcRenderer.invoke(IpcChannel.EDITOR_GET_DEVICE) as Promise<EditorDeviceInfo>,
  onDeviceInfo: (handler) => {
    const listener = (_evt: IpcRendererEvent, info: EditorDeviceInfo) => handler(info);
    ipcRenderer.on(IpcChannel.EDITOR_DEVICE, listener);
    return () => ipcRenderer.off(IpcChannel.EDITOR_DEVICE, listener);
  },
  getProfiles: () => ipcRenderer.invoke(IpcChannel.EDITOR_GET_PROFILES) as Promise<ProfilesState>,
  onProfilesChanged: (handler) => {
    const listener = (_evt: IpcRendererEvent, state: ProfilesState) => handler(state);
    ipcRenderer.on(IpcChannel.EDITOR_PROFILES_CHANGED, listener);
    return () => ipcRenderer.off(IpcChannel.EDITOR_PROFILES_CHANGED, listener);
  },
  setProfileOverride: (id: string | null) =>
    ipcRenderer.invoke(IpcChannel.EDITOR_SET_PROFILE_OVERRIDE, id) as Promise<void>,
  saveProfile: () =>
    ipcRenderer.invoke(IpcChannel.EDITOR_SAVE_PROFILE) as Promise<ProfileActionResult>,
  deleteProfile: (id: string) =>
    ipcRenderer.invoke(IpcChannel.EDITOR_DELETE_PROFILE, id) as Promise<ProfileActionResult>,
  getPieAppearance: () =>
    ipcRenderer.invoke(IpcChannel.GET_PIE_APPEARANCE) as Promise<PieAppearance>,
  setPieAppearance: (patch) => ipcRenderer.send(IpcChannel.SET_PIE_APPEARANCE, patch),
  onPieAppearanceChanged: (handler) => {
    const listener = (_evt: IpcRendererEvent, appearance: PieAppearance) => handler(appearance);
    ipcRenderer.on(IpcChannel.PIE_APPEARANCE_CHANGED, listener);
    return () => ipcRenderer.off(IpcChannel.PIE_APPEARANCE_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld('editor', bridge);
