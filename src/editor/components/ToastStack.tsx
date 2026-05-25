// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useToasts } from '../state/toasts';

import styles from './ToastStack.module.scss';

/**
 * The app-wide toast host (#223): mounted once at the app root, it renders the
 * {@link useToasts} stack — transient success/error/info messages any component
 * raises via `notify(…)`. Each is dismissible and auto-clears (see TOAST_TTL_MS).
 */
export function ToastStack() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.stack} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.kind]}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className={styles.text}>{t.text}</span>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
