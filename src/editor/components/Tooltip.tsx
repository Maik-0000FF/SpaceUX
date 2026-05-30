// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './Tooltip.module.scss';

const OPEN_DELAY_MS = 150;
/** Gap between the trigger and the bubble. */
const GAP = 8;
/** Keep the bubble this far from the viewport edge. */
const EDGE = 8;
/** Triggers that signal their own interactivity — they keep their own cursor;
 *  a non-interactive trigger (a label) gets a help cursor to cue the tooltip. */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label']);

/**
 * App-wide hover/focus tooltip (#279). Shows a themed, possibly multi-line
 * bubble on hover or keyboard focus of its trigger. The bubble is portalled to
 * <body> (like Modal) so a scrolling panel can't clip it, and positioned
 * against the trigger's rect — picking the side with more room and clamping
 * into the viewport on both axes.
 *
 * The single child element IS the trigger: we clone it to attach our handlers,
 * the measuring ref, and `aria-describedby`, rather than wrapping it. That
 * keeps the child's own layout (so a grid-placed label stays a grid item) and
 * puts the description on the real, focusable control so assistive tech
 * announces it. A non-focusable trigger (a plain label) is therefore reachable
 * by hover only — by design; rich keyboard help would mean adding tab stops.
 *
 * Use this for controls native `title=` can't style or reach with rich
 * content. Native `title` is still the right tool for <option> elements (a
 * portal can't decorate them inside a <select>).
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
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
  // more room, clamp into the viewport on both axes. Runs before paint so the
  // bubble (rendered hidden until coords exist) never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (trigger === null || bubble === null) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const above = t.top;
    const below = window.innerHeight - t.bottom;
    const placeAbove = above >= b.height + GAP || above >= below;
    const rawTop = placeAbove ? t.top - GAP - b.height : t.bottom + GAP;
    const centred = t.left + t.width / 2 - b.width / 2;
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - b.width - EDGE));
    const top = Math.max(EDGE, Math.min(rawTop, window.innerHeight - b.height - EDGE));
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

  if (content === null || content === undefined || content === '') return children;

  // Compose with the child's own props rather than clobbering them: chain any
  // handlers it already declares, merge (not replace) its aria-describedby, and
  // add a help-cursor class only when the trigger isn't self-evidently
  // interactive (a button keeps its pointer).
  const childProps = children.props as {
    className?: string;
    ref?: Ref<HTMLElement>;
    onMouseEnter?: (e: unknown) => void;
    onMouseLeave?: (e: unknown) => void;
    onFocus?: (e: unknown) => void;
    onBlur?: (e: unknown) => void;
    'aria-describedby'?: string;
  };
  // Forward the child's own ref (React 19 exposes it as a prop) alongside our
  // measuring ref, so a trigger that needs a ref (e.g. the tree's focusable
  // rows) keeps it instead of having it clobbered.
  const childRef = childProps.ref;
  const setTriggerRef = (el: HTMLElement | null): void => {
    triggerRef.current = el;
    if (typeof childRef === 'function') childRef(el);
    else if (childRef != null) (childRef as { current: HTMLElement | null }).current = el;
  };
  const interactive = typeof children.type === 'string' && INTERACTIVE_TAGS.has(children.type);
  const className =
    [childProps.className, interactive ? null : styles.cue].filter(Boolean).join(' ') || undefined;
  const describedBy =
    [childProps['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined;
  // cloneElement's public overload only types `key`; `ref` and the cloned
  // event props are threaded at runtime, so widen the element's props type to
  // attach them.
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: setTriggerRef,
    className,
    onMouseEnter: (e: unknown) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      childProps.onFocus?.(e);
      show();
    },
    onBlur: (e: unknown) => {
      childProps.onBlur?.(e);
      hide();
    },
    'aria-describedby': describedBy,
  });

  return (
    <>
      {trigger}
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
    </>
  );
}
