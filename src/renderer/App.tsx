// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useReducer, useRef, useState } from 'react';

import {
  INITIAL_DRILL_STATE,
  currentSectors,
  drillReducer,
  navigationRingRotation,
  type DrillState,
} from '@/core/menu-nav';
import {
  axesMagnitude,
  axesToSector,
  DEFAULT_PIE_GEOMETRY,
  rotateAxes,
  shouldCancelOnZ,
} from '@/core/pie-geometry';
import { resolveAxisInvert, type MenuConfig } from '@/shared/menu';

import { PieMenu } from './PieMenu';
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
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Navigation + sticky selection.
  //
  // The reducer carries both pieces because every commit/TZ-edge
  // resets the selection alongside changing the navigation depth.
  // Keeping them in one state means React batches the two updates
  // and the renderer never sees a transient "old selection in new
  // ring" frame.
  //
  // Pure helpers in @/core/menu-nav let vitest pin every transition
  // without a renderer harness. The app code below is just the glue
  // that maps puck/IPC events onto reducer actions.
  const [drillState, dispatch] = useReducer(drillReducer, INITIAL_DRILL_STATE);

  // Refs let the commit listener read the latest values without
  // re-subscribing on every frame.
  const drillStateRef = useRef<DrillState>(drillState);
  drillStateRef.current = drillState;
  const configRef = useRef(menuConfig);
  configRef.current = menuConfig;

  // TZ-cancel was edge-triggered already for "clear selection".
  // Tracking the previous frame's deflection lets us *also* fire a
  // single pop on the rising edge when the user is drilled in,
  // without popping every frame while the puck is held.
  const wasCancelingRef = useRef<boolean>(false);
  // Mirror of the cancel-ref for the optional magnitude-drill
  // feature: tracks whether the *previous* frame already had the
  // puck deflected past `magnitudeDrill.threshold`, so a sustained
  // push only fires a single drill rather than cascading through
  // every nested level. Stays at `false` for users who haven't
  // enabled the feature, so the cost is one boolean read per frame.
  const wasMagnitudeOverRef = useRef<boolean>(false);

  // Update sticky selection (and possibly pop the navigation stack)
  // as the puck moves. Only fires reducer dispatches when something
  // actually changes — the reducer short-circuits identity-matching
  // states so React doesn't churn on every puck frame.
  //
  // Z-axis (push OR pull) is the explicit cancel/back. Below the
  // deadzone the lateral axes pick the sector in the current ring;
  // crossing the deadzone clears the selection (cancel target
  // lights up) and, if the user has drilled in, pops one level on
  // the rising edge. Direction-agnostic on purpose — saves users
  // learning their puck's TZ polarity.
  useEffect(() => {
    if (!menuAnchor || !menuConfig) return;
    const canceling = shouldCancelOnZ(axes.tz, DEFAULT_PIE_GEOMETRY.deadzone);
    const tzRising = canceling && !wasCancelingRef.current;
    wasCancelingRef.current = canceling;

    if (canceling) {
      // Edge-trigger only: a sustained TZ should not keep
      // re-firing or re-clearing state. The rising edge picks the
      // right transition based on depth — pop one level when
      // drilled, clear sticky at top level so the cancel target
      // lights up and a commit becomes a silent dismiss.
      if (tzRising) {
        if (drillStateRef.current.navigation.length > 0) {
          dispatch({ type: 'pop' });
        } else {
          dispatch({ type: 'hover', index: null });
        }
      }
      return;
    }

    const navigation = drillStateRef.current.navigation;
    const current = currentSectors(menuConfig, navigation);
    const invert = resolveAxisInvert(menuConfig);

    // Outer ring rotates so its first sector aligns with the
    // parent sector the user drilled in from (see PieMenu). The
    // puck-to-sector mapping has to follow that rotation — rotate
    // the lateral axes by -offset before resolving, so a "push
    // toward the parent" still resolves to the same visual sector
    // it points at. The rotation formula is shared with PieMenu
    // via `navigationRingRotation` so the two sites cannot
    // silently disagree.
    const ringRotation = navigationRingRotation(menuConfig, navigation);
    const rotated = rotateAxes({ tx: axes.tx, ty: axes.ty }, -ringRotation);

    const rawSec = axesToSector(rotated, {
      ...DEFAULT_PIE_GEOMETRY,
      sectorCount: current.length,
      invertX: invert.x,
      invertY: invert.y,
    });
    // axesToSector clamps sectorCount to a minimum of 2 internally
    // (the math falls apart below that), so a 1-child ring can
    // return index 1 — which no wedge owns. Clamp on the way out
    // so the sticky always lands on an existing sector.
    const sec = rawSec === null ? null : rawSec % current.length;

    // Optional puck-magnitude drill: when configured and enabled,
    // crossing the threshold from below while hovering a branch
    // sector auto-drills into it. The check sits *between* the
    // hover dispatch and the rest of the frame so a drilled-in
    // frame already has the correct sticky set on the new ring.
    //
    // Rising-edge only: the puck has to dip back below the
    // threshold before another magnitude-drill can fire. Without
    // this, a sustained push past the threshold would cascade
    // through every nested branch in a single gesture.
    const drillConfig = menuConfig.magnitudeDrill;
    const magnitudeOver =
      drillConfig?.enabled === true &&
      axesMagnitude({ tx: axes.tx, ty: axes.ty }) >= drillConfig.threshold;
    const magnitudeRising = magnitudeOver && !wasMagnitudeOverRef.current;
    wasMagnitudeOverRef.current = magnitudeOver;

    if (magnitudeRising && sec !== null) {
      const hovered = current[sec];
      if (hovered?.children) {
        // child[0] aligns with the parent sector's angle thanks to
        // the outer-ring rotation, so landing sticky on 0 matches
        // the user's puck direction without the brief wrong-child
        // flash that `Math.min(sec, ...)` would produce.
        dispatch({ type: 'drill', index: sec, nextSticky: 0 });
        return;
      }
    }

    if (sec !== null) dispatch({ type: 'hover', index: sec });
    // `drillState.navigation` is read via `drillStateRef`, not from
    // the dep array. axes ticks frequently enough that the next
    // frame always picks up a fresh post-drill navigation; adding
    // `drillState` here would re-run the effect on every reducer
    // dispatch, defeating the identity short-circuits inside it.
  }, [axes, menuAnchor, menuConfig]);

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
      // carry over.
      dispatch({ type: 'reset' });
      wasCancelingRef.current = false;
      wasMagnitudeOverRef.current = false;
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
