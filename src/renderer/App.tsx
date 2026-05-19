// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { axesToSector, DEFAULT_PIE_GEOMETRY, shouldCancelOnZ } from '@/core/pie-geometry';
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
  // Sticky selection: latest non-deadzone sector the user pointed at.
  // The pie highlights this sector and the commit handler fires its
  // binding, even after the puck has snapped back to centre — so the
  // user can release the puck and *then* press the trigger without
  // losing the selection.
  const [stickySector, setStickySector] = useState<number | null>(null);

  // Refs let the commit listener read the latest values without
  // re-subscribing on every frame.
  const stickySectorRef = useRef<number | null>(null);
  stickySectorRef.current = stickySector;
  const configRef = useRef(menuConfig);
  configRef.current = menuConfig;

  // Update sticky selection as the puck moves. Only writes when the
  // axes leave the deadzone, so a return-to-centre preserves the
  // user's last choice — they can release the puck and then commit.
  //
  // Z-axis (push OR pull) is the explicit cancel: any TZ deflection
  // past the deadzone in either direction clears the sticky selection,
  // the central "cancel" target lights up, and a commit silently
  // dismisses. Direction-agnostic on purpose — neither sign is
  // intuitively "more cancel" than the other, and accepting both
  // saves users from learning the polarity of their specific puck.
  useEffect(() => {
    if (!menuAnchor || !menuConfig) return;
    if (shouldCancelOnZ(axes.tz, DEFAULT_PIE_GEOMETRY.deadzone)) {
      if (stickySector !== null) setStickySector(null);
      return;
    }
    const invert = resolveAxisInvert(menuConfig);
    const sec = axesToSector(
      { tx: axes.tx, ty: axes.ty },
      {
        ...DEFAULT_PIE_GEOMETRY,
        sectorCount: menuConfig.sectors.length,
        invertX: invert.x,
        invertY: invert.y,
      },
    );
    if (sec !== null && sec !== stickySector) {
      setStickySector(sec);
    }
  }, [axes, menuAnchor, menuConfig, stickySector]);

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
      // Every menu open starts with a clean selection slate so a
      // previous session's leftover doesn't fire when the user only
      // wanted to open + close.
      setStickySector(null);
      setMenuAnchor({ x, y });
    });
    const offCommit = window.spaceux.onMenuCommit(() => {
      const cfg = configRef.current;
      const sectorIndex = stickySectorRef.current;
      setMenuAnchor(null);
      setStickySector(null);
      if (!cfg || sectorIndex === null) return; // Never left deadzone → silent dismiss.
      const sector = cfg.sectors[sectorIndex];
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
          activeSector={stickySector}
        />
      )}
      <DaemonStatusIndicator status={daemonStatus} />
      <DebugPanel
        daemonStatus={daemonStatus}
        axes={axes}
        menuOpen={menuAnchor !== null}
        menuConfig={menuConfig}
        stickySector={stickySector}
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
  stickySector,
}: {
  daemonStatus: 'connecting' | 'connected' | 'disconnected';
  axes: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number };
  menuOpen: boolean;
  menuConfig: import('@/shared/menu').MenuConfig | null;
  stickySector: number | null;
}) {
  const fmt = (n: number) => n.toString().padStart(5, ' ');
  const selectedLabel =
    menuConfig && stickySector !== null ? (menuConfig.sectors[stickySector]?.label ?? '?') : '—';
  return (
    <div className="debug-panel" data-status={daemonStatus}>
      <div className="debug-row">
        <strong>daemon:</strong> {daemonStatus}
      </div>
      <div className="debug-row">
        <strong>menu:</strong> {menuOpen ? 'OPEN' : 'closed'}{' '}
        {menuConfig ? `(${menuConfig.sectors.length} sectors)` : '(no config)'}
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
