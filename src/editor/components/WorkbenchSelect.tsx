// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Tooltip } from './Tooltip';
import styles from './WorkbenchSelect.module.scss';

/** One selectable workbench: stable key, display label, whether it's already
 *  curated (● marker), and its own icon (data URI) when the bridge resolved
 *  one (#229). */
export type WorkbenchOption = { key: string; label: string; curated: boolean; icon?: string };

/**
 * Workbench picker for the FreeCAD curated mode (#229 PR3). A custom dropdown
 * rather than a native `<select>` because the latter can't render per-row icons
 * — each row shows the workbench's own icon + name + a ● when already curated.
 *
 * Keyboard-operable like the native select it replaces (#231 review): the
 * trigger opens on Enter/Space/ArrowDown; Arrow/Home/End move the active option
 * (advertised via aria-activedescendant), Enter/Space pick it, Escape/Tab close.
 * Mouse: click to open, hover syncs the active option, click to pick;
 * click-outside closes.
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
  // Keyboard-highlighted option index while open (−1 = none).
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number): string => `${baseId}-opt-${i}`;
  const current = value === null ? null : (workbenches.find((w) => w.key === value) ?? null);

  const openList = (): void => {
    const sel = workbenches.findIndex((w) => w.key === value);
    setActiveIndex(sel >= 0 ? sel : 0);
    setOpen(true);
  };

  const pick = (key: string): void => {
    onSelect(key);
    setOpen(false);
  };

  // Close on a click outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the keyboard-active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    (listRef.current?.children[activeIndex] as HTMLElement | undefined)?.scrollIntoView({
      block: 'nearest',
    });
  }, [open, activeIndex]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(workbenches.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(workbenches.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const w = workbenches[activeIndex];
        if (w) pick(w.key);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <Tooltip content="Pick a workbench to edit its curated pie (● = already curated)">
        <button
          type="button"
          className={styles.trigger}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
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
      </Tooltip>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className={styles.list}
          role="listbox"
          aria-label="Workbenches"
        >
          {workbenches.map((w, i) => (
            <li
              key={w.key}
              id={optionId(i)}
              role="option"
              aria-selected={w.key === value}
              className={[
                styles.option,
                w.key === value ? styles.optionActive : '',
                i === activeIndex ? styles.optionFocused : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => pick(w.key)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {w.icon ? (
                <img className={styles.icon} src={w.icon} alt="" />
              ) : (
                <span className={styles.iconPlaceholder} aria-hidden="true" />
              )}
              <span className={styles.label}>{w.label}</span>
              {w.curated && (
                <Tooltip content="Already curated">
                  <span className={styles.curatedDot} aria-hidden="true">
                    ●
                  </span>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
