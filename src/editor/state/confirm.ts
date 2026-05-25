// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

/**
 * App-wide confirmation dialog (#223). A single `<ConfirmDialog/>` host mounted
 * at the app root renders the pending request as an overlay modal; callers use
 * the imperative `await confirm({ … })` and get a boolean — no per-component
 * open-state or inline confirm markup.
 *
 *   if (await confirm({ message: 'Remove plugin?', confirmLabel: 'Remove',
 *                       destructive: true })) { … }
 */
export type ConfirmOptions = {
  /** Optional heading; omit for a message-only dialog. */
  title?: string;
  message: string;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string;
  /** Style the confirm button as destructive (delete/remove). */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

type ConfirmState = {
  /** The request currently shown, or null when the dialog is closed. */
  pending: Pending | null;
  /** Open the dialog; resolves true on confirm, false on cancel/dismiss. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolve the pending request and close (called by the host on the user's
   *  choice). A no-op when nothing is pending. */
  settle: (ok: boolean) => void;
};

export const useConfirm = create<ConfirmState>((set, get) => ({
  pending: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      // Only one dialog at a time: a new request supersedes an unanswered one
      // (resolve the old as cancelled so its awaiter doesn't hang).
      const prev = get().pending;
      if (prev) prev.resolve(false);
      set({ pending: { ...opts, resolve } });
    }),
  settle: (ok) => {
    const p = get().pending;
    if (!p) return;
    p.resolve(ok);
    set({ pending: null });
  },
}));

/** Convenience for non-component callers: open the confirm dialog and await the
 *  user's choice without subscribing to the store. */
export const confirm = (opts: ConfirmOptions): Promise<boolean> =>
  useConfirm.getState().confirm(opts);
