// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

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
  PIE_SCALE_MAX,
  PIE_SCALE_MIN,
  PIE_SCALE_STEP,
} from '@/shared/pie-appearance';

import { usePieAppearance } from '../hooks/usePieAppearance';

import styles from './PieSliders.module.scss';

/**
 * Pie value sliders (size · opacity · label · icon), docked top-right of the
 * preview so they're tuned while watching the pie they affect. The companion
 * to the left-bar selectors (theme · navigation style): selectors pick a
 * discrete choice, sliders tune a continuous value.
 *
 * All four are app-level pie appearance now (#186 follow-up: size moved off the
 * per-menu config), so they stay editable whatever the active source — including
 * a read-only Dynamic plugin pie. usePieAppearance also applies the live
 * `--pie-*` vars to the editor's <html>, keeping the preview themed.
 */
export function PieSliders() {
  const { appearance: pie, setOpacity, setLabelScale, setIconScale, setScale } = usePieAppearance();

  return (
    <div className={styles.panel}>
      <label className={styles.control}>
        <span className={styles.label}>Size</span>
        <input
          className={styles.slider}
          type="range"
          min={PIE_SCALE_MIN}
          max={PIE_SCALE_MAX}
          step={PIE_SCALE_STEP}
          value={pie.scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.scale * 100)}%</span>
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
