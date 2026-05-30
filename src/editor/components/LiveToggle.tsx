// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAppState } from '../state/app-state';

import { Tooltip } from './Tooltip';
import styles from './LiveToggle.module.scss';

/**
 * Toggles "live" preview: when on, the preview highlights the node under
 * the live SpaceMouse puck (so the author can feel the menu) instead of the
 * click selection. Off by default so the puck doesn't fight click editing.
 */
export function LiveToggle() {
  const live = useAppState((s) => s.livePreview);
  const setLive = useAppState((s) => s.setLivePreview);

  return (
    <Tooltip content="Drive the preview highlight with the live SpaceMouse puck">
      <button
        type="button"
        role="switch"
        aria-checked={live}
        className={`${styles.toggle} ${live ? styles.on : ''}`}
        onClick={() => setLive(!live)}
      >
        <span className={styles.track}>
          <span className={styles.knob} />
        </span>
        <span className={styles.text}>Live Preview</span>
      </button>
    </Tooltip>
  );
}
