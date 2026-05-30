// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './Tooltip.module.scss';

const OPEN_DELAY_MS = 150;
/** Gap between the trigger and the bubble. */
const GAP = 8;
/** Keep the bubble this far from the viewport edge. */
const EDGE = 8;

/**
 * App-wide hover/focus tooltip (#279). Wraps a trigger and shows a themed,
 * possibly multi-line bubble on hover or keyboard focus. The bubble is
 * portalled to <body> (like Modal) so a scrolling panel can't clip it, and
 * positioned against the trigger's rect — picking the side with more room and
 * clamping into the viewport.
 *
 * Use this for the controls native `title=` can't style or can't reach with
 * rich content. Native `title` is still the right tool for <option> elements
 * (a portal can't decorate them inside a <select>).
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const show = (): void => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const hide = (): void => {
    clearTimer();
    setOpen(false);
    setCoords(null);
  };

  // Position once on open: measure the trigger + bubble, pick the side with
  // more room, clamp horizontally into the viewport. Runs before paint so the
  // bubble (rendered hidden until coords exist) never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = wrapperRef.current;
    const bubble = bubbleRef.current;
    if (trigger === null || bubble === null) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const above = t.top;
    const below = window.innerHeight - t.bottom;
    const placeAbove = above >= b.height + GAP || above >= below;
    const top = placeAbove ? t.top - GAP - b.height : t.bottom + GAP;
    const centred = t.left + t.width / 2 - b.width / 2;
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - b.width - EDGE));
    setCoords({ left, top });
  }, [open]);

  // The bubble is fixed-positioned from a one-shot measurement, so any layout
  // shift would strand it — dismiss on Escape, scroll, or resize instead of
  // chasing the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open]);

  // Drop a pending open timer if the trigger unmounts mid-hover.
  useEffect(() => () => clearTimer(), []);

  if (content === null || content === undefined || content === '') return <>{children}</>;

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={show}
      onMouseLeave={hide}
      // focusin bubbles up from an inner focusable trigger.
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className={styles.bubble}
            style={
              coords !== null
                ? { left: coords.left, top: coords.top, visibility: 'visible' }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
