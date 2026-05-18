// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { DaemonStatusPayload } from '@/shared/ipc';

import type { SpaceUxBridge } from '../../main/preload';

/**
 * React hook that surfaces live SpaceMouse state from the Electron
 * preload bridge.
 *
 * Subscribes once on mount and tears down on unmount. The bridge is
 * exposed by the main process at window.spaceux; the cast below
 * imports the type from the preload module for editor support
 * without dragging Electron's runtime into the renderer bundle.
 */

declare global {
  interface Window {
    spaceux: SpaceUxBridge;
  }
}

export type SpaceMouseAxes = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
};

export type SpaceMouseButtonEvent = { bnum: number; pressed: boolean };

export type DaemonState = 'connecting' | 'connected' | 'disconnected';

const ZERO_AXES: SpaceMouseAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };

export function useSpaceMouse() {
  const [axes, setAxes] = useState<SpaceMouseAxes>(ZERO_AXES);
  const [lastButton, setLastButton] = useState<SpaceMouseButtonEvent | null>(null);
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
    const offButton = window.spaceux.onButton(setLastButton);
    const offStatus = window.spaceux.onDaemonStatus((payload: DaemonStatusPayload) => {
      setDaemonStatus(payload.state === 'connected' ? 'connected' : 'disconnected');
    });
    return () => {
      offAxes();
      offButton();
      offStatus();
    };
  }, []);

  return { axes, lastButton, daemonStatus };
}
