// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorAtPath } from '../state/selectors';

import styles from './Properties.module.scss';

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className={styles.term}>{label}</dt>
      <dd className={`${styles.value} ${mono ? styles.mono : ''}`}>{value}</dd>
    </>
  );
}

/**
 * Right sidebar: read-only properties of the selected sector. PR
 * Editor-2 only displays — text inputs and dropdowns that write back
 * through the config store arrive in PR Editor-3a. A sector is either a
 * leaf (an action binding) or a branch (a submenu of children); the two
 * are mutually exclusive in the schema, so at most one of the
 * action/children blocks shows.
 */
export function Properties() {
  const config = useMenuSettings((s) => s.config);
  const selectedPath = useAppState((s) => s.selectedPath);
  const sector = config ? sectorAtPath(config, selectedPath) : null;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Properties</div>
      {!sector ? (
        <p className={styles.empty}>Select a sector to inspect it.</p>
      ) : (
        <dl className={styles.props}>
          <Field label="Label" value={sector.label} />
          <Field label="Type" value={sector.children ? 'Submenu' : 'Action'} />
          {sector.icon !== undefined && <Field label="Icon" value={sector.icon} />}
          {sector.children !== undefined && (
            <Field label="Children" value={String(sector.children.length)} />
          )}
          {sector.binding !== undefined && (
            <>
              <Field label="Action" value={sector.binding.action} />
              {sector.binding.config !== undefined && (
                <Field label="Config" value={JSON.stringify(sector.binding.config)} mono />
              )}
            </>
          )}
        </dl>
      )}
    </aside>
  );
}
