// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { AxesValues } from '@/shared/bridge';

/**
 * Live SpaceMouse axes streamed from main (the same stream the pie uses),
 * or null when not subscribed / no event yet. Only subscribes while
 * `enabled`, so the axis stream doesn't churn renders when live preview is
 * off.
 */
export function useEditorSpaceMouse(enabled: boolean): AxesValues | null {
  const [axes, setAxes] = useState<AxesValues | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAxes(null);
      return;
    }
    return window.editor.onAxes(setAxes);
  }, [enabled]);

  return axes;
}
