// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorAtPath } from '../state/selectors';

import styles from './Properties.module.scss';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

/**
 * JSON editor for a leaf sector's action config. Keeps local text state
 * so a half-typed (invalid) value stays in the field without being
 * pushed into the store; only a parse to a plain object commits. Clearing
 * the field removes the config. Remounted per selection (keyed on the
 * path) so switching sectors reloads the field cleanly.
 */
function ConfigEditor({
  path,
  value,
}: {
  path: readonly number[];
  value: Record<string, unknown> | undefined;
}) {
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const [text, setText] = useState(value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const onChange = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      updateSectorAt(path, (s) => {
        if (s.binding) delete s.binding.config;
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      setError('invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setError('config must be a JSON object');
      return;
    }
    setError(null);
    updateSectorAt(path, (s) => {
      if (s.binding) s.binding.config = parsed as Record<string, unknown>;
    });
  };

  return (
    <div className={styles.configBlock}>
      <span className={styles.label}>Config</span>
      <textarea
        className={styles.textarea}
        value={text}
        spellCheck={false}
        rows={5}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}

/**
 * Right sidebar: editable properties of the selected sector. Edits write
 * straight into the config store (via updateSectorAt), which the App's
 * write-back subscription debounces to disk — there is no Save button.
 * A sector is a leaf (action binding) or a branch (submenu children); the
 * two are mutually exclusive, so only one block shows. Adding/removing
 * the binding-vs-children split, and reordering, are PR Editor-4.
 */
export function Properties() {
  const config = useMenuSettings((s) => s.config);
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const deleteSector = useMenuSettings((s) => s.deleteSector);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const selectedPath = useAppState((s) => s.selectedPath);
  const clearSelection = useAppState((s) => s.clearSelection);
  const sector = config ? sectorAtPath(config, selectedPath) : null;

  // PR-4 operates on the top level only (nested editing is PR-5).
  const isTopLevel = selectedPath.length === 1;
  const canDelete = isTopLevel && (config?.sectors.length ?? 0) > 1;
  const handleDelete = (): void => {
    if (!isTopLevel) return;
    deleteSector(selectedPath[0]!);
    clearSelection();
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Properties</div>
      {!sector ? (
        <p className={styles.empty}>Select a sector to edit it.</p>
      ) : (
        <div className={styles.fields}>
          <Row label="Label">
            <input
              className={styles.input}
              value={sector.label}
              onChange={(e) =>
                updateSectorAt(selectedPath, (s) => {
                  s.label = e.target.value;
                })
              }
            />
          </Row>
          <Row label="Type">
            <select
              className={styles.select}
              value={sector.children !== undefined ? 'submenu' : 'action'}
              onChange={(e) =>
                updateSectorAt(selectedPath, (s) => {
                  if (e.target.value === 'submenu') {
                    // Branch needs ≥1 child; branch/leaf are exclusive, so
                    // seed a default child and drop the action binding.
                    if (s.children === undefined) {
                      s.children = [{ label: 'New item' }];
                      delete s.binding;
                    }
                  } else {
                    // Back to a leaf: drop the children; binding starts empty.
                    delete s.children;
                  }
                })
              }
            >
              <option value="action">Action</option>
              <option value="submenu">Submenu</option>
            </select>
          </Row>
          {sector.children !== undefined && (
            <Row label="Submenu items">
              <span className={styles.readonly}>{sector.children.length}</span>
            </Row>
          )}
          {sector.children === undefined && (
            <>
              <Row label="Action">
                <input
                  className={styles.input}
                  value={sector.binding?.action ?? ''}
                  placeholder="pluginId/actionName"
                  onChange={(e) =>
                    updateSectorAt(selectedPath, (s) => {
                      const action = e.target.value;
                      if (s.binding) s.binding.action = action;
                      else s.binding = { action };
                    })
                  }
                />
              </Row>
              {sector.binding !== undefined && (
                // Keyed on the selection *and* remoteRev so the editor's
                // local JSON text remounts (re-reads from the store) when
                // an external change is adopted, but not while the user
                // is typing (local edits don't bump remoteRev).
                <ConfigEditor
                  key={`${selectedPath.join('.')}-${remoteRev}`}
                  path={selectedPath}
                  value={sector.binding.config}
                />
              )}
            </>
          )}
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleDelete}
            disabled={!canDelete}
            title={canDelete ? 'Delete this sector' : 'A menu must keep at least one sector'}
          >
            Delete sector
          </button>
        </div>
      )}
    </aside>
  );
}
