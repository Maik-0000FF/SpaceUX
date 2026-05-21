// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * The connected device's button count (#66). Pulled from main on mount
 * for the initial value, then kept live via the EDITOR_DEVICE push so a
 * hotplug swap / (un)plug re-clamps the pickers without reopening the
 * editor (PR 2b). `0` means no device / unknown — the caller falls back
 * to a default range then.
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
    // Live updates: main pushes on every count change (hotplug, daemon
    // (re)connect). A late push overrides the mount-time pull, so the
    // editor tracks the current device even if it changed mid-session.
    const off = window.editor.onDeviceButtonCount((n) => setCount(n));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return count;
}
