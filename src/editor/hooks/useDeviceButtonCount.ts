// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * The connected device's button count, pulled from main on mount (#66).
 * `0` means no device / unknown, in which case the caller falls back to
 * a default range. Pull-only for now; a live update on a hotplug swap
 * arrives with the daemon's device-changed push (#66 PR 2b).
 */
export function useDeviceButtonCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.editor
      .getDeviceButtonCount()
      .then((n) => {
        if (!cancelled) setCount(n);
      })
      .catch(() => {
        // No device / pull failed → keep 0; caller falls back.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}
