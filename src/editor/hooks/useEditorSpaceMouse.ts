// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { AxesValues } from '@/shared/bridge';

/**
 * Live SpaceMouse axes streamed from main (the same stream the pie uses),
 * or null when not subscribed / no event yet. Only subscribes while
 * `enabled`, so the axis stream doesn't churn renders when live preview is
 * off.
 *
 * Also reports the live state to main (`setLive`) so it can suppress the
 * real overlay pie while the editor drives the preview, and skip forwarding
 * axes when no one is listening. Co-located with the subscription so the
 * on/off signal is symmetric across disable *and* unmount.
 */
export function useEditorSpaceMouse(enabled: boolean): AxesValues | null {
  const [axes, setAxes] = useState<AxesValues | null>(null);

  useEffect(() => {
    window.editor.setLive(enabled);
    if (!enabled) {
      setAxes(null);
      return () => window.editor.setLive(false);
    }
    const unsubscribe = window.editor.onAxes(setAxes);
    return () => {
      window.editor.setLive(false);
      unsubscribe();
    };
  }, [enabled]);

  return axes;
}
