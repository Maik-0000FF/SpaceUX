// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { breadcrumbLabels } from '../state/selectors';

import styles from './PreviewHeader.module.scss';

/**
 * Breadcrumb above the preview, shown only after drilling into a
 * submenu. "Menu" returns to the top level; each crumb navigates back to
 * that depth. The last crumb is the current ring (not clickable).
 */
export function PreviewHeader() {
  const config = useMenuSettings((s) => s.config);
  const viewPath = useAppState((s) => s.viewPath);
  const drillTo = useAppState((s) => s.drillTo);

  // Always render (no early null) so the breadcrumb's height is reserved
  // even at the top level — the pie below mustn't jump when it appears.
  // At the root the "Menu" crumb is the only (current, non-clickable) item.
  const labels = config ? breadcrumbLabels(config, viewPath) : [];
  const atRoot = labels.length === 0;

  return (
    <nav className={styles.breadcrumb} aria-label="Menu path">
      <button type="button" className={styles.crumb} onClick={() => drillTo(0)} disabled={atRoot}>
        Menu
      </button>
      {labels.map((label, i) => (
        <span key={i} className={styles.segment}>
          <span className={styles.separator} aria-hidden="true">
            ›
          </span>
          <button
            type="button"
            className={styles.crumb}
            onClick={() => drillTo(i + 1)}
            disabled={i === labels.length - 1}
          >
            {label}
          </button>
        </span>
      ))}
    </nav>
  );
}
