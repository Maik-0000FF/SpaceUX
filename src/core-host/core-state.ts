// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The core's live service state + first-run load (#457 A2c): config, plugins,
 * appearance, profiles and device identity, loaded once at startup. The fields
 * are mutable: the deps built over this state reassign them (a reload swaps
 * the plugins + action index; a setting edit updates its value).
 */

import type {
  DesktopSettings,
  InputSettings,
  PieAppearance,
  ProfileActionResult,
} from '../shared/ipc.js';
import type { MenuConfig } from '../shared/menu.js';
import type { PluginHostCapabilities } from '../shared/plugin-types.js';

import { loadDesktopSettings, loadInputSettings, loadPieAppearance } from '../main/app-settings.js';
import { BUILTIN_PLUGIN } from '../main/builtins/index.js';
import { DaemonClient } from '../main/daemon-client.js';
import { buildDefaultMenu } from '../main/default-menu.js';
import { readHostEnvironment } from '../main/desktop-env.js';
import { loadMenuConfig, menuConfigSearchPaths } from '../main/menu-loader.js';
import { indexActions, loadPlugins, type LoadedPlugin } from '../main/plugin-loader.js';
import { resourcePath } from '../main/resources.js';
import { refreshShapeManifestCache } from '../main/shape-source.js';

export interface CoreState {
  readonly hostEnvironment: ReturnType<typeof readHostEnvironment>;
  readonly daemon: DaemonClient;
  readonly pluginHost: PluginHostCapabilities;
  loadedPlugins: LoadedPlugin[];
  pluginErrors: { dir: string; reason: string }[];
  actionIndex: ReturnType<typeof indexActions>;
  defaultMenu: MenuConfig;
  menuConfig: MenuConfig;
  menuConfigMtime: number | null;
  menuConfigSource: string | null;
  pieAppearance: PieAppearance;
  inputSettings: InputSettings;
  desktopSettings: DesktopSettings;
  /** Uninstall-hook perform-closure cache, keyed by plugin id (#267). */
  readonly pendingUninstallPerforms: Map<string, () => Promise<ProfileActionResult>>;
  /** Manual profile override, or null for device auto-detect. */
  overrideProfileId: string | null;
  /** The EFFECTIVE active source id (override, device profile, plugin/ctx),
   *  or null for the menu.json fallback; what GetDeviceInfo reports. */
  activeProfileId: string | null;
  /** Connected device identity from the daemon (0/'' = none). */
  deviceButtons: number;
  deviceVendor: number;
  deviceProduct: number;
  deviceName: string;
  /** The daemon socket is up (independent of a device being attached). */
  daemonConnected: boolean;
  /** The app-settings appearance, kept apart from the live one so a device
   *  profile's bundled appearance can swap in and back out (#113). */
  globalAppearance: PieAppearance;
}

/** Load the service state headless: plugins + action index, the icon-enriched
 *  default menu + the active menu config, and the persisted app settings. */
export async function loadCoreState(): Promise<CoreState> {
  const hostEnvironment = readHostEnvironment();
  const pluginHost: PluginHostCapabilities = { environment: hostEnvironment };

  const { plugins, errors } = await loadPlugins('function');
  const actionIndex = indexActions([BUILTIN_PLUGIN, ...plugins]);
  await refreshShapeManifestCache();

  const defaultMenu = await buildDefaultMenu(
    hostEnvironment,
    resourcePath('assets', 'emoji', '1f44b.svg'),
  );
  const menu = await loadMenuConfig(menuConfigSearchPaths(), defaultMenu);
  const appearance = await loadPieAppearance();

  return {
    hostEnvironment,
    daemon: new DaemonClient(),
    pluginHost,
    loadedPlugins: plugins,
    pluginErrors: errors,
    actionIndex,
    defaultMenu,
    menuConfig: menu.config,
    menuConfigMtime: menu.mtime,
    menuConfigSource: menu.source,
    pieAppearance: appearance,
    globalAppearance: appearance,
    inputSettings: await loadInputSettings(),
    desktopSettings: await loadDesktopSettings(),
    pendingUninstallPerforms: new Map(),
    overrideProfileId: null,
    activeProfileId: null,
    deviceButtons: 0,
    deviceVendor: 0,
    deviceProduct: 0,
    deviceName: '',
    daemonConnected: false,
  };
}
