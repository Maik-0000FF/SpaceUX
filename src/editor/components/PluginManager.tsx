// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { PluginCategory, PluginsState } from '@/shared/ipc';

import styles from './PluginManager.module.scss';

const EMPTY: PluginsState = { plugins: [], errors: [] };

/**
 * Plugin manager (#NNN): import a downloaded plugin *folder* (it's copied into
 * SpaceUX's managed `extensions/<kind>/` tree), list what's installed, and
 * remove plugins. Users don't point the loader at arbitrary paths — import is
 * the one way in, so the on-disk layout stays canonical.
 *
 * Rendered inline on the Settings page. State is pulled on mount and after
 * every import/uninstall (main returns the refreshed state).
 */
export function PluginManager() {
  const [state, setState] = useState<PluginsState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (): void => {
    window.editor
      .getPlugins()
      .then(setState)
      .catch(() => {
        // Keep the last good state — a failed pull shouldn't blank the list.
      });
  };

  useEffect(refresh, []);

  const doImport = (): void => {
    setBusy(true);
    setError(null);
    setNotice(null);
    window.editor
      .importPlugin()
      .then((r) => {
        if (r.ok === true) {
          setState(r.state);
          setNotice(`Imported ${r.installed.name} (${r.installed.kind}).`);
        } else if (r.ok === false) setError(r.reason);
        // r.ok === 'cancelled' → the picker was dismissed; nothing to do.
      })
      .finally(() => setBusy(false));
  };

  const remove = (kind: PluginCategory, id: string): void => {
    setBusy(true);
    setError(null);
    setNotice(null);
    window.editor
      .uninstallPlugin(kind, id)
      .then(setState)
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={doImport} disabled={busy}>
          Import plugin…
        </button>
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {state.plugins.length === 0 ? (
        <p className={styles.empty}>No plugins installed yet.</p>
      ) : (
        <ul className={styles.list}>
          {state.plugins.map((p) => (
            <li key={`${p.kind}/${p.id}`} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.itemName}>{p.name}</span>
                <span className={styles.kindBadge}>{p.kind}</span>
              </div>
              <div className={styles.itemMeta}>
                <span>
                  {p.id} · v{p.version}
                </span>
                {p.kind === 'function' && (
                  <span>
                    {p.actionCount} action{p.actionCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => remove(p.kind, p.id)}
                disabled={busy}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.errors.length > 0 && (
        <div className={styles.errorsSection}>
          <h3 className={styles.subhead}>Could not load</h3>
          <ul className={styles.list}>
            {state.errors.map((e) => (
              <li key={e.dir} className={styles.errorItem}>
                <span className={styles.itemMeta}>{e.dir}</span>
                <span className={styles.error}>{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
