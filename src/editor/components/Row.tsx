// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import styles from './Properties.module.scss';

/** A labelled field row used across the Properties panel. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}
