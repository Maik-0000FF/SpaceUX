// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The native pie runtime (#457 D2). Owns the live pie lifecycle — open at
 * the cursor (per compositor, #507), the per-frame gesture navigation off the daemon's
 * axes/button stream (the shared resolvePuckFrame/drillReducer), the scene
 * push + live-edit sync (identity-keyed so a steady aim stays off the bus),
 * the trigger-button toggle/open modes, the exclusive puck grab while open
 * (#327), the SpaceMouse LED, the dynamic/curated plugin pie for one open
 * (#76/#328), and the FreeCAD trigger-button reservation heartbeat (#191).
 *
 * Everything is driven through small injected accessors over the core state,
 * so the runtime stays a sibling of the service builder rather than a second
 * source of truth. The desktop interpreter (D3) and the editor live preview
 * (D5) plug into the marked hooks later.
 */

import path from 'node:path';

import {
  _safeShapeHitTest,
  currentBranches,
  drillReducer,
  INITIAL_DRILL_STATE,
  resolvePuckFrame,
  type DrillState,
  type PuckEdges,
  type PuckOutcome,
} from '../core/menu-nav.js';
import type { SixAxes } from '../core/pie-geometry.js';
import { buildOverlaySvgScene } from '../core/overlay-svg.js';
import { OVERLAY_FOOTPRINT } from '../core/overlay-scene.js';
import { buildOverlayTheme } from '../core/overlay-theme.js';
import { pieWindowExtent, ringRadii, shapeRingRadii } from '../core/pie-geometry.js';
import { describeError } from '../shared/errors.js';
import type { AxesEvent } from '../shared/protocol.js';
import {
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  validateNode,
  type ActionRef,
  type MenuConfig,
  type MenuNode,
} from '../shared/menu.js';
import {
  PLUGIN_MENU_ID_PREFIX,
  isPluginMenuId,
  makeContextMenuId,
} from '../shared/plugin-types.js';
import {
  validateShapeLayout,
  type ShapeLayout,
  type ShapePluginModule,
  type ShapeRingRadii,
  type ShapeRingSlot,
} from '../shared/shape-plugin-api.js';
import { withTimeout } from '../shared/with-timeout.js';

import { loadContextMenu } from '../main/context-loader.js';
import type { DesktopInterpreter } from '../main/desktop-interpreter.js';
import type { GrabArbiter } from '../main/grab-intent.js';
import { createCursorSource } from '../main/cursor-source.js';
import { OverlayClient } from '../main/overlay-client.js';
import { makeActionContext, type LoadedPlugin } from '../main/plugin-loader.js';
import { DYNAMIC_MENU_TIMEOUT_MS } from '../main/plugin-runtime.js';
import { resolvePluginMenuConfig } from '../main/profile-loader.js';
import { resourcePath } from '../main/resources.js';
import type { MainShapeModuleLoader } from '../main/shape-modules.js';

import type { CoreState } from './core-state.js';

/** Logical px past the outer ring kept on every side of the surface; matches
 *  the daemon's logical ringInset_ for the input-region mask (#473/#475). */
const OVERLAY_RING_INSET = 2;
/** Half-extent (pie-scale 1) of the full pie window (see main's twin). */
const OVERLAY_WINDOW_HALF = pieWindowExtent(OVERLAY_FOOTPRINT, OVERLAY_FOOTPRINT);
const RESERVE_POLL_MS = 3000;

export type PieRuntime = {
  /** Feed one daemon axes frame (no-op unless a pie is open). */
  onAxes: (values: AxesEvent['values']) => void;
  /** Feed one daemon button event (trigger handling + a nav frame). */
  onButton: (bnum: number, pressed: boolean) => void;
  /** Re-push the menu to an open pie after a live config change. */
  pushMenuIfOpen: () => void;
  /** Re-push the appearance (theme/surface/scene) to an open pie. */
  pushAppearanceIfOpen: () => void;
  /** Re-derive the #191 trigger reservation (config/profile/plugin change). */
  syncTriggerReservation: () => void;
  /** Re-assert the grab after a daemon reconnect (#327). */
  reapplyGrab: () => void;
  /** Apply a changed grab-while-open setting to an already-open pie (#402). */
  applyGrabSetting: () => void;
  /** Late-bind the desktop interpreter (D3): trigger deference + pie-open
   *  suspension hooks. */
  setDesktopInterpreter: (di: DesktopInterpreter) => void;
  /** Run an indexed action fire-and-forget (the desktop button path). */
  dispatchAction: (id: string, config: Record<string, unknown>) => void;
  /** Blink the LED and restore the pie base state (desktop state feedback). */
  blinkLed: (pulses: number) => void;
  /** Tear down an open pie (shutdown path). */
  hide: () => void;
};

export function createPieRuntime(
  state: CoreState,
  shapeLoader: MainShapeModuleLoader,
  grabArbiter: GrabArbiter,
): PieRuntime {
  // ── Live pie state (the main-side mirror of useDrillNavigation) ───────────
  let menuShown = false;
  let liveMenuConfig: MenuConfig | null = null;
  let nativeDrill: DrillState = INITIAL_DRILL_STATE;
  let nativeEdges: PuckEdges = freshPuckEdges();
  let lastNativeAxes: AxesEvent['values'] = [0, 0, 0, 0, 0, 0];
  const heldButtons: boolean[] = [];
  let nativeSceneKey: string | null = null;
  let nativeLastScale = 1;

  function freshPuckEdges(): PuckEdges {
    // Armed to "already over" so the first frame after open never reads as a
    // rising edge (matches useDrillNavigation's reset).
    return { activate: true, exit: true, commit: true, back: true, drill: true, cycle: true };
  }

  /** The config the LIVE pie renders: the per-open dynamic/curated overlay
   *  when one resolved (#328), else the authoritative active config. */
  const activeMenu = (): MenuConfig | null => liveMenuConfig ?? state.menuConfig;

  // The desktop interpreter (D3), late-bound by the builder: the trigger
  // defers to a desktop-bound button, and an open pie suspends emission.
  let desktopInterpreter: DesktopInterpreter | null = null;

  const overlayClient = new OverlayClient({
    binaryPath: resourcePath('build', 'spaceux-overlay'),
    onClosed: () => {
      // A compositor dismiss closes the pie without hideMenuWindow: release
      // the pie's grab intent here too or it would leak (stray-release safe).
      menuShown = false;
      grabArbiter.release('pie');
      desktopInterpreter?.setPieOpen(false);
    },
  });

  // Cursor source for opening the pie at the pointer, chosen per compositor
  // (#507): KDE via KWin, mango via its IPC, anything else returns null and the
  // open is skipped until a position-mode fallback lands (#63). The KWin backend
  // materialises its helper script under an XDG state dir.
  const kwinScriptDir = path.join(
    process.env.XDG_STATE_HOME ?? path.join(process.env.HOME ?? '', '.local', 'state'),
    'spaceux',
    'kwin_scripts',
  );
  const cursorSource = createCursorSource(state.hostEnvironment.desktop, { kwinScriptDir });

  function getCursor(): Promise<{ x: number; y: number } | null> {
    return cursorSource.getCursor();
  }

  // ── Shape plugin for the live pie (#325) ──────────────────────────────────
  function activeShapePluginIdOf(): string | null {
    const cfg = activeMenu();
    if (cfg === null) return null;
    const key = resolveShapeKey(cfg);
    if (key === null) return null;
    const slash = key.indexOf('/');
    return slash > 0 ? key.slice(0, slash) : null;
  }

  function resolveShapeKey(cfg: MenuConfig): string | null {
    // resolveShapeModel semantics: per-menu override (undefined = inherit the
    // appearance default, null = force wedge) over the app default.
    if (cfg.shapeModel === null) return null;
    if (typeof cfg.shapeModel === 'string') return cfg.shapeModel;
    return state.pieAppearance.shapeModel ?? null;
  }

  async function ensureNativeShapeLoaded(): Promise<void> {
    const pluginId = activeShapePluginIdOf();
    if (pluginId !== null) await shapeLoader.ensureLoaded(pluginId);
  }

  function nativeShapeModule(): ShapePluginModule | null {
    const pluginId = activeShapePluginIdOf();
    return pluginId !== null ? shapeLoader.get(pluginId) : null;
  }

  /** Plugin+band+reason combos already warned, so a band falling back to
   *  wedges every rebuild logs once, not per frame. */
  const warnedShapeFallbacks = new Set<string>();

  function warnShapeFallback(ring: ShapeRingSlot, reason: string): void {
    const key = `${activeShapePluginIdOf() ?? ''}|${ring}|${reason}`;
    if (warnedShapeFallbacks.has(key)) return;
    warnedShapeFallbacks.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[shape] ${ring} band fell back to wedges: ${reason}`);
  }

  /** Log the first time the shape's hitTest throws for the active ring;
   *  throttled via warnedShapeFallbacks so 60Hz throws log once. */
  function warnShapeHitTest(reason: string): void {
    const pluginId = activeShapePluginIdOf() ?? '?';
    const key = `${pluginId}|hitTest|${reason}`;
    if (warnedShapeFallbacks.has(key)) return;
    warnedShapeFallbacks.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[shape] plugin "${pluginId}" hitTest failed: ${reason}`);
  }

  // Memoised shape hit-test layout (the per-frame call must not rerun
  // module.layout(); keyed on everything the layout depends on).
  let cachedHitTestLayout: { key: string; radii: ShapeRingRadii; layout: ShapeLayout } | null =
    null;

  function nativeShapeHitTest(): ((axes: SixAxes) => number | null) | undefined {
    const cfg = activeMenu();
    if (cfg === null) return undefined;
    const module = nativeShapeModule();
    if (module === null) return undefined;
    const activeRing = currentBranches(cfg, nativeDrill.navigation);
    if (activeRing.length === 0) return undefined;
    const slot: ShapeRingSlot = nativeDrill.navigation.length > 0 ? 'outer' : 'inner';
    const a = state.pieAppearance;
    const key = `${activeShapePluginIdOf() ?? ''}|${slot}|${activeRing.length}|${a.ringBalance}|${a.centerBalance}`;
    if (cachedHitTestLayout === null || cachedHitTestLayout.key !== key) {
      const radii = shapeRingRadii(ringRadii(OVERLAY_FOOTPRINT, a.ringBalance, a.centerBalance));
      let raw: unknown;
      try {
        raw = module.layout(activeRing.length, radii, slot);
      } catch {
        // The render path's onShapeFallback already surfaces a throwing
        // layout; fall back to the wedge hit-test without a duplicate warning.
        cachedHitTestLayout = null;
        return undefined;
      }
      const validated = validateShapeLayout(raw, activeRing.length);
      if (!validated.ok) {
        cachedHitTestLayout = null;
        return undefined;
      }
      cachedHitTestLayout = { key, radii, layout: validated.layout };
    }
    const { radii, layout } = cachedHitTestLayout;
    return (axes) => _safeShapeHitTest(module, radii, layout, axes, warnShapeHitTest);
  }

  // ── Scene push (#339 identity-keyed) ──────────────────────────────────────
  function nativeSurfaceSize(): number {
    return Math.round(2 * (OVERLAY_WINDOW_HALF * state.pieAppearance.scale + OVERLAY_RING_INSET));
  }

  function nativeSceneKeyOf(): string {
    const nav = nativeDrill.navigation;
    const active = nativeDrill.stickyChildIndex ?? -1;
    const a = state.pieAppearance;
    const shapeId = activeShapePluginIdOf();
    return [
      nav.join(','),
      active,
      a.scale,
      a.ringBalance,
      a.centerBalance,
      a.labelScale,
      a.iconScale,
      a.hideLabels === true,
      a.hideIcons === true,
      a.theme,
      a.opacity,
      a.fontUi,
      a.showSubmenuMarkers,
      a.showDepthDots,
      a.wedgeStyle,
      a.wedgeGapStyle,
      a.wedgeGap,
      a.wedgeHoverOffset,
      shapeId ?? '',
      nativeShapeModule() !== null ? 'r' : '-',
    ].join('|');
  }

  function buildScene() {
    const cfg = activeMenu();
    if (cfg === null) return null;
    return buildOverlaySvgScene(
      cfg,
      nativeDrill.navigation,
      nativeDrill.stickyChildIndex,
      state.pieAppearance,
      nativeShapeModule(),
      warnShapeFallback,
    );
  }

  /** Re-push the scene when its identity changed (steady aim = no-op). */
  function syncNativeScene(): void {
    if (activeMenu() === null) return;
    const key = nativeSceneKeyOf();
    if (key === nativeSceneKey) return;
    nativeSceneKey = key;
    const scene = buildScene();
    if (scene !== null) void overlayClient.setScene(scene).catch(() => {});
  }

  // ── Open / close / commit ─────────────────────────────────────────────────
  async function showNativeOverlay(cursor: { x: number; y: number }): Promise<void> {
    const cfg = activeMenu();
    if (cfg === null) return;
    try {
      await overlayClient.start();
      nativeDrill = INITIAL_DRILL_STATE;
      nativeEdges = freshPuckEdges();
      await ensureNativeShapeLoaded();
      nativeSceneKey = nativeSceneKeyOf();
      const scene = buildScene();
      if (scene === null) return;
      // Surface size before the cursor: the cursor margins derive from it.
      nativeLastScale = state.pieAppearance.scale;
      await overlayClient.setSurfaceSize(nativeSurfaceSize());
      await overlayClient.setCursorPosition(cursor.x, cursor.y);
      // The theme carries only the frosted-blur flag now (#339).
      await overlayClient.setTheme(buildOverlayTheme(state.pieAppearance));
      await overlayClient.setScene(scene);
      await overlayClient.show();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[overlay] open failed: ${describeError(err)}`);
    }
  }

  async function openMenuAtCursor(): Promise<void> {
    const cursor = await getCursor();
    if (cursor === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `[menu] no cursor position for desktop "${state.hostEnvironment.desktop}", not opening`,
      );
      return;
    }
    await refreshDynamicPluginMenu();
    await showNativeOverlay(cursor);
    // Exclusive puck grab while open (#327), gated by the user setting.
    if (state.inputSettings.grabWhilePieOpen) grabArbiter.acquire('pie');
    state.daemon.setLed(true);
    menuShown = true;
    desktopInterpreter?.setPieOpen(true);
  }

  function hideMenuWindow(): void {
    state.daemon.setLed(false);
    grabArbiter.release('pie');
    void overlayClient.hide().catch(() => {});
    menuShown = false;
    desktopInterpreter?.setPieOpen(false);
    liveMenuConfig = null;
  }

  /** Trigger-button commit (toggle mode): a hovered branch drills, a leaf (or
   *  the centre) fires; keepOpen leaves the pie up. */
  function commitNativeOverlay(): void {
    const cfg = activeMenu();
    if (cfg === null) {
      hideMenuWindow();
      return;
    }
    const ring = currentBranches(cfg, nativeDrill.navigation);
    const idx = nativeDrill.stickyChildIndex;
    const node = idx !== null ? ring[idx] : undefined;
    if (idx !== null && node?.branches !== undefined) {
      nativeDrill = drillReducer(nativeDrill, { type: 'drill', index: idx, nextSticky: null });
      settleNativeHover();
      syncNativeScene();
      return;
    }
    const action = node ? node.action : cfg.root.action;
    if (node?.keepOpen !== true) hideMenuWindow();
    dispatchActionRef(action);
  }

  // ── Navigation frames ─────────────────────────────────────────────────────
  function settleNativeHover(): void {
    const cfg = activeMenu();
    if (cfg === null) return;
    const [tx, ty, tz, rx, ry, rz] = lastNativeAxes;
    const axes: SixAxes = { tx, ty, tz, rx, ry, rz };
    const { outcome, edges } = resolvePuckFrame({
      menuConfig: cfg,
      axes,
      buttons: heldButtons,
      navigation: nativeDrill.navigation,
      sticky: nativeDrill.stickyChildIndex,
      edges: nativeEdges,
      hitTest: nativeShapeHitTest(),
    });
    nativeEdges = edges;
    if (outcome.kind === 'hover') {
      nativeDrill = drillReducer(nativeDrill, { type: 'hover', index: outcome.index });
    }
  }

  function applyNativeOutcome(outcome: PuckOutcome): void {
    const cfg = activeMenu();
    if (cfg === null) return;
    switch (outcome.kind) {
      case 'hover':
        nativeDrill = drillReducer(nativeDrill, { type: 'hover', index: outcome.index });
        break;
      case 'exitToCenter':
        nativeDrill = drillReducer(nativeDrill, { type: 'hover', index: null });
        break;
      case 'drill':
        nativeDrill = drillReducer(nativeDrill, {
          type: 'drill',
          index: outcome.index,
          nextSticky: null,
        });
        // Settle the new ring's hover before the push so the centre never
        // flashes active for a frame.
        settleNativeHover();
        break;
      case 'back':
        if (outcome.mode === 'pop') {
          nativeDrill = drillReducer(nativeDrill, { type: 'pop' });
          settleNativeHover();
          break;
        }
        nativeDrill = INITIAL_DRILL_STATE;
        hideMenuWindow();
        return;
      case 'commitCenter': {
        const action = cfg.root.action;
        if (cfg.root.keepOpen !== true) {
          nativeDrill = INITIAL_DRILL_STATE;
          hideMenuWindow();
        }
        dispatchActionRef(action);
        return;
      }
      case 'activate': {
        const node = currentBranches(cfg, nativeDrill.navigation)[outcome.index];
        if (node?.keepOpen !== true) {
          nativeDrill = INITIAL_DRILL_STATE;
          hideMenuWindow();
        }
        dispatchActionRef(node?.action);
        return;
      }
      case 'none':
        return;
    }
    syncNativeScene();
  }

  function driveNativeNav(values: AxesEvent['values']): void {
    const cfg = activeMenu();
    if (!menuShown || cfg === null) return;
    lastNativeAxes = values;
    const [tx, ty, tz, rx, ry, rz] = values;
    const axes: SixAxes = { tx, ty, tz, rx, ry, rz };
    const { outcome, edges } = resolvePuckFrame({
      menuConfig: cfg,
      axes,
      buttons: heldButtons,
      navigation: nativeDrill.navigation,
      sticky: nativeDrill.stickyChildIndex,
      edges: nativeEdges,
      hitTest: nativeShapeHitTest(),
    });
    nativeEdges = edges;
    applyNativeOutcome(outcome);
  }

  /** Trigger handler: press opens; in toggle mode (default) further presses
   *  commit, in open mode they no-op. Releases are ignored so the user can
   *  navigate without holding the button. */
  function handleTriggerButton(bnum: number, pressed: boolean): void {
    // The trigger stays live even while the editor drives its live preview
    // (deliberate: the pie must remain openable during a focused live
    // session; the preview's own trigger-drill coexists with it).
    const activeTrigger = activeMenu()?.triggerButton ?? DEFAULT_TRIGGER_BUTTON;
    if (bnum !== activeTrigger || !pressed) return;
    // Desktop mode owns this button right now (active and bound to a desktop
    // function): a button doubling as the trigger is dual-function in toggle
    // mode — pie while desktop mode is off, the function while it is on.
    if (desktopInterpreter?.consumesButton(bnum)) return;
    if (menuShown) {
      if ((activeMenu()?.triggerMode ?? DEFAULT_TRIGGER_MODE) === 'toggle') commitNativeOverlay();
    } else {
      void openMenuAtCursor().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(`[menu] openMenuAtCursor failed: ${describeError(err)}`);
      });
    }
  }

  // ── Dynamic / curated plugin pie for one open (#76 / #193 / #328) ─────────
  async function refreshDynamicPluginMenu(): Promise<void> {
    liveMenuConfig = null;
    const id = state.activeProfileId;
    if (id === null || !isPluginMenuId(id)) return;
    const pid = id.slice(PLUGIN_MENU_ID_PREFIX.length);
    const plugin = state.loadedPlugins.find((p) => p.manifest.id === pid);
    if (!plugin) return;
    const fallback = { config: state.menuConfig, mtime: null, source: null };

    if (plugin.provideContext) {
      try {
        const ctx = makeActionContext(plugin.manifest.id, state.daemon, state.pluginHost);
        const info = await withTimeout(
          Promise.resolve(plugin.provideContext(ctx)),
          DYNAMIC_MENU_TIMEOUT_MS,
          `provideContext timed out after ${DYNAMIC_MENU_TIMEOUT_MS}ms`,
        );
        if (info?.key) {
          const curated = await loadContextMenu(makeContextMenuId(pid, info.key));
          if (curated.status === 'loaded') {
            liveMenuConfig = curated.config;
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

    if (!plugin.provideMenu) return;
    let root: MenuNode;
    try {
      const ctx = makeActionContext(plugin.manifest.id, state.daemon, state.pluginHost);
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
    const v = validateNode(root, 'plugin dynamic menu root', 0, true);
    if (!v.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[plugin ${plugin.manifest.id}] dynamic menu invalid: ${v.reason} — using the static menu`,
      );
      return;
    }
    liveMenuConfig = resolvePluginMenuConfig(v.value, fallback, id).config;
  }

  // ── Action dispatch ───────────────────────────────────────────────────────
  async function runAction(key: string, config: Record<string, unknown>): Promise<void> {
    const entry = state.actionIndex[key];
    if (!entry) throw new Error(`unknown action: ${key}`);
    const handler = entry.plugin.handlers[entry.descriptor.name];
    if (!handler) {
      throw new Error(
        `plugin "${entry.plugin.manifest.id}" has no handler for "${entry.descriptor.name}"`,
      );
    }
    await handler(
      config,
      makeActionContext(entry.plugin.manifest.id, state.daemon, state.pluginHost),
    );
  }

  function dispatchActionRef(action: ActionRef | undefined): void {
    if (!action) return;
    void runAction(action.id, action.config ?? {}).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[action] ${action.id} failed: ${describeError(err)}`);
    });
  }

  // ── #191 trigger-button reservation heartbeat ─────────────────────────────
  let desiredReservation: { plugin: LoadedPlugin; button: number } | null = null;
  let reservationConfirmed = false;
  let reservationPollTimer: ReturnType<typeof setInterval> | null = null;

  async function callReserveTrigger(
    plugin: LoadedPlugin,
    button: number,
    reserve: boolean,
  ): Promise<boolean> {
    if (!plugin.reserveTrigger) return false;
    try {
      const ctx = makeActionContext(plugin.manifest.id, state.daemon, state.pluginHost);
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

  async function pollReservation(): Promise<void> {
    const want = desiredReservation;
    if (!want) return;
    const ok = await callReserveTrigger(want.plugin, want.button, true);
    if (ok && !reservationConfirmed) {
      reservationConfirmed = true;
      // eslint-disable-next-line no-console
      console.info(
        `[plugin ${want.plugin.manifest.id}] reserved trigger button ${want.button} in ${want.plugin.manifest.name}`,
      );
    } else if (!ok && reservationConfirmed) {
      reservationConfirmed = false;
      // eslint-disable-next-line no-console
      console.info(
        `[plugin ${want.plugin.manifest.id}] trigger reservation lost (app closed?) — retrying`,
      );
    }
  }

  function startReservationPoll(): void {
    if (reservationPollTimer === null) {
      reservationPollTimer = setInterval(() => void pollReservation(), RESERVE_POLL_MS);
    }
    void pollReservation();
  }

  function syncTriggerReservation(): void {
    const reserver = state.loadedPlugins.find((p) => p.reserveTrigger) ?? null;
    const button = state.menuConfig?.triggerButton ?? DEFAULT_TRIGGER_BUTTON;
    const prev = desiredReservation;
    if (prev?.plugin.manifest.id === reserver?.manifest.id && prev?.button === button) {
      // Same id + button: keep it, but refresh the plugin object — a reload
      // produced a new LoadedPlugin and the poll must hit the current module.
      if (reserver && prev) prev.plugin = reserver;
      if (reserver && reservationPollTimer === null) startReservationPoll();
      return;
    }
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
    else if (reservationPollTimer !== null) {
      clearInterval(reservationPollTimer);
      reservationPollTimer = null;
    }
  }

  // ── Live-edit pushes ──────────────────────────────────────────────────────
  function pushNativeMenuIfOpen(): void {
    const cfg = activeMenu();
    if (!menuShown || cfg === null) return;
    // The structure may have changed under the open pie: reset to the top.
    nativeDrill = INITIAL_DRILL_STATE;
    nativeEdges = freshPuckEdges();
    nativeSceneKey = nativeSceneKeyOf();
    const scene = buildScene();
    if (scene !== null) void overlayClient.setScene(scene).catch(() => {});
  }

  function pushNativeAppearanceIfOpen(): void {
    if (!menuShown) return;
    void overlayClient.setTheme(buildOverlayTheme(state.pieAppearance)).catch(() => {});
    if (state.pieAppearance.scale !== nativeLastScale) {
      nativeLastScale = state.pieAppearance.scale;
      void overlayClient.setSurfaceSize(nativeSurfaceSize()).catch(() => {});
    }
    syncNativeScene();
    // The appearance default shapeModel may have changed; load + re-sync
    // (gated by the scene key, so an unchanged shape is a no-op).
    void ensureNativeShapeLoaded().then(() => syncNativeScene());
  }

  let ledBlinkTimers: ReturnType<typeof setTimeout>[] = [];

  /** Blink the LED `pulses` times, then restore the pie base state (on while
   *  open, else off). No-op without LED capability. */
  function blinkLed(pulses: number): void {
    if (!state.daemon.isLedAvailable()) return;
    for (const t of ledBlinkTimers) clearTimeout(t);
    ledBlinkTimers = [];
    const PULSE_MS = 130;
    let at = 0;
    for (let i = 0; i < pulses; i += 1) {
      ledBlinkTimers.push(setTimeout(() => state.daemon.setLed(true), at));
      at += PULSE_MS;
      ledBlinkTimers.push(setTimeout(() => state.daemon.setLed(false), at));
      at += PULSE_MS;
    }
    ledBlinkTimers.push(setTimeout(() => state.daemon.setLed(menuShown), at));
  }

  return {
    onAxes: (values) => driveNativeNav(values),
    onButton: (bnum, pressed) => {
      heldButtons[bnum] = pressed;
      handleTriggerButton(bnum, pressed);
      // Drive a nav frame off the last axes so a button-only gesture fires
      // without waiting for the next axes tick.
      driveNativeNav(lastNativeAxes);
    },
    pushMenuIfOpen: pushNativeMenuIfOpen,
    pushAppearanceIfOpen: pushNativeAppearanceIfOpen,
    syncTriggerReservation,
    reapplyGrab: () => grabArbiter.reapply(),
    applyGrabSetting: () => {
      if (!menuShown) return;
      if (state.inputSettings.grabWhilePieOpen) grabArbiter.acquire('pie');
      else grabArbiter.release('pie');
    },
    setDesktopInterpreter: (di) => {
      desktopInterpreter = di;
    },
    dispatchAction: (id, config) => {
      void runAction(id, config).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`spaceux: desktop button action ${id} failed: ${String(err)}`);
      });
    },
    blinkLed,
    hide: () => {
      if (menuShown) hideMenuWindow();
    },
  };
}
