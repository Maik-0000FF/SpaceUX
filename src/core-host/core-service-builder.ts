// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Assemble the full {@link CoreService} for the headless core (#457 A2c) over a
 * {@link CoreState}. The shared LOGIC lives in the extracted pure modules;
 * this wires it to the live state + the effects that push changes out
 * (D-Bus signal emits). The
 * `CoreService` return annotation is the completeness check: every contract
 * method must be supplied or this fails to compile.
 *
 * Runtime takeover bits are Phase D: there is no live daemon here, so
 * GetDeviceInfo reports no device and SaveProfile reports "no device
 * connected"; SetInputSettings / SetDesktopSettings persist but don't
 * (un)grab / re-arm the interpreter. SetProfileOverride DOES re-resolve the
 * active menu source (plugin overlay / curated context file / menu.json) and
 * pushes DeviceInfo + MenuConfigChanged, mirroring main's applyActiveProfile —
 * the editor's source controls (#457 C5) need the switch even without a live
 * pie; only device profiles (the daemon's identity) wait for Phase D.
 */

import type { CoreSignalName } from '../shared/core-contract.js';
import type { EditorAction, ProfilesState } from '../shared/ipc.js';
import {
  PLUGIN_MENU_ID_PREFIX,
  isContextMenuId,
  isPluginMenuId,
  makeContextMenuId,
} from '../shared/plugin-types.js';
import { parsePluginKey } from '../shared/plugin-key.js';
import { resolveShapeModel, type MenuConfig } from '../shared/menu.js';
import type { ShapePluginModule } from '../shared/shape-plugin-api.js';
import type { PieAppearance } from '../shared/ipc.js';

import { createAppCoreService, type AppIpcDeps } from '../main/app-core-service.js';
import { appearanceToAppSettings, saveAppSettings } from '../main/app-settings.js';
import { BUILTIN_PLUGIN } from '../main/builtins/index.js';
import { seedContextFromCatalog } from '../main/context-ops.js';
import {
  deleteContextMenu,
  listContextMenus,
  loadContextMenu,
  resolveContextMenuConfig,
} from '../main/context-loader.js';
import { createEditorCoreService, type EditorIpcDeps } from '../main/editor-core-service.js';
import { loadMenuConfig, menuConfigSearchPaths } from '../main/menu-loader.js';
import { markSelfWrite, watchMenuConfig, watchProfiles } from '../main/menu-watcher.js';
import { importPlugin, uninstallPluginFlow } from '../main/plugin-install-ops.js';
import { createMainShapeModuleLoader } from '../main/shape-modules.js';
import { createLivePreview } from './live-preview.js';
import { createPieRuntime, type PieRuntime } from './pie-runtime.js';
import { createDesktopBackend, createSessionBusCall } from '../main/desktop-actions.js';
import { createSystemControlBackend } from '../main/system-control.js';
import { createDesktopInterpreter, type DesktopState } from '../main/desktop-interpreter.js';
import { createGrabArbiter } from '../main/grab-intent.js';
import { indexActions, loadPlugins } from '../main/plugin-loader.js';
import {
  deleteDeviceProfile,
  deviceProfileId,
  deviceProfilePath,
  deviceProfilesDir,
  isProfileId,
  listDeviceProfiles,
  loadDeviceProfile,
  resolveActiveConfig,
  resolvePluginMenuConfig,
  writeDeviceProfile,
  type ActiveMenuConfig,
} from '../main/profile-loader.js';
import { contextMenusDir } from '../main/context-loader.js';
import type { DaemonEvent } from '../shared/protocol.js';

import { createExtraCoreService } from './extra-core-service.js';
import type { CoreService, ProfileCoreService } from '../main/core-service.js';
import {
  getPluginBridge,
  getPluginCatalog,
  getPluginUninstallHook,
  installPluginBridge,
  performPluginUninstallHook,
  uninstallPluginBridge,
  type PluginRuntimeContext,
} from '../main/plugin-runtime.js';
import {
  cleanupShapeReferencesInSavedMenus,
  scanPluginUsageInSavedMenus,
} from '../main/plugin-usage.js';
import { buildPluginsState, listPluginMenus } from '../main/plugin-state.js';
import { readShapeSourceById } from '../main/shape-source.js';

import type { CoreState } from './core-state.js';

/** Emit a push signal; the payload is JSON-encoded by the server. */
export type EmitSignal = (signal: CoreSignalName, payload?: unknown) => void;

export type DesktopHooks = {
  isEnabled: () => boolean;
  /** The current effective state, for the initial tray icon at startup. */
  getState: () => DesktopState;
  /** Toggle desktop mode (the tray checkbox); broadcasts like any apply. */
  toggle: () => void;
  /** Subscribe to effective-state changes (off/active/suspended). */
  onState: (cb: (state: DesktopState) => void) => void;
  /** Subscribe to settings applies that may not move the state (checkbox). */
  onSettingsApplied: (cb: () => void) => void;
};

export function buildCoreService(
  state: CoreState,
  emit: EmitSignal,
): {
  service: CoreService;
  pieRuntime: PieRuntime;
  desktop: DesktopHooks;
  /** Orderly quit teardown: stop the desktop tick + drop its grab, close the
   *  daemon socket. The overlay child needs nothing here: it dies with the
   *  core via PR_SET_PDEATHSIG (see OverlayClient.spawnDaemon). */
  shutdown: () => void;
} {
  // Fresh per call so it reads the current plugins (a reload swaps them).
  const runtimeCtx = (): PluginRuntimeContext => ({
    loadedPlugins: state.loadedPlugins,
    daemon: state.daemon,
    pluginHost: state.pluginHost,
  });

  // Re-scan the function plugins + rebuild the action index, then signal the
  // editor via ActionsChanged.
  const reloadPlugins = async (): Promise<void> => {
    const { plugins, errors } = await loadPlugins('function');
    state.loadedPlugins = plugins;
    state.pluginErrors = errors;
    state.actionIndex = indexActions([BUILTIN_PLUGIN, ...plugins]);
    emit('ActionsChanged');
    pieRuntime.syncTriggerReservation();
  };

  const pluginInstallCtx = {
    daemon: state.daemon,
    pluginHost: state.pluginHost,
    getLoadedPlugins: () => state.loadedPlugins,
    getPluginErrors: () => state.pluginErrors,
    reloadPlugins,
    onInvalidated: (payload: { pluginId: string; kind: string }) => {
      emit('PluginInvalidated', payload);
      // Drop the cached shape module so a re-imported plugin reloads fresh.
      shapeLoader.clear(payload.pluginId);
    },
    // Removing a shape plugin clears what referenced it: the global appearance
    // (persist + push) plus every saved menu/profile/context override, then
    // the active source re-resolves so the editor adopts the stripped config.
    cleanupShapeRefs: async (pluginId: string) => {
      // Both layers: the live value (pushed) and the global one (persisted),
      // else the dead key survives in globalAppearance and returns the moment
      // a profile detaches. Profile-bundled appearances are stripped by the
      // saved-menus walk below.
      if (parsePluginKey(state.globalAppearance.shapeModel ?? '')?.pluginId === pluginId) {
        state.globalAppearance = { ...state.globalAppearance, shapeModel: null };
        void saveAppSettings(appearanceToAppSettings(state.globalAppearance));
      }
      if (parsePluginKey(state.pieAppearance.shapeModel ?? '')?.pluginId === pluginId) {
        state.pieAppearance = { ...state.pieAppearance, shapeModel: null };
        emit('PieAppearanceChanged', state.pieAppearance);
      }
      await cleanupShapeReferencesInSavedMenus(pluginId, state.defaultMenu);
      await applyActiveSource();
    },
  };

  // The preview's shape-plugin loader (#325 parity for the headless core):
  // resolves + dynamic-imports the active shape plugin's module so BuildScene
  // renders plugin nodes instead of wedges. Node data:-URL loader
  // (shape-modules.ts); invalidation above drops a re-imported/uninstalled
  // module.
  const shapeLoader = createMainShapeModuleLoader(readShapeSourceById);

  // One grab arbiter for every owner (#327/#402): the pie and the desktop
  // interpreter share it, so the device stays continuously grabbed across a
  // pie open while desktop mode holds it, and really releases only when
  // nothing wants it.
  const grabArbiter = createGrabArbiter({
    grab: () => state.daemon.grab(),
    release: () => state.daemon.release(),
  });

  // The editor's live preview (D5): resolved core-side off the same stream.
  // The real pie's trigger deliberately stays live alongside it.
  const livePreview = createLivePreview(state, emit);

  // The native pie runtime (D2): the live pie driven off the daemon stream.
  const pieRuntime = createPieRuntime(state, shapeLoader, grabArbiter);

  // The desktop-mode interpreter (D3, #199): scroll via the daemon's relative
  // pointer, zoom/volume via injected chords, workspace/overview/show-desktop
  // via the KDE D-Bus backend, button actions through the action index, and
  // the grab under the 'desktop' owner. State feedback blinks the LED (one
  // pulse = a button toggle, two = a config change); the tray lands with the
  // lifecycle slice.
  const desktopInterpreter = createDesktopInterpreter(
    {
      injectScroll: (dx, dy) => state.daemon.injectScroll(dx, dy),
      injectChord: (modifiers, key) => state.daemon.injectChord(modifiers, key),
      systemControl: createSystemControlBackend(state.hostEnvironment.desktop, {
        injectChord: (modifiers, key) => state.daemon.injectChord(modifiers, key),
        injectAvailable: () => state.daemon.isInjectAvailable(),
      }),
      backend: createDesktopBackend(state.hostEnvironment.desktop, createSessionBusCall()),
      runAction: (id, config) => pieRuntime.dispatchAction(id, config),
      acquireGrab: () => grabArbiter.acquire('desktop'),
      releaseGrab: () => grabArbiter.release('desktop'),
      onStateChanged: (st, cause) => {
        if (cause === 'button') pieRuntime.blinkLed(1);
        else if (cause === 'config') pieRuntime.blinkLed(2);
        for (const cb of desktopStateListeners) cb(st);
      },
    },
    state.desktopSettings,
  );
  pieRuntime.setDesktopInterpreter(desktopInterpreter);

  // Tray hooks (D4): the SNI tray subscribes to state changes and settings
  // applies, and toggles desktop mode through the same apply path the editor
  // uses (persist, re-arm, broadcast).
  const desktopStateListeners: ((st: DesktopState) => void)[] = [];
  const desktopApplyListeners: (() => void)[] = [];

  const applyDesktopSettings = (settings: typeof state.desktopSettings): void => {
    state.desktopSettings = settings;
    void saveAppSettings({ desktop: settings });
    desktopInterpreter.setSettings(settings);
    emit('DesktopSettingsChanged', settings);
    for (const cb of desktopApplyListeners) cb();
  };

  // The active shape module for a scene build, or null for the wedge default:
  // the per-menu override resolves against the app-level appearance default
  // (resolveShapeModel's precedence).
  const activeShapeModule = async (
    config: MenuConfig,
    appearance: PieAppearance,
  ): Promise<ShapePluginModule | null> => {
    const key = resolveShapeModel(config.shapeModel, appearance.shapeModel ?? null);
    if (key === null) return null;
    const pluginId = parsePluginKey(key)?.pluginId ?? null;
    if (pluginId === null) return null;
    await shapeLoader.ensureLoaded(pluginId);
    return shapeLoader.get(pluginId);
  };

  const profilesSnapshot = async (): Promise<ProfilesState> => ({
    ids: await listDeviceProfiles(),
    override: state.overrideProfileId,
    pluginMenus: listPluginMenus(state.loadedPlugins),
  });

  /** The active source as a *device profile* id, or null (no profile, or a
   *  plugin / curated source): only then do appearance edits persist into the
   *  profile file instead of the global app-settings (#113). */
  const activeDeviceProfileId = (): string | null =>
    state.activeProfileId !== null && isProfileId(state.activeProfileId)
      ? state.activeProfileId
      : null;

  const appDeps: AppIpcDeps = {
    getAppearance: () => state.pieAppearance,
    setAppearance: (patch) => {
      state.pieAppearance = { ...state.pieAppearance, ...patch };
      // Where the edit persists mirrors main (#113): into the active device
      // profile's file when one is active (self-write guarded), else into the
      // global app-settings — tracked separately in globalAppearance so a
      // profile's bundled look can't leak into the global settings and a
      // later profile detach restores the user's own edits.
      const profId = activeDeviceProfileId();
      if (profId !== null) {
        markSelfWrite(deviceProfilePath(profId));
        void writeDeviceProfile(profId, state.menuConfig, state.pieAppearance).then((result) => {
          if (result.ok !== true)
            // eslint-disable-next-line no-console
            console.warn(`[profile] failed to save appearance into ${profId}`);
        });
      } else {
        state.globalAppearance = { ...state.globalAppearance, ...patch };
        void saveAppSettings(appearanceToAppSettings(state.globalAppearance));
      }
      emit('PieAppearanceChanged', state.pieAppearance);
      pieRuntime.pushAppearanceIfOpen();
    },
    getInputSettings: () => state.inputSettings,
    setInputSettings: (patch) => {
      state.inputSettings = { ...state.inputSettings, ...patch };
      void saveAppSettings({ grabWhilePieOpen: state.inputSettings.grabWhilePieOpen });
      // Apply live: an open pie (un)grabs to match instead of waiting for the
      // next open (#402, main's behaviour).
      pieRuntime.applyGrabSetting();
    },
    getDesktopSettings: () => state.desktopSettings,
    // Re-arms the interpreter live (#199): an enable/disable, a preset or an
    // axis change applies without a restart.
    setDesktopSettings: (settings) => applyDesktopSettings(settings),
  };

  const editorDeps: EditorIpcDeps = {
    hostEnvironment: state.hostEnvironment,
    getConfig: () => state.menuConfig,
    getMtime: () => state.menuConfigMtime,
    getDefaultConfig: () => state.defaultMenu,
    getWriteTarget: () =>
      state.overrideProfileId !== null && isPluginMenuId(state.overrideProfileId)
        ? undefined
        : (state.menuConfigSource ?? menuConfigSearchPaths()[0]),
    applyWrite: (config, mtime, target) => {
      state.menuConfig = config;
      state.menuConfigMtime = mtime;
      state.menuConfigSource = target;
      emit('MenuConfigChanged', { config, mtime });
      // An editor save under an open pie shows at once (#339), and the
      // trigger button may have moved (#191).
      pieRuntime.pushMenuIfOpen();
      pieRuntime.syncTriggerReservation();
    },
    listActions: (): EditorAction[] =>
      Object.entries(state.actionIndex).map(([id, { plugin, descriptor }]) => ({
        id,
        label: descriptor.label,
        source: plugin.manifest.name,
        description: descriptor.description,
        config: descriptor.config,
      })),
    getPlugins: () => buildPluginsState(state.loadedPlugins, state.pluginErrors),
    importPlugin: (srcDir) => importPlugin(srcDir, pluginInstallCtx),
    uninstallPlugin: (kind, id) =>
      uninstallPluginFlow(kind, id, pluginInstallCtx, state.pendingUninstallPerforms),
    scanPluginUsages: (pluginId, kind) =>
      scanPluginUsageInSavedMenus(pluginId, kind, state.pieAppearance, state.defaultMenu),
    getShapeSource: (pluginId) => readShapeSourceById(pluginId),
    getPluginUninstallHook: (pluginId) =>
      getPluginUninstallHook(pluginId, runtimeCtx(), state.pendingUninstallPerforms),
    performPluginUninstallHook: (pluginId) =>
      performPluginUninstallHook(pluginId, state.pendingUninstallPerforms),
    getPluginCatalog: (pluginId, loadAll) => getPluginCatalog(pluginId, loadAll, runtimeCtx()),
    getContextMenus: () => listContextMenus(),
    seedContext: (pluginId, contextKey, overwrite) =>
      seedContextFromCatalog(pluginId, contextKey, overwrite, runtimeCtx(), state.menuConfig),
    deleteContext: async (pluginId, contextKey) => {
      const id = makeContextMenuId(pluginId, contextKey);
      const result = await deleteContextMenu(id);
      if (!result.ok) return result;
      if (state.overrideProfileId === id) {
        state.overrideProfileId = null;
        await applyActiveSource();
        emit('ProfilesChanged', await profilesSnapshot());
      }
      return { ok: true };
    },
    getPluginBridge: (pluginId) => getPluginBridge(pluginId, runtimeCtx()),
    installPluginBridge: (pluginId) => installPluginBridge(pluginId, runtimeCtx()),
    uninstallPluginBridge: (pluginId) => uninstallPluginBridge(pluginId, runtimeCtx()),
  };

  // The connected device's identity (from the daemon) + the EFFECTIVE active
  // source id (override, device profile, plugin/ctx, or null = fallback).
  const deviceInfo = () => ({
    buttons: state.deviceButtons,
    vendor: state.deviceVendor,
    product: state.deviceProduct,
    name: state.deviceName,
    profileId: state.activeProfileId,
    daemonConnected: state.daemonConnected,
  });

  /** The profile id to load: a manual override wins over the connected
   *  device's auto-detected id (#113). */
  const resolveProfileId = (): string | null =>
    state.overrideProfileId ?? deviceProfileId(state.deviceVendor, state.deviceProduct);

  // Apply a profile's bundled appearance, or restore the global one when it
  // has none (the #113 per-device appearance swap); pushed when it changed.
  const applyActiveAppearance = (bundled: PieAppearance | null): void => {
    const next = bundled ?? state.globalAppearance;
    if (JSON.stringify(next) === JSON.stringify(state.pieAppearance)) return;
    state.pieAppearance = next;
    emit('PieAppearanceChanged', state.pieAppearance);
    pieRuntime.pushAppearanceIfOpen();
  };

  // Re-resolve the active menu source after an override switch, the headless
  // mirror of main's applyActiveProfile: a `plugin:` id overlays the plugin's
  // static menu root onto the user's base config (read-only: no write target),
  // a `ctx:` id loads the curated file (writable), null reloads menu.json. A
  // gone target (uninstalled plugin / unseeded context) drops the override and
  // re-resolves. Pushes DeviceInfo first (the editor's read-only banner reads
  // the source id), then the config.
  async function applyActiveSource(): Promise<void> {
    const id = resolveProfileId();
    let next: ActiveMenuConfig;
    if (id !== null && isContextMenuId(id)) {
      const load = await loadContextMenu(id);
      if (resolveProfileId() !== id) return; // a newer switch landed
      const resolved = resolveContextMenuConfig(id, load);
      if (resolved === null) {
        state.overrideProfileId = null;
        return applyActiveSource();
      }
      next = resolved;
    } else if (id !== null && isProfileId(id)) {
      // A device profile (auto-detected or overridden, #113): its file wins;
      // absent/invalid falls back like main's resolveActiveConfig.
      const prof = await loadDeviceProfile(id);
      if (resolveProfileId() !== id) return;
      const fallback = await loadMenuConfig(menuConfigSearchPaths(), state.defaultMenu);
      next = resolveActiveConfig(id, prof, fallback);
    } else {
      const menu = await loadMenuConfig(menuConfigSearchPaths(), state.defaultMenu);
      if (resolveProfileId() !== id) return;
      if (id !== null && isPluginMenuId(id)) {
        const pid = id.slice(PLUGIN_MENU_ID_PREFIX.length);
        const root =
          state.loadedPlugins.find((p) => p.manifest.id === pid)?.manifest.menu?.root ?? null;
        if (root === null) {
          state.overrideProfileId = null;
          return applyActiveSource();
        }
        next = resolvePluginMenuConfig(root, menu, id);
      } else {
        next = { ...menu, profileId: null, appearance: null };
      }
    }
    state.menuConfig = next.config;
    state.menuConfigMtime = next.mtime;
    state.menuConfigSource = next.source;
    state.activeProfileId = next.profileId;
    applyActiveAppearance(next.appearance);
    emit('DeviceInfo', deviceInfo());
    emit('MenuConfigChanged', { config: next.config, mtime: next.mtime });
    pieRuntime.pushMenuIfOpen();
    pieRuntime.syncTriggerReservation();
  }

  // ── Daemon (D1): identity + hotplug. Axes/button events feed the pie
  // runtime (D2), the desktop interpreter (D3) and the editor live preview
  // (D5); until those land they are ignored here.
  const setDeviceInfo = (buttons: number, vendor: number, product: number, name: string): void => {
    const idChanged = vendor !== state.deviceVendor || product !== state.deviceProduct;
    const countChanged = buttons !== state.deviceButtons;
    state.deviceButtons = buttons;
    state.deviceVendor = vendor;
    state.deviceProduct = product;
    state.deviceName = name;
    if (idChanged) void applyActiveSource();
    else if (countChanged) emit('DeviceInfo', deviceInfo());
  };

  state.daemon.on('connected', () => {
    state.daemonConnected = true;
    state.daemon.subscribeAll();
    // Re-assert the grab if a pie is open across a daemon reconnect (#327).
    pieRuntime.reapplyGrab();
    emit('DeviceInfo', deviceInfo());
  });
  state.daemon.on('event', (ev: DaemonEvent) => {
    if (ev.event === 'hello' || ev.event === 'device')
      setDeviceInfo(ev.buttons, ev.vendor ?? 0, ev.product ?? 0, ev.name ?? '');
    switch (ev.event) {
      case 'axes':
        // The native pie navigation runs off the live axes (no-op unless a
        // pie is open); desktop mode and the editor's live preview ride the
        // same stream (each gated on its own state).
        pieRuntime.onAxes(ev.values);
        desktopInterpreter.onAxes(ev.values);
        livePreview.onAxes(ev.values);
        break;
      case 'button':
        pieRuntime.onButton(ev.bnum, ev.pressed);
        desktopInterpreter.onButton(ev.bnum, ev.pressed);
        livePreview.onButton(ev.bnum, ev.pressed);
        break;
    }
  });
  state.daemon.on('disconnected', () => {
    state.daemonConnected = false;
    setDeviceInfo(0, 0, 0, '');
    // setDeviceInfo only pushes on an identity/count change; with no device
    // attached nothing changes there, yet the dot must still flip from
    // "no device" to "daemon off". Push the socket-state change itself (a
    // duplicate push when the identity also changed is harmless).
    emit('DeviceInfo', deviceInfo());
  });
  state.daemon.on('error', (err: Error) => {
    // ECONNREFUSED while the daemon isn't running is normal in development.
    // eslint-disable-next-line no-console
    console.warn(`[daemon] ${err.message}`);
  });
  state.daemon.start();
  pieRuntime.syncTriggerReservation();

  // External changes in the profiles / context-menus dirs (#113/#193): the
  // editor's own writes are filtered by markSelfWrite; refresh the lists and
  // re-resolve when the active source lives in the changed dir.
  watchProfiles(deviceProfilesDir(), () => {
    void (async () => {
      emit('ProfilesChanged', await profilesSnapshot());
      const id = resolveProfileId();
      if (id !== null && isProfileId(id)) await applyActiveSource();
    })();
  });
  watchProfiles(contextMenusDir(), () => {
    void (async () => {
      emit('ContextMenusChanged', { ids: await listContextMenus() });
      const id = resolveProfileId();
      if (id !== null && isContextMenuId(id)) await applyActiveSource();
    })();
  });

  // External menu.json edits (another editor instance, a text editor)
  // reconcile like in main: the watcher debounces, filters the editor's own
  // writes (markSelfWrite in the write path), and re-resolves + pushes. Only
  // the fallback source needs watching: an override (ctx:/plugin:) re-resolves
  // through its own flows. Process-lifetime watcher; no teardown needed.
  watchMenuConfig(menuConfigSearchPaths(), () => {
    if (state.overrideProfileId !== null) return;
    void applyActiveSource();
  });

  const profileCoreService: ProfileCoreService = {
    GetDeviceInfo: () => deviceInfo(),
    GetProfiles: () => profilesSnapshot(),
    SetProfileOverride: async (id) => {
      if (id !== null && !(isProfileId(id) || isPluginMenuId(id) || isContextMenuId(id))) {
        return;
      }
      state.overrideProfileId = id;
      await applyActiveSource();
      emit('ProfilesChanged', await profilesSnapshot());
    },
    SaveProfile: async () => {
      const id = deviceProfileId(state.deviceVendor, state.deviceProduct);
      if (!id) return { ok: false as const, reason: 'no device connected' };
      markSelfWrite(deviceProfilePath(id));
      const result = await writeDeviceProfile(id, state.menuConfig, state.pieAppearance);
      if (result.ok !== true) {
        return {
          ok: false as const,
          reason: result.ok === 'conflict' ? 'write conflict' : result.reason,
        };
      }
      await applyActiveSource();
      emit('ProfilesChanged', await profilesSnapshot());
      return { ok: true as const };
    },
    DeleteProfile: async (id) => {
      if (!isProfileId(id)) return { ok: false, reason: 'invalid id' };
      markSelfWrite(deviceProfilePath(id));
      const result = await deleteDeviceProfile(id);
      if (!result.ok) return result;
      if (state.overrideProfileId === id) state.overrideProfileId = null;
      await applyActiveSource();
      emit('ProfilesChanged', await profilesSnapshot());
      return { ok: true };
    },
  };

  const service: CoreService = {
    ...createAppCoreService(appDeps),
    ...createEditorCoreService(editorDeps),
    ...profileCoreService,
    ...createExtraCoreService({
      hostEnvironment: state.hostEnvironment,
      shapeModule: activeShapeModule,
      live: livePreview,
    }),
  };
  return {
    service,
    pieRuntime,
    desktop: {
      isEnabled: () => state.desktopSettings.enabled,
      getState: () => desktopInterpreter.getState(),
      toggle: () =>
        applyDesktopSettings({ ...state.desktopSettings, enabled: !state.desktopSettings.enabled }),
      onState: (cb) => desktopStateListeners.push(cb),
      onSettingsApplied: (cb) => desktopApplyListeners.push(cb),
    },
    shutdown: () => {
      // Orderly RELEASE before the socket closes, so the device ungrabs the
      // moment the core quits rather than via the daemon's disconnect
      // reconcile (socket.c clears a gone client's grab intent either way).
      desktopInterpreter.dispose();
      state.daemon.stop();
    },
  };
}
