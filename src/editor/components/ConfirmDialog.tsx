// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useConfirm } from '../state/confirm';

import { Modal } from './Modal';
import styles from './ConfirmDialog.module.scss';

/**
 * The single confirm-dialog host (#223): mounted once at the app root, it renders
 * the pending {@link useConfirm} request as an overlay modal and resolves the
 * caller's `await confirm(…)` with the user's choice. Cancel / Escape / backdrop
 * all resolve false; the confirm button resolves true.
 */
export function ConfirmDialog() {
  const pending = useConfirm((s) => s.pending);
  const settle = useConfirm((s) => s.settle);

  return (
    <Modal open={pending !== null} onClose={() => settle(false)} labelledBy="confirm-title">
      {pending && (
        <div className={styles.dialog}>
          {pending.title !== undefined && (
            <h2 id="confirm-title" className={styles.title}>
              {pending.title}
            </h2>
          )}
          <p className={styles.message}>{pending.message}</p>
          <div className={styles.actions}>
            {/* Cancel is the safe default focus, so an accidental Enter doesn't
                trigger a destructive confirm. */}
            <button type="button" className={styles.cancel} onClick={() => settle(false)} autoFocus>
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
