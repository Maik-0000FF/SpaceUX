// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import styles from './WorkbenchSelect.module.scss';

/** One selectable workbench: stable key, display label, whether it's already
 *  curated (● marker), and its own icon (data URI) when the bridge resolved
 *  one (#229). */
export type WorkbenchOption = { key: string; label: string; curated: boolean; icon?: string };

/**
 * Workbench picker for the FreeCAD curated mode (#229 PR3). A custom dropdown
 * rather than a native `<select>` because the latter can't render per-row icons
 * — each row shows the workbench's own icon + name + a ● when already curated.
 * Click / Escape / click-outside close it.
 */
export function WorkbenchSelect({
  workbenches,
  value,
  disabled = false,
  onSelect,
}: {
  workbenches: WorkbenchOption[];
  /** The selected workbench key, or null when none is picked yet. */
  value: string | null;
  disabled?: boolean;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = value === null ? null : (workbenches.find((w) => w.key === value) ?? null);

  // Close on a click outside the control or on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (key: string): void => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Pick a workbench to edit its curated pie (● = already curated)"
      >
        {current ? (
          <>
            {current.icon ? (
              <img className={styles.icon} src={current.icon} alt="" />
            ) : (
              <span className={styles.iconPlaceholder} aria-hidden="true" />
            )}
            <span className={styles.label}>{current.label}</span>
          </>
        ) : (
          <span className={styles.placeholder}>Select a workbench…</span>
        )}
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.list} role="listbox">
          {workbenches.map((w) => (
            <li
              key={w.key}
              role="option"
              aria-selected={w.key === value}
              className={
                w.key === value ? `${styles.option} ${styles.optionActive}` : styles.option
              }
              onClick={() => pick(w.key)}
            >
              {w.icon ? (
                <img className={styles.icon} src={w.icon} alt="" />
              ) : (
                <span className={styles.iconPlaceholder} aria-hidden="true" />
              )}
              <span className={styles.label}>{w.label}</span>
              {w.curated && (
                <span className={styles.curatedDot} aria-hidden="true" title="Already curated">
                  ●
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
