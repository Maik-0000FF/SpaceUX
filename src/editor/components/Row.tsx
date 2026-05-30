// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from 'react';

import { Tooltip } from './Tooltip';
import styles from './Properties.module.scss';

/**
 * A labelled field row used across the Properties panel. Pass `hint` to attach
 * a hover tooltip to the label (#279) — the help shows on the label, not the
 * control, so it never pops while you type in the field.
 */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={styles.row}>
      {hint !== undefined ? (
        <Tooltip content={hint}>
          <span className={styles.label}>{label}</span>
        </Tooltip>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      {children}
    </label>
  );
}
