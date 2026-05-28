// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OUTER_RING_OUTER_RATIO, ringRadii } from '@/core/pie-geometry';
import { currentBranches, type DrillState } from '@/core/menu-nav';
import { resolveShapeModel, type ActionRef, type MenuConfig, type MenuNode } from '@/shared/menu';
import { type PieBadges } from '@/shared/ipc';
import { type ShapeRingRadii } from '@/shared/shape-plugin-api';

import { PieMenu } from './PieMenu';
import { useDrillNavigation } from './hooks/useDrillNavigation';
import { usePieAppearance } from './hooks/usePieAppearance';
import { useSpaceMouse } from './hooks/useSpaceMouse';
import { useShapeModules } from './state/shape-modules';

/** Fire a node's action through main, swallowing nothing — dispatch
 *  failures surface on the renderer console so a user with devtools
 *  open can see why an action did nothing. A no-op when the action is
 *  absent (label-only node, or a centre set to plain dismiss).
 *  Module-level so both the commit listener and the puck-gesture
 *  callbacks share one implementation. */
function fireAction(action: ActionRef | undefined): void {
  if (!action) return;
  const { id, config } = action;
  window.spaceux.invokeAction(id, config ?? {}).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[action] ${id} failed:`, err);
  });
}

/**
 * Root renderer component.
 *
 * The Electron main process decides when the menu opens (it sees
 * button events first and captures the cursor position). This
 * component listens for the resulting MENU_OPEN / MENU_COMMIT IPC
 * events and renders accordingly. On commit it resolves the
 * highlighted node against the supplied menu config and asks main
 * to invoke its action.
 *
 * Trigger logic does not live here — the renderer stays purely
 * presentational. Action dispatch is also delegated to main; the
 * renderer just decides *which* binding to ask for.
 */
export function App() {
  const { axes, buttons, daemonStatus } = useSpaceMouse();
  // Applies data-pie-theme + --pie-opacity to <html>; the returned value
  // feeds iconScale into PieMenu (the icon is a JS-computed SVG dimension).
  const pieAppearance = usePieAppearance();
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Pie corner indicators (#186 / #229): the active plugin's app icon (bottom-
  // left) + the active workbench's icon (bottom-right), pushed by main just
  // before MENU_OPEN.
  const [pieBadges, setPieBadges] = useState<PieBadges>({ plugin: null, workbench: null });

  // configRef lets the IPC commit listener and the puck-gesture
  // callbacks read the latest config without re-subscribing on every
  // config push from main.
  const configRef = useRef(menuConfig);
  configRef.current = menuConfig;

  // Close the menu with no action — the back/pop gesture's top-level
  // outcome. Stable identity (only a state setter + IPC, no reactive
  // deps) so the per-frame puck effect that depends on it doesn't
  // re-subscribe. The drill-state reset is the hook's job; here we just
  // hide the window.
  const dismissMenu = useCallback(() => {
    setMenuAnchor(null);
    window.spaceux.closeMenu();
  }, []);

  // Commit the center field: hide the window, then fire its binding (or
  // nothing when it has none — a plain dismiss). Read through configRef
  // so this stays stable across config hot-reloads.
  const commitCenter = useCallback(() => {
    setMenuAnchor(null);
    window.spaceux.closeMenu();
    fireAction(configRef.current?.root.action);
  }, []);

  // Fire the hovered leaf via its per-item activation gesture (#130 R2).
  // Mirrors the leaf-commit path: close the window unless the node is
  // keepOpen (so a continuous action can re-fire), then invoke its
  // action. The drill-state reset is the hook's job (like commitCenter),
  // so this stays a stable, dep-free callback. The hook only emits this
  // for a leaf with an action, but the optional access stays defensive.
  const activateNode = useCallback((node: MenuNode | undefined) => {
    if (!node?.keepOpen) {
      setMenuAnchor(null);
      window.spaceux.closeMenu();
    }
    fireAction(node?.action);
  }, []);

  // All puck-driven state (navigation, sticky, rising-edge refs for the
  // back / center-activation / drill gestures) lives in
  // `useDrillNavigation`. App.tsx owns the IPC subscription, the render,
  // and the close callbacks the hook invokes when an axis gesture
  // dismisses or commits the center.
  // Shape-plugin context (#107 PR3c). Resolve the effective shape model
  // from the menu config (per-menu override) layered over the appearance
  // default; load the module via the live-overlay shape-modules store
  // (lazy, coalesced). When both the appearance and the module are
  // ready, hand `useDrillNavigation` a `shapeContext` so its hit-test
  // path routes through the plugin's `hitTest` instead of the wedge
  // `axesToSector`. `null` keeps the wedge default active.
  const effectiveShape = menuConfig
    ? resolveShapeModel(menuConfig.shapeModel, pieAppearance.shapeModel)
    : null;
  const shapePluginId =
    effectiveShape !== null
      ? effectiveShape.includes('/')
        ? effectiveShape.split('/', 1)[0]!
        : effectiveShape
      : null;
  const ensureShapeLoaded = useShapeModules((s) => s.ensureLoaded);
  const shapeModuleEntry = useShapeModules((s) =>
    shapePluginId !== null ? s.modules[shapePluginId] : undefined,
  );
  useEffect(() => {
    if (shapePluginId !== null) void ensureShapeLoaded(shapePluginId);
  }, [shapePluginId, ensureShapeLoaded]);

  // Ring radii in the same packing the plugin contract expects, derived
  // from the live overlay's footprint + balance sliders. Memoised on the
  // scalar inputs so the closure identity inside `useDrillNavigation`
  // stays stable across non-relevant renders.
  const liveShapeRingRadii = useMemo<ShapeRingRadii>(() => {
    const footprint = 240 * OUTER_RING_OUTER_RATIO;
    const rings = ringRadii(footprint, pieAppearance.ringBalance, pieAppearance.centerBalance);
    return {
      cancelRadius: rings.cancel,
      innerInnerRadius: rings.cancel,
      innerOuterRadius: rings.innerOuter,
      innerLabelRadius: rings.innerLabel,
      outerInnerRadius: rings.outerInner,
      outerOuterRadius: rings.outerOuter,
      outerLabelRadius: rings.outerLabel,
    };
  }, [pieAppearance.ringBalance, pieAppearance.centerBalance]);

  const shapeContext = useMemo(
    () =>
      shapeModuleEntry?.status === 'ready'
        ? { module: shapeModuleEntry.module, ringRadii: liveShapeRingRadii }
        : null,
    [shapeModuleEntry, liveShapeRingRadii],
  );

  const { drillState, dispatch, drillStateRef, resetTransientRefs, activeShapeLayout } =
    useDrillNavigation({
      axes,
      buttons,
      menuConfig,
      menuOpen: menuAnchor !== null,
      onDismiss: dismissMenu,
      onCommitCenter: commitCenter,
      onActivate: activateNode,
      shapeContext,
    });

  // Universal escape hatch: Escape always closes the open pie, regardless of
  // trigger mode or which gestures are bound. Guarantees closability even
  // for a config that binds nothing to back/commit/cancel (e.g. open mode
  // with every navigation gesture unbound) — which otherwise has no way out.
  useEffect(() => {
    if (menuAnchor === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      dispatch({ type: 'reset' });
      dismissMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuAnchor, dispatch, dismissMenu]);

  useEffect(() => {
    // Pull once on mount so we never miss the initial config to a
    // startup race; the push channel handles hot-reloads later.
    window.spaceux
      .getMenuConfig()
      .then((cfg) => setMenuConfig(cfg))
      .catch(() => {
        // Main returned null (loader hadn't completed yet). The
        // hot-reload push will catch us up shortly; a noop here is
        // the right behaviour.
      });
    const offConfig = window.spaceux.onMenuConfig((config) => {
      setMenuConfig(config);
    });
    const offBadge = window.spaceux.onPieBadge((badges) => setPieBadges(badges));
    const offOpen = window.spaceux.onMenuOpen(({ x, y }) => {
      // Every menu open starts with a clean slate so a previous
      // session's leftover (selection AND drilled-in depth) doesn't
      // carry over. `resetTransientRefs` arms the rising-edge
      // memories inside the hook to "already over", so a held puck
      // at trigger time can't fire a drill/pop/cancel on the first
      // frame — the user has to dip the gesture back under its
      // threshold and re-engage to commit.
      dispatch({ type: 'reset' });
      resetTransientRefs();
      setMenuAnchor({ x, y });
    });
    const offCommit = window.spaceux.onMenuCommit(() => {
      const cfg = configRef.current;
      const { navigation, stickyChildIndex } = drillStateRef.current;
      if (!cfg || stickyChildIndex === null) {
        // No node selected (puck centered, or TZ-cancelled) → the
        // centre (root) wins. Hide the window first so a second commit
        // can't double-fire, reset local state for a clean next open,
        // then invoke the root's action if it has one. No action
        // (or no config) → silent dismiss, the historical cancel.
        setMenuAnchor(null);
        dispatch({ type: 'reset' });
        window.spaceux.closeMenu();
        fireAction(cfg?.root.action);
        return;
      }
      const current = currentBranches(cfg, navigation);
      const node = current[stickyChildIndex];
      if (node?.branches) {
        // Branch → drill in. Menu stays visible; main wasn't going
        // to hide it (commit no longer auto-hides post-PR-C), so we
        // just update local state. The next axes frame will start
        // picking nodes from the new (deeper) ring.
        //
        // Land at the child ring's centre (no selection) so entering a
        // submenu is identical to entering the top ring from the centre —
        // aim or twist onto an item. For continuous aiming the next axes
        // frame re-hovers from the live puck; a twist style steps in from
        // the centre.
        dispatch({ type: 'drill', index: stickyChildIndex, nextSticky: null });
        return;
      }
      // Leaf (or label-only node with no action): close the menu
      // first so the user can't accidentally commit twice, then
      // fire the action if there is one. A keepOpen node stays
      // visible after firing — for continuous actions (e.g. nudging
      // volume via twist) where re-committing without reopening is
      // the point; the sticky selection is left intact so the next
      // commit re-fires the same node.
      if (!node?.keepOpen) {
        setMenuAnchor(null);
        dispatch({ type: 'reset' });
        window.spaceux.closeMenu();
      }
      fireAction(node?.action);
    });

    return () => {
      offConfig();
      offBadge();
      offOpen();
      offCommit();
    };
  }, []);

  return (
    <div className="root">
      {menuAnchor && menuConfig && (
        <PieMenu
          axes={axes}
          position={menuAnchor}
          config={menuConfig}
          navigation={drillState.navigation}
          activeSector={drillState.stickyChildIndex}
          iconScale={pieAppearance.iconScale}
          scale={pieAppearance.scale}
          ringBalance={pieAppearance.ringBalance}
          centerBalance={pieAppearance.centerBalance}
          shapeLayout={activeShapeLayout}
          badge={pieBadges.plugin}
          workbenchBadge={pieBadges.workbench}
        />
      )}
      <DaemonStatusIndicator status={daemonStatus} />
      <DebugPanel
        daemonStatus={daemonStatus}
        axes={axes}
        menuOpen={menuAnchor !== null}
        menuConfig={menuConfig}
        drillState={drillState}
      />
    </div>
  );
}

/**
 * Always-visible debug card in the top-right corner. Renders only
 * outside packaged builds (`spaceux` runs from the dev npm start)
 * so end-users never see it. Lets a developer watch axes flow,
 * confirm the daemon is connected, and see the menu open/close
 * lifecycle without having to read DevTools logs.
 */
function DebugPanel({
  daemonStatus,
  axes,
  menuOpen,
  menuConfig,
  drillState,
}: {
  daemonStatus: 'connecting' | 'connected' | 'disconnected';
  axes: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number };
  menuOpen: boolean;
  menuConfig: import('@/shared/menu').MenuConfig | null;
  drillState: DrillState;
}) {
  const fmt = (n: number) => n.toString().padStart(5, ' ');
  const ring = menuConfig ? currentBranches(menuConfig, drillState.navigation) : null;
  const selectedLabel =
    ring && drillState.stickyChildIndex !== null
      ? (ring[drillState.stickyChildIndex]?.label ?? '?')
      : '—';
  // Show the navigation path so a developer can see at a glance
  // whether the user has drilled in. Empty path renders as "top".
  const navLabel = drillState.navigation.length === 0 ? 'top' : drillState.navigation.join(' → ');
  return (
    <div className="debug-panel" data-status={daemonStatus}>
      <div className="debug-row">
        <strong>daemon:</strong> {daemonStatus}
      </div>
      <div className="debug-row">
        <strong>menu:</strong> {menuOpen ? 'OPEN' : 'closed'}{' '}
        {ring ? `(${ring.length} nodes)` : '(no config)'}
      </div>
      <div className="debug-row">
        <strong>nav:</strong> {navLabel}
      </div>
      <div className="debug-row">
        <strong>selected:</strong> {selectedLabel}
      </div>
      <div className="debug-row mono">
        TX {fmt(axes.tx)} TY {fmt(axes.ty)} TZ {fmt(axes.tz)}
      </div>
      <div className="debug-row mono">
        RX {fmt(axes.rx)} RY {fmt(axes.ry)} RZ {fmt(axes.rz)}
      </div>
    </div>
  );
}

function DaemonStatusIndicator({
  status,
}: {
  status: 'connecting' | 'connected' | 'disconnected';
}) {
  if (status === 'connected') return null;
  return (
    <div className="status-indicator" data-status={status}>
      {status === 'connecting' ? 'connecting to daemon…' : 'daemon disconnected'}
    </div>
  );
}
