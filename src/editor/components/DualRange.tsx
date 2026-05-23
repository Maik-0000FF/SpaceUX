// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import styles from './DualRange.module.scss';

/**
 * A two-handle range slider on one track (#160): a low and a high value the
 * user drags independently, with the band between them highlighted. The
 * handles can't cross — the low is clamped to ≤ high and vice versa — which
 * is exactly the aim hysteresis (hover ≤ engage). Built from two overlaid
 * native range inputs (no slider dependency); their tracks are transparent
 * and pointer-through so each thumb stays grabbable.
 */
export function DualRange({
  min,
  max,
  step = 1,
  low,
  high,
  disabled = false,
  lowLabel,
  highLabel,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  low: number;
  high: number;
  disabled?: boolean;
  /** ARIA labels for the two thumbs. */
  lowLabel?: string;
  highLabel?: string;
  onChange: (low: number, high: number) => void;
}) {
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;

  return (
    <div className={styles.wrap}>
      <div className={styles.track} />
      <div
        className={styles.fill}
        style={{ left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%` }}
      />
      <input
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={low}
        disabled={disabled}
        aria-label={lowLabel}
        // Can't pass the high handle — clamp up to it.
        onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
      />
      <input
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={high}
        disabled={disabled}
        aria-label={highLabel}
        // Can't drop below the low handle — clamp up from it.
        onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
      />
    </div>
  );
}
