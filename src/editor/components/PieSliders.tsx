// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { MAX_PIE_SCALE, MIN_PIE_SCALE } from '@/shared/menu';
import {
  PIE_ICON_SCALE_MAX,
  PIE_ICON_SCALE_MIN,
  PIE_ICON_SCALE_STEP,
  PIE_LABEL_SCALE_MAX,
  PIE_LABEL_SCALE_MIN,
  PIE_LABEL_SCALE_STEP,
  PIE_OPACITY_MAX,
  PIE_OPACITY_MIN,
  PIE_OPACITY_STEP,
} from '@/shared/pie-appearance';

import { usePieAppearance } from '../hooks/usePieAppearance';
import { useMenuSettings } from '../state/menu-settings';

import styles from './PieSliders.module.scss';

const SCALE_STEP = 0.05;

/**
 * Pie value sliders (size · opacity · label · icon), docked top-right of the
 * preview so they're tuned while watching the pie they affect. The companion
 * to the left-bar selectors (theme · navigation style): selectors pick a
 * discrete choice, sliders tune a continuous value.
 *
 * Size is the menu.json `scale`; opacity / label / icon are the app-level
 * appearance. usePieAppearance also applies the live `--pie-*` vars to the
 * editor's <html>, so this being mounted keeps the preview themed.
 */
export function PieSliders() {
  const { appearance: pie, setOpacity, setLabelScale, setIconScale } = usePieAppearance();
  const scale = useMenuSettings((s) => s.config?.scale ?? 1);
  const setScale = useMenuSettings((s) => s.setScale);
  const hasConfig = useMenuSettings((s) => s.config !== null);

  return (
    <div className={styles.panel}>
      <label className={styles.control}>
        <span className={styles.label}>Size</span>
        <input
          className={styles.slider}
          type="range"
          min={MIN_PIE_SCALE}
          max={MAX_PIE_SCALE}
          step={SCALE_STEP}
          value={scale}
          disabled={!hasConfig}
          onChange={(e) => setScale(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(scale * 100)}%</span>
      </label>
      <label className={styles.control}>
        <span className={styles.label}>Opacity</span>
        <input
          className={styles.slider}
          type="range"
          min={PIE_OPACITY_MIN}
          max={PIE_OPACITY_MAX}
          step={PIE_OPACITY_STEP}
          value={pie.opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.opacity * 100)}%</span>
      </label>
      <label className={styles.control}>
        <span className={styles.label}>Label</span>
        <input
          className={styles.slider}
          type="range"
          min={PIE_LABEL_SCALE_MIN}
          max={PIE_LABEL_SCALE_MAX}
          step={PIE_LABEL_SCALE_STEP}
          value={pie.labelScale}
          onChange={(e) => setLabelScale(Number(e.target.value))}
          title="Label size as a fraction of the per-segment fit (100% = fill the segment)"
        />
        <span className={styles.value}>{Math.round(pie.labelScale * 100)}%</span>
      </label>
      <label className={styles.control}>
        <span className={styles.label}>Icon</span>
        <input
          className={styles.slider}
          type="range"
          min={PIE_ICON_SCALE_MIN}
          max={PIE_ICON_SCALE_MAX}
          step={PIE_ICON_SCALE_STEP}
          value={pie.iconScale}
          onChange={(e) => setIconScale(Number(e.target.value))}
          title="Icon size as a fraction of the per-segment fit (100% = fills the segment)"
        />
        <span className={styles.value}>{Math.round(pie.iconScale * 100)}%</span>
      </label>
    </div>
  );
}
