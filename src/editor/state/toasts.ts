// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

/**
 * App-wide transient messages (#223). One store + one `<ToastStack/>` mounted at
 * the app root, so any component reports success/error/info the same way
 * (`notify('success', '…')`) instead of hand-rolling its own inline `<p>`.
 *
 * For *transient* feedback only — persistent status (the conflict / save-error /
 * read-only banners in App) stays a banner, since it reflects ongoing state
 * rather than a one-off event.
 */
export type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: number; kind: ToastKind; text: string };

/** How long a toast lingers before auto-dismiss. Errors stay longer so they're
 *  not missed; success/info clear quickly. */
export const TOAST_TTL_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

type ToastState = {
  toasts: Toast[];
  /** Show a toast; returns its id. Auto-dismisses after TOAST_TTL_MS[kind]. */
  notify: (kind: ToastKind, text: string) => number;
  dismiss: (id: number) => void;
};

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  notify: (kind, text) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), TOAST_TTL_MS[kind]);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-component callers (e.g. event handlers): show a toast
 *  without subscribing to the store. */
export const notify = (kind: ToastKind, text: string): number =>
  useToasts.getState().notify(kind, text);
