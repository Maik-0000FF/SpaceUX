// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAppState } from '../state/app-state';

import styles from './LiveToggle.module.scss';

/**
 * Toggles "live" preview: when on, the preview highlights the sector under
 * the live SpaceMouse puck (so the author can feel the menu) instead of the
 * click selection. Off by default so the puck doesn't fight click editing.
 */
export function LiveToggle() {
  const live = useAppState((s) => s.livePreview);
  const setLive = useAppState((s) => s.setLivePreview);

  return (
    <button
      type="button"
      className={`${styles.toggle} ${live ? styles.on : ''}`}
      aria-pressed={live}
      title="Drive the preview highlight with the live SpaceMouse puck"
      onClick={() => setLive(!live)}
    >
      ● Live
    </button>
  );
}
