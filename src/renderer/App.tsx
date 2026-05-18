// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { axesToSector, DEFAULT_PIE_GEOMETRY } from '@/core/pie-geometry';
import type { MenuConfig } from '@/shared/menu';

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

  // The commit handler needs the latest axes at the moment the
  // trigger is released — not the axes value captured when the
  // handler was wired up. A ref tracks the live value so the
  // listener can read it without re-subscribing on every frame.
  const axesRef = useRef(axes);
  axesRef.current = axes;
  const configRef = useRef(menuConfig);
  configRef.current = menuConfig;

  useEffect(() => {
    const offConfig = window.spaceux.onMenuConfig((config) => {
      setMenuConfig(config);
    });
    const offOpen = window.spaceux.onMenuOpen(({ x, y }) => {
      setMenuAnchor({ x, y });
    });
    const offCommit = window.spaceux.onMenuCommit(() => {
      const cfg = configRef.current;
      const liveAxes = axesRef.current;
      setMenuAnchor(null);
      if (!cfg) return;

      const sectorIndex = axesToSector(
        { tx: liveAxes.tx, ty: liveAxes.ty },
        { ...DEFAULT_PIE_GEOMETRY, sectorCount: cfg.sectors.length },
      );
      if (sectorIndex === null) return; // Inside deadzone → dismiss without firing.
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
        <PieMenu axes={axes} position={menuAnchor} config={menuConfig} />
      )}
      <DaemonStatusIndicator status={daemonStatus} />
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
