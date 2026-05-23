// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PieThemeChoice } from '@/shared/ipc';
import { MAX_PIE_SCALE, MIN_PIE_SCALE } from '@/shared/menu';
import {
  PIE_LABEL_SCALE_MAX,
  PIE_LABEL_SCALE_MIN,
  PIE_LABEL_SCALE_STEP,
  PIE_OPACITY_MAX,
  PIE_OPACITY_MIN,
  PIE_OPACITY_STEP,
} from '@/shared/pie-appearance';

import { usePieAppearance } from '../hooks/usePieAppearance';
import { useMenuSettings } from '../state/menu-settings';

import styles from './PieDesignControls.module.scss';

const SCALE_STEP = 0.05;

/**
 * Pie *design* controls, grouped above the preview (#107): theme + opacity
 * (app-level appearance) and size (the menu.json `scale`). Kept together
 * here, next to the pie they affect, rather than scattered across the
 * toolbar and the Properties sidebar. Menu *structure* (nodes, bindings,
 * navigation) stays in the sidebar.
 *
 * usePieAppearance also applies the live `--pie-*` vars to the editor's
 * <html>, so this component being always-mounted keeps the preview themed.
 */
export function PieDesignControls() {
  const { appearance: pie, setTheme, setOpacity, setLabelScale } = usePieAppearance();
  const scale = useMenuSettings((s) => s.config?.scale ?? 1);
  const setScale = useMenuSettings((s) => s.setScale);
  const hasConfig = useMenuSettings((s) => s.config !== null);

  return (
    <div className={styles.controls}>
      <label className={styles.control}>
        <span className={styles.label}>Theme</span>
        <select
          className={styles.select}
          value={pie.theme}
          onChange={(e) => setTheme(e.target.value as PieThemeChoice)}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="spaceux">SpaceUX</option>
        </select>
      </label>
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
    </div>
  );
}
