// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeError } from '../shared/errors.js';
import {
  IpcChannel,
  type ConfigChangeCause,
  type DaemonStatusPayload,
  type EditorDeviceInfo,
  type MenuConfigChange,
  type WorkbenchMenusState,
  type MenuOpenPayload,
  type PieAppearance,
  type PieBadges,
  type FreecadBridgeStatus,
  type PluginInfo,
  type PluginInvalidatedPayload,
  type PluginsState,
  type ProfileActionResult,
  type ProfilesState,
} from '../shared/ipc.js';
import {
  DEFAULT_MENU_CONFIG,
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  validateNode,
  type MenuConfig,
  type MenuNode,
} from '../shared/menu.js';
import { DEFAULT_PIE_APPEARANCE } from '../shared/pie-appearance.js';
import type { DaemonEvent } from '../shared/protocol.js';

import { wireAppIpc } from './app-ipc.js';
import { loadPieAppearance, saveAppSettings, saveAppSettingsSync } from './app-settings.js';
import { BUILTIN_PLUGIN } from './builtins/index.js';
import { DaemonClient } from './daemon-client.js';
import { wireEditorIpc } from './editor-ipc.js';
import {
  isEditorLive,
  isEditorLiveFocused,
  sendToEditor,
  setAppQuitting,
} from './editor-window.js';
import { KWinCursorService } from './kwin-cursor.js';
import { loadMenuConfig, menuConfigSearchPaths, type MenuLoadResult } from './menu-loader.js';
import { markSelfWrite, watchMenuConfig, watchProfiles } from './menu-watcher.js';
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
  writeDeviceProfileSync,
  type ActiveMenuConfig,
  type ProfileLoadResult,
} from './profile-loader.js';
import {
  indexActions,
  loadPluginManifests,
  loadPlugins,
  makeActionContext,
  userExtensionsRoot,
  type InstalledPlugin,
  type LoadedPlugin,
} from './plugin-loader.js';
import { importPluginFromFolder, uninstallPlugin } from './plugin-installer.js';
import { scanPluginUsage, type MenuRef } from './plugin-usage-scan.js';
import {
  PLUGIN_MENU_ID_PREFIX,
  isPluginMenuId,
  isWorkbenchMenuId,
  makeWorkbenchMenuId,
  type PluginCatalog,
  type PluginHostCapabilities,
  type PluginManifest,
} from '../shared/plugin-types.js';
import {
  deleteWorkbenchMenu,
  listWorkbenchMenus,
  loadWorkbenchMenu,
  resolveWorkbenchMenuConfig,
  seedWorkbenchConfig,
  workbenchMenuPath,
  workbenchMenusDir,
  writeWorkbenchMenu,
} from './workbench-loader.js';
import { MAX_ICON_BYTES, sanitizeSvg } from '../core/icon.js';
import {
  bridgeInstalledAt,
  installBridge,
  resolveFreecadModDir,
  uninstallBridge,
} from './freecad-bridge.js';
import { parseOverlayMode } from './overlay-mode.js';
import { resourcePath } from './resources.js';
import { createTray } from './tray.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev mode hands Vite the renderer; in production we load the built
// index.html from disk. The env var is the same one Vite's electron
// templates use so future tooling Just Works.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Overlay mode is the production look: transparent, frameless,
// click-through, hidden until the trigger button fires. True for
// packaged installs by default; setting SPACEUX_OVERLAY_MODE=1
// forces the same look in an unpackaged dev run so the production
// overlay surface can be tested without electron-builder packaging.
// SPACEUX_OVERLAY_MODE=debug is the same overlay surface but keeps the dev
// chrome on (daemon-status banner + axis/debug panel) so the puck orientation
// can be watched while the floating pie is operated; that chrome only shows
// while the pie is open, since the overlay window is hidden between triggers.
//
// The env value is parsed (see parseOverlayMode) rather than Boolean-coerced,
// so =0 / =false / =off read as off instead of as truthy non-empty strings.
const overlay = parseOverlayMode(process.env.SPACEUX_OVERLAY_MODE);
const OVERLAY_MODE = app.isPackaged || overlay.requested;
const OVERLAY_DEBUG = overlay.debug;

// Caps the dev-mode framed window so it fits on a typical laptop
// display without forcing the developer to alt-drag it smaller.
// Overlay mode ignores these — the window covers the full display
// under the cursor.
const DEV_WINDOW_MAX_WIDTH = 900;
const DEV_WINDOW_MAX_HEIGHT = 700;

// On KDE Plasma Wayland, Electron's screen.getCursorScreenPoint()
// is frozen (Wayland forbids clients from polling the global
// cursor). We round-trip through a KWin script over DBus when this
// flag is true. Other Wayland compositors (GNOME, Hyprland, ...)
// need their own backends; X11 doesn't need one because the
// Electron API works there.
const IS_KDE_WAYLAND =
  process.platform === 'linux' &&
  process.env.XDG_SESSION_TYPE === 'wayland' &&
  (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().includes('kde');

let mainWindow: BrowserWindow | null = null;
let kwinCursor: KWinCursorService | null = null;
const daemon = new DaemonClient();
let actionIndex: ReturnType<typeof indexActions> = {};
// Loaded `function` plugins + their load errors. Kept so the editor's
// plugin manager can rebuild the action index after an import/uninstall
// without an app restart.
let loadedPlugins: LoadedPlugin[] = [];
let pluginErrors: { dir: string; reason: string }[] = [];
// Cached shape-plugin manifests, keyed by plugin id. Populated at startup
// and refreshed by every `buildPluginsState` (which runs on import / uninstall
// and on each editor `getPlugins` IPC), so the handler that resolves a shape
// source by id can do an O(1) lookup instead of re-walking the extensions
// tree on every pull. Mirrors `loadedPlugins` for the function kind.
let loadedShapeManifests: Map<string, InstalledPlugin> = new Map();
let shapeLoadErrors: { dir: string; reason: string }[] = [];

/** Current FreeCAD bridge addon status. Single point so the editor IPC
 *  handler, the bridge installer flow, and a plugin's host-capabilities
 *  surface (#267) all see one shape. */
function freecadBridgeStatus(): FreecadBridgeStatus {
  const r = resolveFreecadModDir();
  return r.ok
    ? {
        resolved: true,
        modDir: r.modDir,
        label: r.label,
        installed: bridgeInstalledAt(r.modDir),
      }
    : { resolved: false, reason: r.reason, sandbox: r.sandbox };
}

/** Remove the FreeCAD bridge addon from the resolved Mod dir. Returns a
 *  reason when the Mod dir couldn't be resolved (no FreeCAD found,
 *  sandbox); a missing addon dir resolves to `ok:true`. */
async function freecadBridgeUninstall(): Promise<ProfileActionResult> {
  const r = resolveFreecadModDir();
  if (!r.ok) return { ok: false, reason: r.reason };
  return uninstallBridge(r.modDir);
}

/** Host-side capabilities every plugin's {@link ActionContext} receives. A
 *  single shared object so a plugin lifecycle hook (today: `provideUninstall`
 *  for FreeCAD, #267) goes through the same surface as the editor IPCs. */
const pluginHost: PluginHostCapabilities = {
  freecadBridge: {
    getStatus: freecadBridgeStatus,
    uninstall: freecadBridgeUninstall,
  },
};

/** Cached perform-closures from plugin `provideUninstall(ctx)` hooks (#267).
 *  Populated by the EDITOR_GET_PLUGIN_UNINSTALL_HOOK handler; consumed by
 *  EDITOR_PERFORM_PLUGIN_UNINSTALL_HOOK. The renderer asks for the
 *  descriptor, shows the user-facing confirm, and then asks main to run the
 *  cached closure on confirmation. Cleared on every plugin-uninstall
 *  invocation (whether the renderer ran the perform or the user cancelled
 *  the second confirm) so a cancelled prompt doesn't retain the closure
 *  across the plugin's own lifecycle. */
const pendingUninstallPerforms = new Map<string, () => Promise<ProfileActionResult>>();
// The *active* menu config — either the global menu.json (fallback) or
// the connected device's profile (#113). Conflict-detection + write-back
// state for the editor: `mtime` is the on-disk mtime the active config
// was last read/written at; `source` is the file it came from (null =
// running on defaults, never saved). `searchPaths` is captured at startup
// so a write can fall back to the preferred XDG path when nothing's saved.
let menuConfig: MenuConfig | null = null;
let menuConfigMtime: number | null = null;
let menuConfigSource: string | null = null;
let menuSearchPaths: string[] = [];
let stopMenuWatcher: (() => void) | null = null;
let stopProfileWatcher: (() => void) | null = null;
let stopWorkbenchWatcher: (() => void) | null = null;

// The global fallback config (the menu.json load result), kept live by the
// watcher. The active `menuConfig` above is this whenever no device profile
// applies; when a profile is active we keep this cached so disconnecting the
// device restores it without a re-read. Set at startup.
let fallbackMenu: MenuLoadResult | null = null;
// Id of the profile currently driving the active config, or null when the
// fallback is active (#113).
let activeProfileId: string | null = null;
// Manual override set from the editor: a profile id force-loaded by the
// user, taking priority over the connected device's auto-detected profile.
// null = "Auto" (auto-detect). The resolution priority is:
//   override → connected device's profile → global menu.json fallback.
let overrideProfileId: string | null = null;

// Latest device the daemon reported (0 / "" when none). `buttons` is pulled
// by the editor on mount so its pickers only offer existing buttons (#66)
// and pushed live on a hotplug swap (PR 2b); `vendor`/`product` key the
// per-device profile and a change of identity triggers a profile switch
// (#113); `name` labels the active device (surfaced in the editor in PR 3).
let deviceButtonCount = 0;
let deviceVendor = 0;
let deviceProduct = 0;
let deviceName = '';

/** Push the current device (count + identity + active profile id) to the
 *  editor (#66, #113). The editor re-clamps its pickers and updates its
 *  active-device/profile display. Only called on a real device/profile
 *  transition, so there are no redundant same-value pushes to dedupe. */
function pushEditorDevice(): void {
  sendToEditor(IpcChannel.EDITOR_DEVICE, {
    buttons: deviceButtonCount,
    vendor: deviceVendor,
    product: deviceProduct,
    name: deviceName,
    profileId: activeProfileId,
  } satisfies EditorDeviceInfo);
}

/** Map a loaded/installed plugin to the editor-facing {@link PluginInfo}. */
/** Bake a plugin's badge icon (#186) into a data URI for the renderers, or
 *  undefined when there's none / it can't be read. SVG only for now (the badge
 *  is a vector app icon); sanitised + size-guarded like a picked node icon. */
function bakeBadge(dir: string, badge: string | undefined): string | undefined {
  if (badge === undefined || !badge.toLowerCase().endsWith('.svg')) return undefined;
  // Confine the badge to the plugin dir — a manifest `badge: "../../x.svg"`
  // must not read an arbitrary file (consistency with workbench-loader; the
  // plugin is trusted, but keep the path contained anyway).
  const base = path.resolve(dir);
  const file = path.resolve(base, badge);
  if (file !== base && !file.startsWith(base + path.sep)) return undefined;
  try {
    const raw = fsSync.readFileSync(file, 'utf8');
    if (Buffer.byteLength(raw) > MAX_ICON_BYTES) return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(sanitizeSvg(raw)).toString('base64')}`;
  } catch {
    return undefined;
  }
}

function toPluginInfo(manifest: PluginManifest, dir: string, hasCatalog = false): PluginInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    dir,
    // Removable only when it lives in the user-writable managed dir (imported);
    // a repo-dev / system plugin isn't deletable from here (#221).
    removable: dir === userExtensionsRoot() || dir.startsWith(userExtensionsRoot() + path.sep),
    actionCount: manifest.actions?.length ?? 0,
    hasCatalog,
    badge: bakeBadge(dir, manifest.badge),
    // Nav-style plugins ship presets via the manifest (no index.js is loaded);
    // forwarded as-is so the editor's picker can merge them with built-ins.
    navStylePresets: manifest.kind === 'nav-style' ? manifest.presets : undefined,
    // Shape plugins (#107) ship one shape descriptor (the entry source is
    // pulled lazily in PR2's renderer runtime, not embedded here).
    shape: manifest.kind === 'shape' ? manifest.shape : undefined,
  };
}

/** Rebuild the shape-manifest cache from disk. Called on startup and from
 *  every `buildPluginsState` so import / uninstall changes propagate without
 *  needing a separate invalidation step on the call sites. */
async function refreshShapeManifestCache(): Promise<void> {
  const { plugins, errors } = await loadPluginManifests('shape');
  loadedShapeManifests = new Map(plugins.map((p) => [p.manifest.id, p]));
  shapeLoadErrors = errors;
}

/** Broadcast a plugin's invalidation to both renderer windows (editor + live
 *  overlay) so their per-plugin caches drop the matching entry. Fired after
 *  every plugin import (covers re-imports of an existing id) and uninstall
 *  (#269); without this the shape-modules store would keep serving the
 *  removed plugin's module from V8 across pie opens. */
function broadcastPluginInvalidated(payload: PluginInvalidatedPayload): void {
  sendToEditor(IpcChannel.PLUGIN_INVALIDATED, payload);
  mainWindow?.webContents.send(IpcChannel.PLUGIN_INVALIDATED, payload);
}

/** Snapshot the installed plugins for the editor's manager: the live
 *  `function` plugins (already loaded for the action index), plus three
 *  manifest-only categories listed but not executed at this stage:
 *  `theme` (#47), `nav-style` (#195), and `shape` (#107 as a plugin).
 *  PR2 of the shape series adds a renderer-side runtime that pulls the
 *  shape entry source on demand; the cached `loadedShapeManifests` lets
 *  that resolve happen in O(1) instead of re-walking the tree. */
async function buildPluginsState(): Promise<PluginsState> {
  const fnPlugins = loadedPlugins.map((p) =>
    toPluginInfo(p.manifest, p.dir, p.provideCatalog !== undefined),
  );
  const theme = await loadPluginManifests('theme');
  const themePlugins = theme.plugins.map(({ manifest, dir }) => toPluginInfo(manifest, dir));
  const navStyle = await loadPluginManifests('nav-style');
  const navStylePlugins = navStyle.plugins.map(({ manifest, dir }) => toPluginInfo(manifest, dir));
  await refreshShapeManifestCache();
  const shapePlugins = Array.from(loadedShapeManifests.values()).map(({ manifest, dir }) =>
    toPluginInfo(manifest, dir),
  );
  return {
    plugins: [...fnPlugins, ...themePlugins, ...navStylePlugins, ...shapePlugins],
    errors: [...pluginErrors, ...theme.errors, ...navStyle.errors, ...shapeLoadErrors],
  };
}

/** Re-scan + re-import the `function` plugins and rebuild the action index.
 *  Called after an import/uninstall so a freshly managed plugin takes effect
 *  without restarting the app, and the editor re-pulls its Action dropdown. */
async function reloadFunctionPlugins(): Promise<void> {
  const { plugins, errors } = await loadPlugins('function');
  loadedPlugins = plugins;
  pluginErrors = errors;
  for (const err of errors) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin] skipped ${err.dir}: ${err.reason}`);
  }
  actionIndex = indexActions([BUILTIN_PLUGIN, ...plugins]);
  sendToEditor(IpcChannel.EDITOR_ACTIONS_CHANGED, undefined);
  // The set of plugin-provided menus may have changed too — refresh the
  // dropdown, and if the *active* plugin menu was just uninstalled, re-resolve
  // so the live pie falls back instead of pointing at a gone menu.
  //
  // Static-scope limitation (C1): re-importing an updated plugin while its menu
  // is active does NOT refresh the live pie's content here — the id is
  // unchanged, so applyActiveProfile's change-gate wouldn't push it anyway. The
  // user reselects to pick up new content; a live-refresh path is a follow-up.
  void pushEditorProfiles();
  if (
    activeProfileId !== null &&
    isPluginMenuId(activeProfileId) &&
    pluginMenuRootFor(activeProfileId) === null
  ) {
    void applyActiveProfile('profile');
  }
  // A reserving plugin (FreeCAD) may have just been installed or removed — (dis)arm
  // the trigger-button reservation accordingly (#191).
  syncTriggerReservation();
}

// Single point that latches the reported device. Re-resolves the active
// profile whenever the device *identity* (VID:PID) changes — connect, swap,
// or disconnect — and pushes the device to the editor: via
// applyActiveProfile on an identity change (so the new profileId rides
// along), or directly on a count-only change.
function setDeviceInfo(buttons: number, vendor: number, product: number, name: string): void {
  const idChanged = vendor !== deviceVendor || product !== deviceProduct;
  const countChanged = buttons !== deviceButtonCount;
  deviceButtonCount = buttons;
  deviceVendor = vendor;
  deviceProduct = product;
  deviceName = name;
  if (idChanged) void applyActiveProfile('device');
  else if (countChanged) pushEditorDevice();
}

/** The profile id to load: a manual override wins over the connected
 *  device's auto-detected id (#113). null when neither applies. */
function resolveProfileId(): string | null {
  return overrideProfileId ?? deviceProfileId(deviceVendor, deviceProduct);
}

/** The active source as a *device profile* id, or null when it isn't one (no
 *  override, or a plugin / curated-workbench source). Appearance edits persist
 *  into a device profile file only in this case; for everything else they're
 *  the global app-settings — writing them into a `plugin:`/`wb:` "profile"
 *  would drop a stray file in the profiles dir. */
function activeDeviceProfileId(): string | null {
  return activeProfileId !== null && isProfileId(activeProfileId) ? activeProfileId : null;
}

/** The (normalized) root of the plugin menu named by a `plugin:<id>` id, or
 *  null when no loaded plugin with that id contributes a menu. */
function pluginMenuRootFor(id: string): MenuNode | null {
  const pid = id.slice(PLUGIN_MENU_ID_PREFIX.length);
  return loadedPlugins.find((p) => p.manifest.id === pid)?.manifest.menu?.root ?? null;
}
/** Selectable plugin menus for the editor's profile dropdown. */
function listPluginMenus(): { id: string; name: string }[] {
  return loadedPlugins
    .filter((p) => p.manifest.menu !== undefined)
    .map((p) => ({ id: `${PLUGIN_MENU_ID_PREFIX}${p.manifest.id}`, name: p.manifest.name }));
}

/**
 * Resolve and apply the active menu config: the manual override profile,
 * else the connected device's profile, else the global fallback. Pushes
 * the new config to both renderers (same channels as a hot-reload) only
 * when the active source actually changes.
 *
 * `cause` classifies *why* this re-resolution happened, for the editor's
 * conflict banner: `device` (a hotplug), `profile` (the user switched the
 * override / saved / deleted), or `external` (a profile file appeared or
 * vanished on disk). Callers pass it; there's no sensible default.
 */
async function applyActiveProfile(cause: ConfigChangeCause): Promise<void> {
  // Land any pending appearance edit on the *current* profile before we
  // switch — the debounced write resolves its target at fire time, so a
  // not-yet-flushed edit would otherwise follow us to the new profile.
  await flushPendingAppearance();

  const id = resolveProfileId();
  const fallback = fallbackMenu ?? { config: DEFAULT_MENU_CONFIG, mtime: null, source: null };

  let next: ActiveMenuConfig;
  if (id !== null && isPluginMenuId(id)) {
    // A plugin-provided menu is the override. Overlay its content onto the
    // user's base config (non-destructive). If the plugin/menu has gone
    // (uninstalled), drop the override and re-resolve the normal way.
    const root = pluginMenuRootFor(id);
    if (root === null) {
      if (overrideProfileId === id) overrideProfileId = null;
      await applyActiveProfile(cause);
      return;
    }
    next = resolvePluginMenuConfig(root, fallback, id);
  } else if (id !== null && isWorkbenchMenuId(id)) {
    // A curated per-workbench pie (#193) is the override — a *writable* source,
    // unlike the read-only plugin menu. Load its file; if there's none yet (not
    // seeded) or it's broken, drop the override and re-resolve, exactly like a
    // gone plugin menu. (PR2c seeds the file before selecting, so a loaded file
    // is the normal path here.)
    const load = await loadWorkbenchMenu(id);
    if (resolveProfileId() !== id) return; // a switch landed while we were reading
    const resolved = resolveWorkbenchMenuConfig(id, load);
    if (resolved === null) {
      if (load.status === 'invalid')
        // eslint-disable-next-line no-console
        console.warn(`[workbench] ${id}: ${load.reason} — dropping override`);
      if (overrideProfileId === id) overrideProfileId = null;
      await applyActiveProfile(cause);
      return;
    }
    next = resolved;
  } else {
    let profile: ProfileLoadResult | null = null;
    if (id) {
      profile = await loadDeviceProfile(id);
      // A newer device change or override landed while we were reading: that
      // call owns the result now, so drop this stale one.
      if (resolveProfileId() !== id) return;
      if (profile.status === 'invalid')
        // eslint-disable-next-line no-console
        console.warn(`[profile] ${id}: ${profile.reason} — using fallback`);
    }
    next = resolveActiveConfig(id, profile, fallback);
  }

  // State is updated unconditionally so main stays authoritative; the IPC
  // push is gated on a source change so a swap between two unprofiled
  // devices (both → fallback) is a no-op.
  const changed = next.profileId !== activeProfileId;
  activeProfileId = next.profileId;
  menuConfig = next.config;
  menuConfigMtime = next.mtime;
  menuConfigSource = next.source;
  // Refresh the editor's device/profile display first, so its useDeviceInfo
  // is current before the config-changed push (below) can raise the banner —
  // the banner names the device/profile from that hook.
  pushEditorDevice();
  if (changed) {
    // eslint-disable-next-line no-console
    console.info(
      `[profile] active config: ${next.profileId ?? 'fallback (menu.json)'}` +
        (deviceName ? ` — ${deviceName}` : ''),
    );
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, next.config);
    sendToEditor(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, {
      config: next.config,
      mtime: next.mtime,
      cause,
    } satisfies MenuConfigChange);
  }
  // Apply the profile's bundled appearance (or restore the global one when
  // it has none / on fallback). Independent of the menu-changed gate above.
  applyActiveAppearance(next.appearance);
  // Keep the trigger-button reservation in sync (#191): the active config (and
  // thus its trigger button) just changed. Source-independent + poll-driven, so
  // it's fire-and-forget here.
  syncTriggerReservation();
}

/** Push the curated-workbench-pie list to the editor (#193) after one is added
 *  / removed, so the FreeCAD dropdown's "already curated" markers stay in sync. */
async function pushEditorWorkbenchMenus(): Promise<void> {
  sendToEditor(IpcChannel.EDITOR_WORKBENCH_MENUS_CHANGED, {
    ids: await listWorkbenchMenus(),
  } satisfies WorkbenchMenusState);
}

/** Push the profile list + current override to the editor (#113), after a
 *  create / delete / override change so its dropdown stays in sync. */
async function pushEditorProfiles(): Promise<void> {
  sendToEditor(IpcChannel.EDITOR_PROFILES_CHANGED, {
    ids: await listDeviceProfiles(),
    override: overrideProfileId,
    pluginMenus: listPluginMenus(),
  } satisfies ProfilesState);
}

/**
 * React to an *external* change in the profiles dir (#113, PR 3c-1) — the
 * editor's own writes are suppressed via markSelfWrite. Always refresh the
 * dropdown list; then keep the live config in sync the way the menu.json
 * watcher does (push + fresh mtime so the editor's conflict baseline tracks
 * the external edit).
 *
 * Two cases, by whether the *resolved* profile id still matches what's
 * loaded:
 *   - id !== activeProfileId — the resolution changed: a profile was just
 *     created for the connected device, the active one was deleted, or a
 *     broken override got fixed. `applyActiveProfile` owns the transition.
 *   - id === activeProfileId (non-null) — only the active profile's content
 *     changed; reload it in place (applyActiveProfile gates its push on an
 *     id change, so it would skip a content-only edit). A now-absent/invalid
 *     file falls through to a re-resolve.
 */
async function onProfilesChangedOnDisk(): Promise<void> {
  void pushEditorProfiles();
  const id = resolveProfileId();
  if (id !== activeProfileId) {
    await applyActiveProfile('external');
    return;
  }
  if (id === null) return; // no device/override → fallback owns the config
  const prof = await loadDeviceProfile(id);
  // A device swap / override landed while we were reading — that call owns
  // the result now (mirrors applyActiveProfile's guard).
  if (resolveProfileId() !== id) return;
  if (prof.status === 'loaded') {
    menuConfig = prof.config;
    menuConfigMtime = prof.mtime;
    menuConfigSource = prof.path;
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, prof.config);
    // cause 'external': the active profile *file* was edited outside the
    // editor (same kind of event as a menu.json edit).
    sendToEditor(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, {
      config: prof.config,
      mtime: prof.mtime,
      cause: 'external',
    } satisfies MenuConfigChange);
    // The external edit may have changed the profile's bundled appearance too.
    applyActiveAppearance(prof.appearance);
    syncTriggerReservation(); // …and may have moved the trigger button (#191)
    return;
  }
  // Active profile deleted externally → drop a matching override and
  // re-resolve (an invalid file keeps the override so the user can fix it;
  // resolution falls back meanwhile).
  if (prof.status === 'absent' && overrideProfileId === id) overrideProfileId = null;
  await applyActiveProfile('external');
}

/**
 * React to an external change in the curated workbench-menus dir (#193). The
 * editor's own write-back arms markSelfWrite, so this fires for edits made
 * outside the editor. Only the *active* curated pie's content matters here (the
 * dropdown-list refresh lands with the UI in PR2c): reload it in place with a
 * fresh mtime, or — if its file vanished / broke — drop the override and
 * re-resolve. Mirrors onProfilesChangedOnDisk's content-reload path.
 */
async function onWorkbenchMenusChangedOnDisk(): Promise<void> {
  // The set of curated pies may have changed (one was added/removed) regardless
  // of the active source — refresh the FreeCAD dropdown's markers first.
  void pushEditorWorkbenchMenus();
  const id = resolveProfileId();
  if (id === null || !isWorkbenchMenuId(id) || id !== activeProfileId) return;
  const load = await loadWorkbenchMenu(id);
  if (resolveProfileId() !== id) return; // a switch landed while we were reading
  if (load.status === 'loaded') {
    menuConfig = load.config;
    menuConfigMtime = load.mtime;
    menuConfigSource = load.path;
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, load.config);
    sendToEditor(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, {
      config: load.config,
      mtime: load.mtime,
      cause: 'external',
    } satisfies MenuConfigChange);
    syncTriggerReservation(); // the curated pie may carry a different trigger (#191)
    return;
  }
  // Active curated file deleted/broke externally → drop the override + re-resolve.
  if (overrideProfileId === id) overrideProfileId = null;
  await applyActiveProfile('external');
}
// The active pie appearance (what the live pie + editor preview show). It's
// the active profile's bundled appearance when one applies (#113 PR 3c-3),
// else `globalAppearance`.
let pieAppearance: PieAppearance = DEFAULT_PIE_APPEARANCE;
// The global appearance (persisted in app-settings.json) — the fallback when
// no profile overrides it, and where the toolbar's appearance edits land.
let globalAppearance: PieAppearance = DEFAULT_PIE_APPEARANCE;
// Debounce the disk write: dragging the opacity slider fires a change per
// step (~16 across the range), but the broadcast stays live so the pie
// updates immediately — only the persist is coalesced to the final value.
let pieAppearanceSaveTimer: NodeJS.Timeout | null = null;

/** Whether two appearances are value-equal (avoids redundant pushes). */
function appearanceEqual(a: PieAppearance, b: PieAppearance): boolean {
  return (
    a.theme === b.theme &&
    a.opacity === b.opacity &&
    a.labelScale === b.labelScale &&
    a.iconScale === b.iconScale &&
    a.scale === b.scale
  );
}

/**
 * Set the active appearance from the active profile's bundled value, or the
 * global appearance when the profile specifies none (#113 PR 3c-3). Pushes
 * PIE_APPEARANCE_CHANGED to both renderers only on a real change.
 */
function applyActiveAppearance(profileAppearance: PieAppearance | null): void {
  const next = profileAppearance ?? globalAppearance;
  if (appearanceEqual(next, pieAppearance)) return;
  pieAppearance = next;
  mainWindow?.webContents.send(IpcChannel.PIE_APPEARANCE_CHANGED, pieAppearance);
  sendToEditor(IpcChannel.PIE_APPEARANCE_CHANGED, pieAppearance);
}

/**
 * Persist the current appearance to where it belongs (#113 PR 3c-3b): into
 * the active profile's file when a profile is active, else the global
 * app-settings. The debounced edit path and the quit flush both call this
 * (the latter via the sync writers). Self-write is armed so the profile
 * watcher doesn't echo our own write back as an external change.
 */
async function persistActiveAppearance(): Promise<void> {
  const profId = activeDeviceProfileId();
  if (profId !== null && menuConfig) {
    markSelfWrite(deviceProfilePath(profId));
    const result = await writeDeviceProfile(profId, menuConfig, pieAppearance);
    if (result.ok !== true) {
      // eslint-disable-next-line no-console
      console.warn(`[profile] failed to save appearance into ${profId}`);
    }
    return;
  }
  await saveAppSettings({
    pieTheme: globalAppearance.theme,
    pieOpacity: globalAppearance.opacity,
    pieLabelScale: globalAppearance.labelScale,
    pieIconScale: globalAppearance.iconScale,
    pieScale: globalAppearance.scale,
    pieRingBalance: globalAppearance.ringBalance,
    pieCenterBalance: globalAppearance.centerBalance,
    pieFontUi: globalAppearance.fontUi,
    pieFontMono: globalAppearance.fontMono,
    pieShapeModel: globalAppearance.shapeModel,
    pieShowSubmenuMarkers: globalAppearance.showSubmenuMarkers,
    pieShowDepthDots: globalAppearance.showDepthDots,
  });
}

/**
 * Flush a pending debounced appearance write *now*, against the current
 * value + target. Called before a profile switch (applyActiveProfile): the
 * debounced write reads both the value and its destination at fire time, so
 * without this an edit made just before a hotplug/override switch would land
 * on the *new* profile (or be lost). No-op when nothing is pending.
 */
async function flushPendingAppearance(): Promise<void> {
  if (pieAppearanceSaveTimer === null) return;
  clearTimeout(pieAppearanceSaveTimer);
  pieAppearanceSaveTimer = null;
  await persistActiveAppearance();
}
const PIE_APPEARANCE_SAVE_DEBOUNCE_MS = 250;
// True between MENU_OPEN and MENU_COMMIT — drives the click-to-toggle
// trigger lifecycle so a second press commits instead of re-opening.
let menuShown = false;

async function createWindow(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  // Dev mode uses a normal opaque framed window so KDE Plasma
  // Wayland actually renders the surface (transparent + frameless
  // overlays often paint nothing visible until the compositor sees
  // an opaque region). Overlay mode drops the frame and goes
  // transparent + click-through as designed. OVERLAY_MODE is true
  // for packaged installs and when SPACEUX_OVERLAY_MODE=1 is set
  // from a dev run.
  const devMode = !OVERLAY_MODE;

  mainWindow = new BrowserWindow({
    width: devMode ? Math.min(DEV_WINDOW_MAX_WIDTH, width) : width,
    height: devMode ? Math.min(DEV_WINDOW_MAX_HEIGHT, height) : height,
    x: devMode ? undefined : 0,
    y: devMode ? undefined : 0,
    frame: devMode ? true : false,
    transparent: devMode ? false : true,
    backgroundColor: devMode ? '#101218' : undefined,
    alwaysOnTop: devMode ? false : true,
    skipTaskbar: devMode ? false : true,
    resizable: devMode,
    movable: devMode,
    show: devMode,
    // On KDE Plasma Wayland (and other wlroots-based compositors)
    // a plain toplevel client cannot reposition itself — setBounds()
    // is a silent no-op because Wayland leaves window placement to
    // the compositor. Specific window types (`toolbar`, `utility`,
    // `dock`) are an opt-out: the compositor treats them as panel-
    // adjacent surfaces that may set their own geometry. We use
    // `toolbar` on KDE for that reason (`dock` would also let
    // setBounds() through, but it loses keyboard focus). We only set
    // it on Linux + overlay mode — the dev window stays a normal
    // toplevel so the dev WM treats it as a regular framed window.
    type: OVERLAY_MODE && process.platform === 'linux' ? 'toolbar' : undefined,
    title: 'SpaceUX (dev)',
    // Window/taskbar icon for the dev-mode framed window (overlay mode is
    // frameless + skipTaskbar). Resolved via resourcePath; same Wayland
    // .desktop caveat (#50) as the editor window.
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      // .cjs extension: preload is bundled by esbuild as CommonJS so
      // Electron's sandboxed preload context (which doesn't grok ESM
      // import statements) can load it. The main process itself stays
      // ESM — only this single file gets the CJS treatment.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Tell the renderer it's the shipping overlay (not the dev window) so it
      // can hide chrome that only makes sense in dev (the daemon-status banner
      // and the debug panel). The debug variant (SPACEUX_OVERLAY_MODE=debug)
      // keeps that chrome on the overlay surface. Passed as launch args (read
      // in the preload) rather than over IPC so the flags are known before
      // first paint, no flash.
      additionalArguments: [
        ...(OVERLAY_MODE ? ['--spaceux-overlay'] : []),
        ...(OVERLAY_DEBUG ? ['--spaceux-overlay-debug'] : []),
      ],
    },
  });

  if (VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  if (!devMode) {
    // Promote the overlay above regular alwaysOnTop — on Plasma some
    // compositor placement rules apply differently to screen-saver-
    // level windows.
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  // Click-through only matters for the production transparent
  // overlay; the dev window is a normal interactive surface so
  // we can resize / click DevTools / etc.
  if (!devMode) {
    mainWindow.setIgnoreMouseEvents(true);
  }

  // Auto-open DevTools while we're still in MVP shake-down.
  // 'undocked' produces a true separate window that KDE Plasma
  // tracks individually; 'detach' was getting bundled under the
  // overlay's task-bar entry and disappearing visually.
  if (devMode) {
    mainWindow.webContents.openDevTools({ mode: 'undocked' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Pull the live cursor position. Prefers the KWin DBus service
 *  on KDE Wayland; falls back to Electron's API everywhere else
 *  (or when the KWin path fails for any reason). */
async function getCursor(): Promise<{ x: number; y: number }> {
  if (kwinCursor) {
    try {
      return await kwinCursor.getCursor();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] KWin script failed, falling back: ${describeError(err)}`);
    }
  }
  return screen.getCursorScreenPoint();
}

/**
 * Open the pie at the cursor. In overlay mode the window is first
 * moved + resized onto the display containing the cursor, so the pie
 * lands on the right monitor in multi-display setups. In dev mode
 * the small framed window stays put — moving it between displays on
 * every trigger would just confuse the developer flow, and the
 * cursor is almost certainly already inside the dev window anyway.
 */
/** A plugin provider that hangs (e.g. an unresponsive FreeCAD socket) must not
 *  freeze the pie open — cap how long we wait for the dynamic menu. */
const DYNAMIC_MENU_TIMEOUT_MS = 2000;
/** Timeout for a plugin's uninstall-hook `perform` (#267). Generous compared
 *  to the descriptor query because the perform may do real filesystem work
 *  (removing an addon directory, e.g. FreeCAD's bridge); still bounded so a
 *  hung third-party closure can't block the editor's busy state forever. */
const UNINSTALL_PERFORM_TIMEOUT_MS = 15000;

/** Resolve `promise`, or reject with `message` after `ms`. The original
 *  promise is left to settle on its own (no cancellation primitive in the
 *  plugin contract); its late result is simply ignored. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

// #191 — the pie-trigger button is global: it opens the SpaceUX pie regardless
// of the focused app or the active pie. So while SpaceUX and FreeCAD both run,
// FreeCAD must not *also* act on that button (it reads the same SpaceMouse via
// spacenavd). We therefore reserve the trigger button in any loaded plugin that
// can suppress its app's binding (the FreeCAD plugin) — independent of which
// SpaceUX source is active, so it covers dynamic, curated, and ordinary pies.
//
// The plugin's bridge is only reachable while its app runs, and a source switch
// usually isn't that moment, so we poll: reserve (idempotently) on a heartbeat
// until it lands, and again after the app restarts. Release is best-effort on a
// button change / shutdown — the FreeCAD bridge's own atexit restores the
// binding when it closes, so a missed release while it's down is harmless.
let desiredReservation: { plugin: LoadedPlugin; button: number } | null = null;
let reservationConfirmed = false;
let reservationPollTimer: ReturnType<typeof setInterval> | null = null;
const RESERVE_POLL_MS = 3000;

/** Ask a plugin to reserve / release the trigger button (#191). Returns whether
 *  the call reached the bridge; failures (the app is just closed) resolve false
 *  and are silent — pollReservation / syncTriggerReservation log on a *state*
 *  change so a closed FreeCAD doesn't spam the console every heartbeat. */
async function callReserveTrigger(
  plugin: LoadedPlugin,
  button: number,
  reserve: boolean,
): Promise<boolean> {
  if (!plugin.reserveTrigger) return false;
  try {
    const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
    await withTimeout(
      Promise.resolve(plugin.reserveTrigger(ctx, { button, reserve })),
      DYNAMIC_MENU_TIMEOUT_MS,
      `reserveTrigger timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
    );
    return true;
  } catch {
    return false;
  }
}

/** One heartbeat: (re-)reserve the desired button. Idempotent on the bridge, so
 *  repeats are cheap; logs only when the confirmed state flips. */
async function pollReservation(): Promise<void> {
  const want = desiredReservation;
  if (!want) return;
  const ok = await callReserveTrigger(want.plugin, want.button, true);
  if (ok && !reservationConfirmed) {
    reservationConfirmed = true;
    // eslint-disable-next-line no-console
    console.info(
      `[plugin ${want.plugin.manifest.id}] reserved trigger button ${want.button} in FreeCAD`,
    );
  } else if (!ok && reservationConfirmed) {
    reservationConfirmed = false; // app went away — keep polling to re-reserve
    // eslint-disable-next-line no-console
    console.info(
      `[plugin ${want.plugin.manifest.id}] trigger reservation lost (FreeCAD closed?) — retrying`,
    );
  }
}

function startReservationPoll(): void {
  if (reservationPollTimer === null) {
    reservationPollTimer = setInterval(() => void pollReservation(), RESERVE_POLL_MS);
  }
  void pollReservation(); // attempt immediately, don't wait a full interval
}

function stopReservationPoll(): void {
  if (reservationPollTimer !== null) {
    clearInterval(reservationPollTimer);
    reservationPollTimer = null;
  }
}

/**
 * Re-derive the desired trigger-button reservation (#191) from the loaded
 * plugins + the active trigger button, and (re)arm the poll. Source-independent:
 * if any loaded plugin can reserve (the FreeCAD plugin), we want the current
 * trigger button reserved in it the whole time. Call after anything that can
 * change either input: a config/profile resolution or a plugin (re)load.
 */
function syncTriggerReservation(): void {
  const reserver = loadedPlugins.find((p) => p.reserveTrigger) ?? null;
  const button = menuConfig?.triggerButton ?? DEFAULT_TRIGGER_BUTTON;

  const prev = desiredReservation;
  if (prev?.plugin.manifest.id === reserver?.manifest.id && prev?.button === button) {
    // Same id + button: keep the reservation, but refresh the plugin object — a
    // reload produces a new LoadedPlugin with the same id, and we must poll the
    // current module, not the superseded one.
    if (reserver) prev.plugin = reserver;
    if (reserver && reservationPollTimer === null) startReservationPoll(); // re-arm if it stopped
    return;
  }

  // Release a stale reservation (different button, or the plugin went away).
  if (prev) {
    const p = prev;
    void callReserveTrigger(p.plugin, p.button, false).then((ok) => {
      if (ok)
        // eslint-disable-next-line no-console
        console.info(`[plugin ${p.plugin.manifest.id}] released trigger button ${p.button}`);
    });
  }

  reservationConfirmed = false;
  desiredReservation = reserver ? { plugin: reserver, button } : null;
  if (desiredReservation) startReservationPoll();
  else stopReservationPoll();
}

/**
 * When the active source is a plugin menu with a dynamic provider (#76 C2),
 * rebuild the pie from the provider at open time and push it to the live
 * overlay before MENU_OPEN — so the menu reflects live context (e.g. FreeCAD's
 * active workbench). Best-effort: a provider that throws, times out, or returns
 * an invalid tree leaves the current (static `manifest.menu`) config in place,
 * so the pie still opens. The dynamic tree is pushed *only* to the live overlay
 * — the authoritative `menuConfig` global stays the static menu, so both
 * pull-based getters (GET_MENU_CONFIG and the editor's EDITOR_GET_MENU_CONFIG,
 * which read that global) keep returning the static placeholder. The overlay
 * renders from the push; it only pulls the global once at mount.
 */
// The pie's corner indicators (#186 / #229) for the live overlay, set at open
// time from the plugin's provideContext: the active plugin's app icon (bottom-
// left) and the active workbench's icon (bottom-right). openMenuAtCursor pushes
// them to the pie after refreshing the dynamic menu.
let pieBadges: PieBadges = { plugin: null, workbench: null };

async function refreshDynamicPluginMenu(): Promise<void> {
  pieBadges = { plugin: null, workbench: null }; // cleared by default; a plugin source sets it below
  const id = activeProfileId;
  if (id === null || !isPluginMenuId(id)) return;
  const pid = id.slice(PLUGIN_MENU_ID_PREFIX.length);
  const plugin = loadedPlugins.find((p) => p.manifest.id === pid);
  if (!plugin) return;
  const fallback = fallbackMenu ?? { config: DEFAULT_MENU_CONFIG, mtime: null, source: null };

  // #193 PR3: if the plugin reports a live context (FreeCAD's active workbench)
  // for which the user has a curated pie, open THAT instead of the dynamic menu.
  // Push the full curated config (not just its root over the base) so it renders
  // identically to selecting it directly — its own scale / navigation apply.
  // Overlay-only (no menuConfig mutation). Best-effort: any failure / no curated
  // pie falls through to the dynamic menu. The config is validated on load.
  if (plugin.provideContext) {
    try {
      const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
      const info = await withTimeout(
        Promise.resolve(plugin.provideContext(ctx)),
        DYNAMIC_MENU_TIMEOUT_MS,
        `provideContext timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
      );
      // Corner indicators for the overlay: plugin app icon (#186) + active
      // workbench icon (#229).
      pieBadges = { plugin: info?.badge ?? null, workbench: info?.icon ?? null };
      if (info?.key) {
        const curated = await loadWorkbenchMenu(makeWorkbenchMenuId(pid, info.key));
        if (curated.status === 'loaded') {
          mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, curated.config);
          return;
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[plugin ${plugin.manifest.id}] context probe failed: ${describeError(err)} — using the dynamic menu`,
      );
    }
  }

  if (!plugin.provideMenu) return; // static-only plugin menu — nothing to refresh

  let root: MenuNode;
  try {
    const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
    root = await withTimeout(
      Promise.resolve(plugin.provideMenu(ctx)),
      DYNAMIC_MENU_TIMEOUT_MS,
      `provideMenu timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[plugin ${plugin.manifest.id}] dynamic menu failed: ${describeError(err)} — using the static menu`,
    );
    return;
  }

  // Validate + normalise exactly like a static plugin menu root, so a bad
  // dynamic tree degrades to the static fallback instead of rendering garbage.
  const v = validateNode(root, 'plugin dynamic menu root', 0, true);
  if (!v.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[plugin ${plugin.manifest.id}] dynamic menu invalid: ${v.reason} — using the static menu`,
    );
    return;
  }

  const next = resolvePluginMenuConfig(v.value, fallback, id);
  // Push to the live overlay only — do NOT mutate the authoritative
  // `menuConfig` global, so a pull (live pie or editor) still sees the static
  // menu and the transient dynamic tree can't leak through GET_MENU_CONFIG.
  mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, next.config);
}

async function openMenuAtCursor(window: BrowserWindow): Promise<void> {
  const cursor = await getCursor();
  let originX: number;
  let originY: number;
  if (OVERLAY_MODE) {
    const targetDisplay = screen.getDisplayNearestPoint(cursor);
    // Use workArea, not bounds: workArea excludes the desktop's
    // reserved zones (Plasma panels, taskbars, autohide-docks). Using
    // bounds places the overlay across the full display and lets the
    // pie sit under the panel, where the user can't see or click it.
    // workArea also makes the renderer-side clampPieAnchor consistent
    // across monitors with and without panels: window.innerWidth/Height
    // matches the visible area in both cases.
    window.setBounds(targetDisplay.workArea);
    originX = targetDisplay.workArea.x;
    originY = targetDisplay.workArea.y;
  } else {
    const bounds = window.getBounds();
    originX = bounds.x;
    originY = bounds.y;
  }
  // Rebuild a dynamic plugin menu (#76 C2) before opening, so the live pie
  // reflects current context. No-op unless the active source is a plugin menu
  // with a provider; awaited so the fresh config is pushed before MENU_OPEN.
  await refreshDynamicPluginMenu();
  // Pie corner indicators (#186 / #229): refreshDynamicPluginMenu set them from
  // the plugin's live context (plugin app icon + active workbench icon), or null
  // for a non-plugin source. Pushed before MENU_OPEN so they're in place when
  // the pie renders.
  window.webContents.send(IpcChannel.PIE_BADGE, pieBadges);

  const payload: MenuOpenPayload = {
    x: cursor.x - originX,
    y: cursor.y - originY,
  };
  if (OVERLAY_MODE) window.show();
  window.webContents.send(IpcChannel.MENU_OPEN, payload);
  // Light the SpaceMouse LED to mirror the pie's open state — calm
  // dark indicator at rest, bright while the user is making a
  // selection. daemon.setLed() short-circuits when the daemon
  // reported no LED capability, so the call is cheap on hosts
  // where the feature isn't available.
  daemon.setLed(true);
  menuShown = true;
}

/** Send the commit event to the renderer without hiding the window.
 *  The renderer decides whether the commit drills into a submenu
 *  (menu stays open) or actually closes — in the latter case it
 *  calls back via `IpcChannel.CLOSE_MENU` which triggers
 *  `hideMenuWindow` below. */
function commitMenu(window: BrowserWindow): void {
  window.webContents.send(IpcChannel.MENU_COMMIT);
}

/** Actually tear down the menu UI: drop the LED, hide the overlay
 *  window (dev mode keeps the framed window visible so the debug
 *  panel stays alive between interactions), and flip `menuShown`
 *  so the next trigger press opens a fresh menu. */
function hideMenuWindow(window: BrowserWindow): void {
  daemon.setLed(false);
  if (OVERLAY_MODE) window.hide();
  menuShown = false;
}

/**
 * Trigger-button handler. The active button comes from the live
 * menu config (`triggerButton`) and falls back to
 * :data:`DEFAULT_TRIGGER_BUTTON` when the user hasn't pinned one —
 * so a hot-reload of menu.json swaps the trigger live without an
 * app restart.
 *
 * Click-to-toggle UX (the default `toggle` triggerMode): press opens;
 * subsequent presses commit the currently-highlighted sector. A commit on
 * a branch drills into its submenu and the menu stays open — pressing the
 * trigger again commits within the deeper ring. A commit on a leaf (or
 * with no selection) closes the menu via the renderer-initiated CLOSE_MENU
 * IPC. In the `open` triggerMode the press-to-open stands but the
 * subsequent commit is suppressed — the button only opens, leaving
 * commit/close to the gestures. Release events are intentionally ignored
 * so the user can navigate the open pie without holding the button down.
 */
function handleTriggerButton(bnum: number, pressed: boolean): void {
  if (!mainWindow) return;
  // While the editor is focused and driving its live preview, the trigger
  // belongs to the preview (it drills there). Suppress the overlay pie so a
  // single press doesn't both drill the preview and pop the real pie.
  if (isEditorLiveFocused()) return;
  const activeTrigger = menuConfig?.triggerButton ?? DEFAULT_TRIGGER_BUTTON;
  if (bnum !== activeTrigger || !pressed) return;
  if (menuShown) {
    // 'open' mode: the button only opens — a second press is a no-op, so
    // committing/closing is left to the gestures and the trigger button is
    // free to be bound like any other input. 'toggle' (default) commits
    // the highlighted selection (the historical click-to-toggle).
    if ((menuConfig?.triggerMode ?? DEFAULT_TRIGGER_MODE) === 'toggle') commitMenu(mainWindow);
  } else {
    void openMenuAtCursor(mainWindow).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[menu] openMenuAtCursor failed: ${describeError(err)}`);
    });
  }
}

function wireDaemonEvents(): void {
  daemon.on('connected', () => {
    daemon.subscribeAll();
  });

  daemon.on('event', (ev: DaemonEvent) => {
    // Latch the device before the window gate so the editor's pull always
    // reflects reality — mirrors the disconnect reset, which is also
    // ungated. A `hello` (fresh connect) and a `device` (live hotplug
    // change) both carry the count + identity; setting it here, before the
    // early return, means an update is never dropped just because
    // mainWindow is momentarily null.
    if (ev.event === 'hello' || ev.event === 'device')
      setDeviceInfo(ev.buttons, ev.vendor ?? 0, ev.product ?? 0, ev.name ?? '');
    if (!mainWindow) return;
    switch (ev.event) {
      case 'axes':
        mainWindow.webContents.send(IpcChannel.AXES, ev.values);
        // Mirror the stream to the editor so its preview can highlight the
        // live sector under the puck — but only while live preview is on
        // (the only subscriber). Avoids serializing ~60 Hz frames across
        // the IPC boundary when the editor is open with live off.
        if (isEditorLive()) sendToEditor(IpcChannel.EDITOR_AXES, ev.values);
        break;
      case 'button':
        mainWindow.webContents.send(IpcChannel.BUTTON, { bnum: ev.bnum, pressed: ev.pressed });
        sendToEditor(IpcChannel.EDITOR_BUTTON, { bnum: ev.bnum, pressed: ev.pressed });
        handleTriggerButton(ev.bnum, ev.pressed);
        break;
      case 'hello': {
        const payload: DaemonStatusPayload = {
          state: 'connected',
          axes: ev.axes,
          buttons: ev.buttons,
          // Older daemons (pre-#6) omit the field — coerce to false
          // so the renderer never sees `undefined` and the absence
          // is treated as "no injection" (matching the conservative
          // default in the type docs).
          inject: ev.inject === true,
          // Same `=== true` narrowing for the LED capability flag.
          led: ev.led === true,
        };
        mainWindow.webContents.send(IpcChannel.DAEMON_STATUS, payload);
        break;
      }
    }
  });

  daemon.on('disconnected', () => {
    setDeviceInfo(0, 0, 0, '');
    if (!mainWindow) return;
    const payload: DaemonStatusPayload = { state: 'disconnected', reason: 'socket closed' };
    mainWindow.webContents.send(IpcChannel.DAEMON_STATUS, payload);
  });

  daemon.on('error', (err: Error) => {
    // Daemon-side errors (ECONNREFUSED when the daemon isn't running)
    // are expected during development. Log but don't crash.
    // eslint-disable-next-line no-console
    console.warn(`[daemon] ${err.message}`);
  });
}

function wireActionDispatch(): void {
  ipcMain.handle(
    IpcChannel.INVOKE_ACTION,
    async (_evt, key: string, config: Record<string, unknown>) => {
      const entry = actionIndex[key];
      if (!entry) {
        throw new Error(`unknown action: ${key}`);
      }
      const handler = entry.plugin.handlers[entry.descriptor.name];
      if (!handler) {
        throw new Error(
          `plugin "${entry.plugin.manifest.id}" has no handler for "${entry.descriptor.name}"`,
        );
      }
      await handler(config, makeActionContext(entry.plugin.manifest.id, daemon, pluginHost));
    },
  );

  // Renderer-pulled menu config. Pull-based so the renderer can fetch
  // the current value at mount-time without racing the push-based
  // channel that handles hot-reloads later.
  ipcMain.handle(IpcChannel.GET_MENU_CONFIG, () => menuConfig);

  // Editor pulls the connected device (latched from the daemon) on mount:
  // count clamps its button pickers, identity + profile id label the
  // active device/profile (#66, #113).
  ipcMain.handle(
    IpcChannel.EDITOR_GET_DEVICE,
    (): EditorDeviceInfo => ({
      buttons: deviceButtonCount,
      vendor: deviceVendor,
      product: deviceProduct,
      name: deviceName,
      profileId: activeProfileId,
    }),
  );

  // ── Per-device profile management (#113, PR 3b) ──────────────────────
  // Editor pulls the saved profile list + current override on mount.
  ipcMain.handle(
    IpcChannel.EDITOR_GET_PROFILES,
    async (): Promise<ProfilesState> => ({
      ids: await listDeviceProfiles(),
      override: overrideProfileId,
      pluginMenus: listPluginMenus(),
    }),
  );

  // Manual override: a profile id force-loaded by the user, or null for
  // "Auto" (device auto-detect). Re-resolves the active config + syncs the
  // editor dropdown. A non-null id is validated; a bogus one is ignored.
  ipcMain.handle(IpcChannel.EDITOR_SET_PROFILE_OVERRIDE, async (_evt, id: unknown) => {
    if (id !== null) {
      if (typeof id !== 'string') return;
      // Accept a device profile id, or a plugin-menu id that resolves to a
      // currently-loaded plugin menu. Reject anything else (stray IPC).
      const valid =
        isProfileId(id) ||
        (isPluginMenuId(id) && pluginMenuRootFor(id) !== null) ||
        (isWorkbenchMenuId(id) && workbenchMenuPath(id) !== null);
      if (!valid) return;
    }
    overrideProfileId = id;
    await applyActiveProfile('profile');
    await pushEditorProfiles();
  });

  // Save the current active config as the connected device's profile.
  ipcMain.handle(IpcChannel.EDITOR_SAVE_PROFILE, async (): Promise<ProfileActionResult> => {
    const id = deviceProfileId(deviceVendor, deviceProduct);
    if (!id) return { ok: false, reason: 'no device connected' };
    if (!menuConfig) return { ok: false, reason: 'no config loaded' };
    // Arm the watcher's self-write guard so our own write doesn't echo back
    // as an external profile change (#113, PR 3c-1).
    markSelfWrite(deviceProfilePath(id));
    // Bundle the current active appearance into the profile (#113 PR 3c-3),
    // so connecting this device restores its look as well as its menu.
    const result = await writeDeviceProfile(id, menuConfig, pieAppearance);
    if (result.ok !== true) {
      return { ok: false, reason: result.ok === 'conflict' ? 'write conflict' : result.reason };
    }
    // The new file may now be the active source (device match, no override).
    await applyActiveProfile('profile');
    await pushEditorProfiles();
    return { ok: true };
  });

  // Delete a profile. If it was the override, drop back to auto-detect.
  ipcMain.handle(
    IpcChannel.EDITOR_DELETE_PROFILE,
    async (_evt, id: unknown): Promise<ProfileActionResult> => {
      if (typeof id !== 'string' || !isProfileId(id)) return { ok: false, reason: 'invalid id' };
      // Suppress the watcher echo for our own delete (#113, PR 3c-1).
      markSelfWrite(deviceProfilePath(id));
      const result = await deleteDeviceProfile(id);
      if (!result.ok) return result;
      if (overrideProfileId === id) overrideProfileId = null;
      // The active source may have been the deleted profile → re-resolve.
      await applyActiveProfile('profile');
      await pushEditorProfiles();
      return { ok: true };
    },
  );

  // Renderer requests a real close (leaf-commit or silent dismiss).
  // The trigger button only sends MENU_COMMIT now; it's the
  // renderer's job to decide whether the commit drills into a
  // submenu (no callback needed) or actually closes the menu
  // (this fire-and-forget callback hides the window). Uses
  // `ipcMain.on` rather than `handle` because there's no return
  // value the renderer would await — and a meaningless promise
  // round-trip would invite confused error-handling on the caller.
  ipcMain.on(IpcChannel.CLOSE_MENU, () => {
    if (mainWindow) hideMenuWindow(mainWindow);
  });
}

app.whenReady().then(async () => {
  if (OVERLAY_MODE && !app.isPackaged) {
    // eslint-disable-next-line no-console
    console.info(
      '[overlay] SPACEUX_OVERLAY_MODE=1 — window stays hidden until the trigger button fires',
    );
  }

  // Set up the KWin cursor service on KDE Wayland so the pie can
  // open under the real mouse on multi-display setups. Init failures
  // (no DBus, no KWin, unexpected version) leave kwinCursor null and
  // the app falls back to screen.getCursorScreenPoint().
  if (OVERLAY_MODE && IS_KDE_WAYLAND) {
    const service = new KWinCursorService();
    try {
      await service.init();
      kwinCursor = service;
      // eslint-disable-next-line no-console
      console.info('[cursor] KWin DBus cursor service ready');
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] KWin DBus cursor service unavailable: ${describeError(err)}`);
    }
  }

  const { plugins, errors } = await loadPlugins('function');
  loadedPlugins = plugins;
  pluginErrors = errors;
  for (const err of errors) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin] skipped ${err.dir}: ${err.reason}`);
  }
  // Built-ins go first so they appear in error messages with the
  // friendly id; third-party plugins layered on top can shadow a
  // built-in only by colliding on the same composite action key,
  // which the indexer reports through its normal duplicate path.
  actionIndex = indexActions([BUILTIN_PLUGIN, ...plugins]);

  // Prime the shape-manifest cache so the live renderer's first
  // `getShapeSource` pull (it can fire before the editor ever opens, when a
  // saved appearance references a shape plugin) hits a populated map.
  await refreshShapeManifestCache();

  const searchPaths = menuConfigSearchPaths();
  menuSearchPaths = searchPaths;
  const menuResult = await loadMenuConfig(searchPaths);
  if (menuResult.fallbackReason) {
    // eslint-disable-next-line no-console
    console.warn(`[menu-config] using defaults: ${menuResult.fallbackReason}`);
  }
  // The global menu.json is the fallback and the initial active config;
  // a device profile (if any) takes over once the daemon reports the
  // connected device's identity (#113, via applyActiveProfile).
  fallbackMenu = menuResult;
  menuConfig = menuResult.config;
  menuConfigMtime = menuResult.mtime;
  menuConfigSource = menuResult.source;

  // Load the persisted (global) pie appearance before any window exists, so
  // the initial GET_PIE_APPEARANCE pull returns the user's value, not
  // defaults. It's the active appearance until a profile overrides it.
  globalAppearance = await loadPieAppearance();
  pieAppearance = globalAppearance;

  // Hot-reload: re-read on every menu.json edit and push the new config
  // to both renderers. The editor's own writes are suppressed by the
  // watcher's self-write window, so a reload here always means an
  // *external* change — push it to the editor too (EDITOR_MENU_CONFIG_
  // CHANGED) so it resyncs instead of overwriting the external edit.
  stopMenuWatcher = watchMenuConfig(searchPaths, (result) => {
    if (result.fallbackReason) {
      // eslint-disable-next-line no-console
      console.warn(`[menu-config] reload fell back to defaults: ${result.fallbackReason}`);
    } else if (result.source) {
      // eslint-disable-next-line no-console
      console.info(`[menu-config] reloaded from ${result.source}`);
    }
    fallbackMenu = result;
    // A menu.json edit only touches the live config when the fallback is
    // the active source. While a device profile is active, the reload just
    // refreshes the cached fallback so a later disconnect restores the
    // up-to-date global config — without clobbering the profile (#113).
    if (activeProfileId !== null) return;
    menuConfig = result.config;
    menuConfigMtime = result.mtime;
    menuConfigSource = result.source;
    mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, result.config);
    // cause 'external': menu.json was edited outside the editor.
    sendToEditor(IpcChannel.EDITOR_MENU_CONFIG_CHANGED, {
      config: result.config,
      mtime: result.mtime,
      cause: 'external',
    } satisfies MenuConfigChange);
    syncTriggerReservation(); // an external menu.json edit may move the trigger (#191)
  });

  // Watch the per-device profiles dir so an external edit to the *active*
  // profile hot-reloads like menu.json (#113, PR 3c-1). Ensure the dir
  // exists first so the watch attaches even before the first profile.
  const profilesDir = deviceProfilesDir();
  await fs.mkdir(profilesDir, { recursive: true }).catch(() => {});
  stopProfileWatcher = watchProfiles(profilesDir, () => {
    void onProfilesChangedOnDisk();
  });

  // Watch the curated workbench-menus dir so an external edit to the *active*
  // curated pie hot-reloads like a profile (#193). Create it first so the watch
  // attaches even before the first curated pie exists. watchProfiles is
  // dir-generic (any *.json dir, with the same self-write suppression).
  const wbDir = workbenchMenusDir();
  await fs.mkdir(wbDir, { recursive: true }).catch(() => {});
  stopWorkbenchWatcher = watchProfiles(wbDir, () => {
    void onWorkbenchMenusChangedOnDisk();
  });

  wireActionDispatch();
  wireEditorIpc({
    getConfig: () => menuConfig,
    getMtime: () => menuConfigMtime,
    // No writable target while a plugin menu is active: it's a read-only
    // overlay of the plugin's content, so an editor save must not write it
    // over the user's menu.json. The editor surfaces "no writable path".
    getWriteTarget: () =>
      activeProfileId !== null && isPluginMenuId(activeProfileId)
        ? undefined
        : (menuConfigSource ?? menuSearchPaths[0]),
    applyWrite: (config, mtime, target) => {
      menuConfig = config;
      menuConfigMtime = mtime;
      menuConfigSource = target;
      // The editor writes to whatever source is active: the profile file
      // when a profile drives the config, else menu.json. Keep the cached
      // fallback in sync only in the latter case so a later device
      // disconnect restores the just-saved global config (#113).
      if (activeProfileId === null) {
        fallbackMenu = { config, mtime, source: target, fallbackReason: null };
      }
      // Hot-reload the live pie so an editor save takes effect at once.
      mainWindow?.webContents.send(IpcChannel.MENU_CONFIG, config);
      // The save may have changed the trigger button (#191) — re-sync so the
      // reservation follows it. This is the normal way to change the trigger,
      // so it must re-reserve here, not only on a device/profile event.
      syncTriggerReservation();
    },
    listActions: () =>
      Object.entries(actionIndex).map(([id, { descriptor }]) => ({
        id,
        label: descriptor.label,
        description: descriptor.description,
        config: descriptor.config,
      })),
    getPlugins: () => buildPluginsState(),
    importPlugin: async (srcDir) => {
      const outcome = await importPluginFromFolder(srcDir);
      if (!outcome.ok) return { ok: false, reason: outcome.reason };
      // Only a function import changes the action index; a theme import just
      // needs the fresh listing below, no rebuild / dropdown refresh.
      if (outcome.manifest.kind === 'function') await reloadFunctionPlugins();
      const state = await buildPluginsState();
      // Tell renderer caches keyed on plugin id (shape-modules today, #269)
      // to drop their entry: covers re-import of an existing id, where the
      // on-disk source is fresh and the cached V8 module is stale. A first-
      // time import is a no-op on the renderer side since nothing was cached.
      broadcastPluginInvalidated({ pluginId: outcome.manifest.id, kind: outcome.manifest.kind });
      const installed =
        state.plugins.find(
          (p) => p.id === outcome.manifest.id && p.kind === outcome.manifest.kind,
        ) ?? toPluginInfo(outcome.manifest, outcome.dir);
      return { ok: true, installed, state };
    },
    uninstallPlugin: async (kind, id) => {
      // Always clear a leftover uninstall-hook perform-closure (#267): if
      // the user cancelled the secondary "Plugin cleanup" confirm,
      // performPluginUninstallHook never ran and the cached entry would
      // outlive the plugin itself. The renderer reaches this IPC on every
      // Remove path, so clearing here is the single chokepoint.
      pendingUninstallPerforms.delete(id);
      const result = await uninstallPlugin(kind, id);
      await reloadFunctionPlugins();
      const state = await buildPluginsState();
      // Drop the renderer-side cache for this plugin id (#269) even when the
      // disk delete itself failed: if the manifest is gone but residual files
      // remain, the next load attempt fails through the existing error path,
      // which is preferable to keeping a stale module live.
      broadcastPluginInvalidated({ pluginId: id, kind });
      // Always return the refreshed state; surface a real delete error (#221).
      return result.ok ? { ok: true, state } : { ok: false, reason: result.reason, state };
    },
    getPluginUninstallHook: async (pluginId) => {
      // The plugin must be loaded (function kind, in our cache) for its
      // `provideUninstall` to be callable. A theme / nav-style / shape plugin
      // has nothing executable, so no hook either.
      const plugin = loadedPlugins.find((p) => p.manifest.id === pluginId);
      if (!plugin || !plugin.provideUninstall) {
        pendingUninstallPerforms.delete(pluginId);
        return { available: false };
      }
      try {
        const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
        const descriptor = await withTimeout(
          Promise.resolve(plugin.provideUninstall(ctx)),
          DYNAMIC_MENU_TIMEOUT_MS,
          `provideUninstall timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
        );
        if (descriptor === null) {
          pendingUninstallPerforms.delete(pluginId);
          return { available: false };
        }
        // Cache the closure under the plugin id; the renderer asks main to
        // invoke it after the user clicks Yes on the secondary confirm.
        pendingUninstallPerforms.set(pluginId, descriptor.perform);
        return { available: true, message: descriptor.message };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[plugin ${pluginId}] provideUninstall failed: ${describeError(err)}`);
        pendingUninstallPerforms.delete(pluginId);
        return { available: false };
      }
    },
    performPluginUninstallHook: async (pluginId) => {
      const perform = pendingUninstallPerforms.get(pluginId);
      pendingUninstallPerforms.delete(pluginId);
      if (!perform) {
        return { ok: false, reason: 'no uninstall hook is pending for this plugin' };
      }
      try {
        return await withTimeout(
          perform(),
          UNINSTALL_PERFORM_TIMEOUT_MS,
          `plugin uninstall hook timed out after ${UNINSTALL_PERFORM_TIMEOUT_MS}ms`,
        );
      } catch (err) {
        return { ok: false, reason: describeError(err) };
      }
    },
    scanPluginUsages: async (pluginId, kind) => {
      // Gather every saved menu source: the global fallback, every device
      // profile (each carries its own MenuConfig + optional bundled
      // PieAppearance, #113), and every curated per-workbench pie (#193).
      // Each ref carries the appearance that effectively applies to it so
      // the scanner can resolve `shapeModel: undefined` (inherit) against
      // the right baseline. The scanner is pure; this handler does the IO
      // and labels each ref for the editor's Remove confirm.
      const menus: MenuRef[] = [];

      // loadMenuConfig always resolves to a config (real or the built-in
      // default), so include it unconditionally. The fallback inherits the
      // global appearance.
      const fallback = await loadMenuConfig(menuConfigSearchPaths());
      menus.push({
        name: 'Global menu (fallback)',
        config: fallback.config,
        appearance: pieAppearance,
      });

      for (const profileId of await listDeviceProfiles()) {
        const prof = await loadDeviceProfile(profileId);
        if (prof.status === 'loaded') {
          menus.push({
            name: `Device profile ${profileId}`,
            config: prof.config,
            // A profile's bundled appearance wins for that profile; only
            // fall back to the global one when the profile didn't ship its
            // own (the historical bare-MenuConfig profile shape).
            appearance: prof.appearance ?? pieAppearance,
          });
        }
      }

      for (const wbId of await listWorkbenchMenus()) {
        const wb = await loadWorkbenchMenu(wbId);
        if (wb.status === 'loaded') {
          // Use the wb: id verbatim — the file name carries the plugin +
          // workbench key already and resolving a richer label would need
          // the plugin's catalog (overkill for the confirm message).
          // Workbench menus don't bundle their own appearance, so they
          // inherit the global one.
          menus.push({ name: wbId, config: wb.config, appearance: pieAppearance });
        }
      }

      return scanPluginUsage(pluginId, kind, menus, pieAppearance);
    },
    getShapeSource: async (pluginId) => {
      // Resolve the shape plugin's entry source on demand: look the plugin
      // up in the cached manifest map, read its `shape.entry` relative to
      // the install dir, return the UTF-8 source. The validator (PR1)
      // already constrained the entry path so we can trust the join without
      // a second sanitisation pass. Null on any failure (no plugin, missing
      // shape descriptor, read error, size cap); the renderer's store
      // treats null as "unavailable" and surfaces a user-facing reason
      // elsewhere.
      try {
        const found = loadedShapeManifests.get(pluginId);
        if (!found || !found.manifest.shape) {
          // eslint-disable-next-line no-console
          console.warn(`[shape] getShapeSource: plugin "${pluginId}" not found / not a shape`);
          return null;
        }
        const entryPath = path.join(found.dir, found.manifest.shape.entry);
        // Stat first so we can reject non-regular files (a symlink
        // resolving to a character / block device, a pipe, a socket)
        // before reading: fs.stat reports `size: 0` for /dev/zero, so
        // the size cap below alone wouldn't catch that case. A
        // legitimate plugin entry is always a regular `.js` file.
        const stat = await fs.stat(entryPath);
        if (!stat.isFile()) {
          // eslint-disable-next-line no-console
          console.warn(
            `[shape] getShapeSource: plugin "${pluginId}" entry is not a regular file; rejecting`,
          );
          return null;
        }
        // Size cap: a shape plugin is pure compute; anything larger
        // than 1 MiB is almost certainly a packaged bundle the
        // manifest's entry shouldn't be pointing at directly. Soft
        // guard, applied to the stat'd size so we never pull an
        // oversized file into memory.
        const MAX_SOURCE_BYTES = 1 << 20;
        if (stat.size > MAX_SOURCE_BYTES) {
          // eslint-disable-next-line no-console
          console.warn(
            `[shape] getShapeSource: plugin "${pluginId}" entry exceeds ${MAX_SOURCE_BYTES} bytes; rejecting`,
          );
          return null;
        }
        return await fs.readFile(entryPath, 'utf8');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[shape] getShapeSource("${pluginId}"): ${describeError(err)}`);
        return null;
      }
    },
    getPluginCatalog: async (pluginId, loadAll) => {
      const plugin = loadedPlugins.find((p) => p.manifest.id === pluginId);
      if (!plugin?.provideCatalog) {
        return { ok: false, reason: 'this plugin provides no command catalog' };
      }
      try {
        const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
        // loadAll can cycle every workbench (slow) — generous cap; the editor
        // shows a spinner while it runs.
        const catalog = await withTimeout(
          Promise.resolve(plugin.provideCatalog(ctx, { loadAll })),
          loadAll ? 60000 : 5000,
          `provideCatalog timed out`,
        );
        return { ok: true, catalog };
      } catch (err) {
        return { ok: false, reason: describeError(err) };
      }
    },
    getWorkbenchMenus: () => listWorkbenchMenus(),
    seedWorkbench: async (pluginId, workbenchKey, overwrite) => {
      const plugin = loadedPlugins.find((p) => p.manifest.id === pluginId);
      if (!plugin?.provideCatalog) {
        return { ok: false, reason: 'this plugin provides no command catalog' };
      }
      let catalog: PluginCatalog;
      try {
        const ctx = makeActionContext(plugin.manifest.id, daemon, pluginHost);
        catalog = await withTimeout(
          Promise.resolve(plugin.provideCatalog(ctx, { loadAll: false })),
          5000,
          'provideCatalog timed out',
        );
      } catch (err) {
        return { ok: false, reason: describeError(err) };
      }
      const group = catalog.groups.find((g) => g.key === workbenchKey);
      if (!group || group.toolbars.every((tb) => tb.commands.length === 0)) {
        return {
          ok: false,
          reason: `workbench "${workbenchKey}" has no commands loaded — open it in FreeCAD (or use Load all) first`,
        };
      }
      // Seed from the global base (trigger / navigation / scale). For a fresh
      // seed (expectedMtime null) the write conflicts if a pie already exists;
      // re-seed (overwrite) writes against the existing mtime so it replaces
      // the file — but only here, after a successful pull, so a bridge error
      // above leaves the current curated pie intact (#207).
      const base = fallbackMenu?.config ?? DEFAULT_MENU_CONFIG;
      const id = makeWorkbenchMenuId(pluginId, workbenchKey);
      let expectedMtime: number | null = null;
      if (overwrite) {
        const existing = await loadWorkbenchMenu(id);
        if (existing.status === 'loaded') expectedMtime = existing.mtime;
      }
      const result = await writeWorkbenchMenu(
        id,
        seedWorkbenchConfig(group, base, pluginId),
        expectedMtime,
      );
      if (result.ok !== true) {
        return {
          ok: false,
          reason:
            result.ok === 'conflict'
              ? overwrite
                ? 'the curated pie changed on disk — try again'
                : 'a curated pie already exists for this workbench'
              : result.reason,
        };
      }
      return { ok: true, id };
    },
    deleteWorkbench: async (pluginId, workbenchKey) => {
      const id = makeWorkbenchMenuId(pluginId, workbenchKey);
      const result = await deleteWorkbenchMenu(id);
      if (!result.ok) return result;
      // If the deleted pie was the active source, drop the override and
      // re-resolve so the editor/live pie don't keep showing a gone source.
      if (overrideProfileId === id) {
        overrideProfileId = null;
        await applyActiveProfile('profile');
        await pushEditorProfiles();
      }
      return { ok: true };
    },
    getFreecadBridge: freecadBridgeStatus,
    installFreecadBridge: async (pluginId) => {
      const plugin = loadedPlugins.find((p) => p.manifest.id === pluginId);
      if (!plugin) return { ok: false, reason: 'plugin not loaded' };
      const r = resolveFreecadModDir();
      if (!r.ok) return { ok: false, reason: r.reason };
      // The addon ships in the plugin's freecad/ subdir.
      return installBridge(path.join(plugin.dir, 'freecad'), r.modDir);
    },
    uninstallFreecadBridge: freecadBridgeUninstall,
  });
  wireAppIpc({
    getAppearance: () => pieAppearance,
    setAppearance: (patch) => {
      // The live value always tracks the edit for instant feedback. Where it
      // *persists* depends on what's active (PR 3c-3b): an appearance edit
      // while a profile is active is saved into that profile; otherwise it's
      // the global app-settings.
      pieAppearance = { ...pieAppearance, ...patch };
      // Global unless a *device profile* is active (a plugin / curated-workbench
      // source keeps appearance global — see activeDeviceProfileId).
      if (activeDeviceProfileId() === null) globalAppearance = { ...globalAppearance, ...patch };
      // Broadcast the full value to both renderers at once: the live pie
      // hot-reloads and the editor preview (incl. the one that made the
      // edit) tracks it without waiting on the debounced disk write.
      mainWindow?.webContents.send(IpcChannel.PIE_APPEARANCE_CHANGED, pieAppearance);
      sendToEditor(IpcChannel.PIE_APPEARANCE_CHANGED, pieAppearance);
      // Coalesce the persist so a slider drag doesn't write the file ~16x.
      if (pieAppearanceSaveTimer) clearTimeout(pieAppearanceSaveTimer);
      pieAppearanceSaveTimer = setTimeout(() => {
        pieAppearanceSaveTimer = null;
        void persistActiveAppearance();
      }, PIE_APPEARANCE_SAVE_DEBOUNCE_MS);
    },
  });
  wireDaemonEvents();
  daemon.start();

  createTray();
  await createWindow();
});

// Let the editor window close for real on quit — without this its
// hide-on-close interceptor would veto the close and stall the exit.
app.on('before-quit', () => {
  setAppQuitting();
  // Flush a pending debounced appearance save synchronously — the async
  // timer wouldn't fire (and an async write wouldn't settle) before exit.
  if (pieAppearanceSaveTimer) {
    clearTimeout(pieAppearanceSaveTimer);
    pieAppearanceSaveTimer = null;
    // Flush to the same place the debounced write would have (#113 PR 3c-3b):
    // the active profile, else the global app-settings.
    const profId = activeDeviceProfileId();
    if (profId !== null && menuConfig) {
      writeDeviceProfileSync(profId, menuConfig, pieAppearance);
    } else {
      saveAppSettingsSync({
        pieTheme: globalAppearance.theme,
        pieOpacity: globalAppearance.opacity,
        pieLabelScale: globalAppearance.labelScale,
        pieIconScale: globalAppearance.iconScale,
        pieScale: globalAppearance.scale,
        pieRingBalance: globalAppearance.ringBalance,
        pieCenterBalance: globalAppearance.centerBalance,
        pieFontUi: globalAppearance.fontUi,
        pieFontMono: globalAppearance.fontMono,
        pieShapeModel: globalAppearance.shapeModel,
        pieShowSubmenuMarkers: globalAppearance.showSubmenuMarkers,
        pieShowDepthDots: globalAppearance.showDepthDots,
      });
    }
  }
});

app.on('window-all-closed', () => {
  daemon.stop();
  stopReservationPoll();
  stopMenuWatcher?.();
  stopMenuWatcher = null;
  stopProfileWatcher?.();
  stopProfileWatcher = null;
  stopWorkbenchWatcher?.();
  stopWorkbenchWatcher = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
