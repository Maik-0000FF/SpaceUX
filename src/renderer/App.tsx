// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { PieMenu } from './PieMenu';
import { useSpaceMouse } from './hooks/useSpaceMouse';

/**
 * Root renderer component.
 *
 * The Electron main process decides when the menu opens (it sees
 * button events first and captures the cursor position). This
 * component just listens for the resulting MENU_OPEN / MENU_COMMIT
 * IPC events and renders accordingly. Trigger logic does not live
 * here so the renderer stays purely presentational.
 */
export function App() {
  const { axes, daemonStatus } = useSpaceMouse();
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const offOpen = window.spaceux.onMenuOpen(({ x, y }) => {
      setMenuAnchor({ x, y });
    });
    const offCommit = window.spaceux.onMenuCommit(() => {
      // Phase 1.4 will fire the action bound to the currently-
      // highlighted sector here. For now the menu just closes.
      setMenuAnchor(null);
    });
    return () => {
      offOpen();
      offCommit();
    };
  }, []);

  return (
    <div className="root">
      {menuAnchor && <PieMenu axes={axes} position={menuAnchor} />}
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
