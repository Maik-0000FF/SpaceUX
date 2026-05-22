// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

// `@/shared/bridge` ships the `declare global` augmentation that
// types window.spaceux. Side-effect import — the runtime cost is
// nil since the module only contributes a TypeScript ambient
// declaration plus a couple of types.
import '@/shared/bridge';
import type { DaemonStatusPayload } from '@/shared/ipc';

/**
 * React hook that surfaces live SpaceMouse state from the Electron
 * preload bridge.
 *
 * Subscribes once on mount and tears down on unmount. The bridge is
 * exposed by the main process at window.spaceux; the shared bridge
 * module provides the global type so the renderer never has to
 * reach into src/main/.
 */

export type SpaceMouseAxes = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
};

export type DaemonState = 'connecting' | 'connected' | 'disconnected';

const ZERO_AXES: SpaceMouseAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };

export function useSpaceMouse() {
  const [axes, setAxes] = useState<SpaceMouseAxes>(ZERO_AXES);
  // Currently-held buttons, indexed by bnum (`buttons[i]` true while down).
  // A button event re-renders, so a press registers a navigation frame even
  // when the puck is idle and axes aren't ticking.
  const [buttons, setButtons] = useState<readonly boolean[]>([]);
  const [daemonStatus, setDaemonStatus] = useState<DaemonState>('connecting');

  useEffect(() => {
    const offAxes = window.spaceux.onAxes((values) => {
      setAxes({
        tx: values[0],
        ty: values[1],
        tz: values[2],
        rx: values[3],
        ry: values[4],
        rz: values[5],
      });
    });
    const offButton = window.spaceux.onButton(({ bnum, pressed }) => {
      setButtons((prev) => {
        if (prev[bnum] === pressed) return prev; // ignore no-op repeats
        const next = prev.slice();
        next[bnum] = pressed;
        return next;
      });
    });
    const offStatus = window.spaceux.onDaemonStatus((payload: DaemonStatusPayload) => {
      const connected = payload.state === 'connected';
      setDaemonStatus(connected ? 'connected' : 'disconnected');
      // Drop held-button state on disconnect so a stale press can't linger
      // as "down" across a reconnect.
      if (!connected) setButtons([]);
    });
    return () => {
      offAxes();
      offButton();
      offStatus();
    };
  }, []);

  return { axes, buttons, daemonStatus };
}
