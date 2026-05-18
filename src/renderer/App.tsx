// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { PieMenu } from './PieMenu';
import { useSpaceMouse } from './hooks/useSpaceMouse';

/**
 * Root renderer component.
 *
 * Owns the connection state (is the daemon reachable?) and forwards
 * live axes to the PieMenu. The menu itself is responsible for the
 * visual logic; this component is the seam between Electron IPC and
 * the React tree.
 */
export function App() {
  const { axes, lastButton, daemonStatus } = useSpaceMouse();
  const [menuOpen, setMenuOpen] = useState(false);

  // Treat Button 1 as the menu trigger for the initial scaffold. The
  // real binding will be configurable via the editor that doesn't
  // exist yet — see plugins + the future settings UI.
  useEffect(() => {
    if (!lastButton) return;
    if (lastButton.bnum !== 0) return;
    if (lastButton.pressed) setMenuOpen(true);
    else setMenuOpen(false);
  }, [lastButton]);

  return (
    <div className="root">
      {menuOpen && <PieMenu axes={axes} />}
      <DaemonStatusIndicator status={daemonStatus} />
    </div>
  );
}

function DaemonStatusIndicator({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  if (status === 'connected') return null;
  return (
    <div className="status-indicator" data-status={status}>
      {status === 'connecting' ? 'connecting to daemon…' : 'daemon disconnected'}
    </div>
  );
}
