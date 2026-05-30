// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PIE_BALANCE_MAX,
  PIE_BALANCE_MIN,
  PIE_BALANCE_STEP,
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
import { MARKER_TOGGLE_TOOLTIPS, SLIDER_TOOLTIPS } from '../tooltips';

import { Tooltip } from './Tooltip';
import styles from './PieSliders.module.scss';

/** A small switch (track + sliding knob) for a pie-marker visibility toggle
 *  (#290), with a hover tooltip. Mirrors the LiveToggle switch styling. */
function MarkerToggle({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Show ${label} markers`}
        className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
        onClick={() => onToggle(!on)}
      >
        <span className={styles.track}>
          <span className={styles.knob} />
        </span>
        <span className={styles.toggleLabel}>{label}</span>
      </button>
    </Tooltip>
  );
}

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
  const {
    appearance: pie,
    setOpacity,
    setLabelScale,
    setIconScale,
    setScale,
    setRingBalance,
    setCenterBalance,
    setShowSubmenuMarkers,
    setShowDepthDots,
  } = usePieAppearance();

  return (
    <div className={styles.panel}>
      {/* Marker visibility toggles (#290), side by side at the top of the
          slider panel. The submenu depth markers (#216) and the depth-dots
          indicator can each be hidden for a cleaner pie. */}
      <div className={styles.toggles}>
        <MarkerToggle
          on={pie.showSubmenuMarkers}
          onToggle={setShowSubmenuMarkers}
          label="Submenus"
          hint={MARKER_TOGGLE_TOOLTIPS.submenu}
        />
        <MarkerToggle
          on={pie.showDepthDots}
          onToggle={setShowDepthDots}
          label="Depth"
          hint={MARKER_TOGGLE_TOOLTIPS.depth}
        />
      </div>
      <label className={styles.control}>
        <Tooltip content={SLIDER_TOOLTIPS.size}>
          <span className={styles.label}>Size</span>
        </Tooltip>
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
        <Tooltip content={SLIDER_TOOLTIPS.opacity}>
          <span className={styles.label}>Opacity</span>
        </Tooltip>
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
        <Tooltip content={SLIDER_TOOLTIPS.label}>
          <span className={styles.label}>Label</span>
        </Tooltip>
        <input
          className={styles.slider}
          type="range"
          min={PIE_LABEL_SCALE_MIN}
          max={PIE_LABEL_SCALE_MAX}
          step={PIE_LABEL_SCALE_STEP}
          value={pie.labelScale}
          onChange={(e) => setLabelScale(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.labelScale * 100)}%</span>
      </label>
      <label className={styles.control}>
        <Tooltip content={SLIDER_TOOLTIPS.icon}>
          <span className={styles.label}>Icon</span>
        </Tooltip>
        <input
          className={styles.slider}
          type="range"
          min={PIE_ICON_SCALE_MIN}
          max={PIE_ICON_SCALE_MAX}
          step={PIE_ICON_SCALE_STEP}
          value={pie.iconScale}
          onChange={(e) => setIconScale(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.iconScale * 100)}%</span>
      </label>
      <label className={styles.control}>
        <Tooltip content={SLIDER_TOOLTIPS.ring}>
          <span className={styles.label}>Ring</span>
        </Tooltip>
        <input
          className={styles.slider}
          type="range"
          min={PIE_BALANCE_MIN}
          max={PIE_BALANCE_MAX}
          step={PIE_BALANCE_STEP}
          value={pie.ringBalance}
          onChange={(e) => setRingBalance(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.ringBalance * 100)}%</span>
      </label>
      <label className={styles.control}>
        <Tooltip content={SLIDER_TOOLTIPS.center}>
          <span className={styles.label}>Center</span>
        </Tooltip>
        <input
          className={styles.slider}
          type="range"
          min={PIE_BALANCE_MIN}
          max={PIE_BALANCE_MAX}
          step={PIE_BALANCE_STEP}
          value={pie.centerBalance}
          onChange={(e) => setCenterBalance(Number(e.target.value))}
        />
        <span className={styles.value}>{Math.round(pie.centerBalance * 100)}%</span>
      </label>
    </div>
  );
}
