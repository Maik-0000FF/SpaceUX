// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { currentSectors, type DrillState } from '@/core/menu-nav';
import { type MenuConfig } from '@/shared/menu';

import { PieMenu } from './PieMenu';
import { useDrillNavigation } from './hooks/useDrillNavigation';
import { usePieAppearance } from './hooks/usePieAppearance';
import { useSpaceMouse } from './hooks/useSpaceMouse';

/**
 * Root renderer component.
 *
 * The Electron main process decides when the menu opens (it sees
 * button events first and captures the cursor position). This
 * component listens for the resulting MENU_OPEN / MENU_COMMIT IPC
 * events and renders accordingly. On commit it resolves the
 * highlighted sector against the supplied menu config and asks main
 * to invoke the bound action.
 *
 * Trigger logic does not live here — the renderer stays purely
 * presentational. Action dispatch is also delegated to main; the
 * renderer just decides *which* binding to ask for.
 */
export function App() {
  const { axes, daemonStatus } = useSpaceMouse();
  usePieAppearance(); // applies data-pie-theme + --pie-opacity to <html>
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  // All puck-driven state (navigation, sticky, rising-edge refs for
  // TZ-cancel / lateral-magnitude / tilt) lives in
  // `useDrillNavigation`. App.tsx just owns the IPC subscription
  // and the render — the hook hides the puck-handling effect so the
  // top-level component stays readable as feature work continues.
  const { drillState, dispatch, drillStateRef, resetTransientRefs } = useDrillNavigation({
    axes,
    menuConfig,
    menuOpen: menuAnchor !== null,
  });

  // configRef lets the IPC commit listener read the latest config
  // without re-subscribing on every config push from main.
  const configRef = useRef(menuConfig);
  configRef.current = menuConfig;

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
        // No selection (puck never left deadzone or TZ-cancelled) →
        // silent dismiss. Tell main to actually hide the window;
        // local state resets so the next open starts clean.
        setMenuAnchor(null);
        dispatch({ type: 'reset' });
        window.spaceux.closeMenu();
        return;
      }
      const current = currentSectors(cfg, navigation);
      const sector = current[stickyChildIndex];
      if (sector?.children) {
        // Branch → drill in. Menu stays visible; main wasn't going
        // to hide it (commit no longer auto-hides post-PR-C), so we
        // just update local state. The next axes frame will start
        // picking sectors from the new (deeper) ring.
        //
        // Land sticky on child[0]: with the outer-ring rotation
        // alignment, sector 0 of the new ring sits at the parent
        // sector's angle — i.e. exactly where the user's puck was
        // pointing. Using the parent's index here would put the
        // sticky on the opposite side of the new ring, producing a
        // visible flash before the next axes frame corrects it.
        dispatch({ type: 'drill', index: stickyChildIndex, nextSticky: 0 });
        return;
      }
      // Leaf (or label-only sector with no binding): close the menu
      // first so the user can't accidentally commit twice, then
      // fire the action if there is one.
      setMenuAnchor(null);
      dispatch({ type: 'reset' });
      window.spaceux.closeMenu();
      if (!sector?.binding) return;
      const { action, config: actionConfig } = sector.binding;
      window.spaceux.invokeAction(action, actionConfig ?? {}).catch((err: unknown) => {
        // Dispatch errors surface here. Main logs the raw failure;
        // we keep a renderer-side console line so a user with the
        // devtools open can see why nothing happened.
        // eslint-disable-next-line no-console
        console.warn(`[action] ${action} failed:`, err);
      });
    });

    return () => {
      offConfig();
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
  const ring = menuConfig ? currentSectors(menuConfig, drillState.navigation) : null;
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
        {ring ? `(${ring.length} sectors)` : '(no config)'}
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
