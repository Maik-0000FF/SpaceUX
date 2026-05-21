// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { EditorDeviceInfo } from '@/shared/ipc';

/** No-device / unknown state: button pickers fall back to a default
 *  range (#66) and the active-device display shows "no device". */
const NO_DEVICE: EditorDeviceInfo = {
  buttons: 0,
  vendor: 0,
  product: 0,
  name: '',
  profileId: null,
};

/**
 * The connected device as the editor sees it (#66, #113): button count
 * (clamps the pickers), USB identity + model name, and the active profile
 * id. Pulled from main on mount, then kept live via the EDITOR_DEVICE push
 * so a hotplug swap / (un)plug / profile switch updates the pickers and the
 * active-device display without reopening the editor.
 */
export function useDeviceInfo(): EditorDeviceInfo {
  const [info, setInfo] = useState<EditorDeviceInfo>(NO_DEVICE);

  useEffect(() => {
    let cancelled = false;
    window.editor
      .getDeviceInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        // No device / pull failed → keep NO_DEVICE; callers fall back.
      });
    // Live updates: a late push overrides the mount-time pull, so the
    // editor tracks the current device even if it changed mid-session.
    const off = window.editor.onDeviceInfo((next) => setInfo(next));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return info;
}
