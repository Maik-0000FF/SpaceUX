// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback } from 'react';

import { useConfirm } from '../state/confirm';

import { Modal } from './Modal';
import styles from './ConfirmDialog.module.scss';

const TITLE_ID = 'confirm-title';
const MESSAGE_ID = 'confirm-message';

/**
 * The single confirm-dialog host (#223): mounted once at the app root, it renders
 * the pending {@link useConfirm} request as an overlay modal and resolves the
 * caller's `await confirm(…)` with the user's choice. Cancel / Escape / backdrop
 * all resolve false; the confirm button resolves true.
 */
export function ConfirmDialog() {
  const pending = useConfirm((s) => s.pending);
  const settle = useConfirm((s) => s.settle);
  // Stable so Modal's Escape effect doesn't re-subscribe on every render.
  const cancel = useCallback(() => settle(false), [settle]);

  return (
    <Modal
      open={pending !== null}
      onClose={cancel}
      // Label by the title when present, else by the message — the API allows a
      // title-less confirm, so this keeps aria-labelledby from dangling.
      labelledBy={pending?.title !== undefined ? TITLE_ID : MESSAGE_ID}
    >
      {pending && (
        <div className={styles.dialog}>
          {pending.title !== undefined && (
            <h2 id={TITLE_ID} className={styles.title}>
              {pending.title}
            </h2>
          )}
          <p id={MESSAGE_ID} className={styles.message}>
            {pending.message}
          </p>
          <div className={styles.actions}>
            {/* Cancel is first in DOM order, so Modal's focus-in lands here by
                default — an accidental Enter won't trigger a destructive confirm. */}
            <button type="button" className={styles.cancel} onClick={cancel}>
              {pending.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={pending.destructive === true ? styles.confirmDestructive : styles.confirm}
              onClick={() => settle(true)}
            >
              {pending.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
