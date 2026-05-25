// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './Modal.module.scss';

/**
 * Generic overlay modal (#223): a dimmed full-window backdrop with a centered,
 * theme-aware panel, portalled to <body> so it sits above the app shell.
 * Closes on Escape or a backdrop click (a click inside the panel doesn't).
 * The app-wide standard surface for dialogs (ConfirmDialog builds on it).
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element labelling the dialog (for aria-labelledby). */
  labelledBy?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Backdrop click closes; a click that starts inside the panel doesn't (we
    // stop it before it reaches the backdrop).
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
