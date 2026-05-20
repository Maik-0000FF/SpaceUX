// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { BUILTIN_ACTION, builtinAction, DEFAULT_TRIGGER_BUTTON } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { ringSectors, sectorAtPath, selectedPath } from '../state/selectors';

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
 * path + remoteRev) so switching sectors / adopting a remote change
 * reloads the field cleanly.
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
 * Right sidebar: editable properties of the selected sector (at any
 * depth — the selection is the current ring's index, combined with the
 * view path). A sector is a leaf (action binding) or a branch (submenu);
 * the Type dropdown converts between them. A branch offers "Open
 * submenu" to drill in; Delete removes it from the current ring.
 */
export function Properties() {
  const config = useMenuSettings((s) => s.config);
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const deleteSector = useMenuSettings((s) => s.deleteSector);
  const setTriggerButton = useMenuSettings((s) => s.setTriggerButton);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectSector = useAppState((s) => s.selectSector);
  const clearSelection = useAppState((s) => s.clearSelection);
  const drillInto = useAppState((s) => s.drillInto);

  const path = selectedPath(viewPath, selectedIndex);
  const sector = config && path ? sectorAtPath(config, path) : null;
  const isExec = sector?.binding?.action === builtinAction(BUILTIN_ACTION.EXEC);

  // Pick a file for an exec command and write it into the action config.
  const handleBrowse = (): void => {
    if (!path) return;
    void window.editor.pickFile().then((file) => {
      if (!file) return;
      updateSectorAt(path, (s) => {
        if (s.binding) s.binding.config = { ...(s.binding.config ?? {}), command: file };
      });
    });
  };

  const canDelete =
    selectedIndex !== null && (config ? ringSectors(config, viewPath).length : 0) > 1;
  const handleDelete = (): void => {
    if (selectedIndex === null) return;
    deleteSector(viewPath, selectedIndex);
    const current = useMenuSettings.getState().config;
    const remaining = current ? ringSectors(current, viewPath).length : 0;
    // Keep the editing flow: select a neighbour rather than nothing.
    if (remaining > 0) selectSector(Math.min(selectedIndex, remaining - 1));
    else clearSelection();
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Properties</div>
      {!sector || !path ? (
        <div className={styles.fields}>
          <p className={styles.empty}>Select a sector to edit it.</p>
          {config && (
            <Row label="Trigger button">
              <input
                className={styles.input}
                type="number"
                min={0}
                value={config.triggerButton ?? DEFAULT_TRIGGER_BUTTON}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0) setTriggerButton(n);
                }}
              />
            </Row>
          )}
        </div>
      ) : (
        <div className={styles.fields}>
          <Row label="Label">
            <input
              className={styles.input}
              value={sector.label}
              onChange={(e) =>
                updateSectorAt(path, (s) => {
                  s.label = e.target.value;
                })
              }
            />
          </Row>
          <Row label="Type">
            <select
              className={styles.select}
              value={sector.children !== undefined ? 'submenu' : 'action'}
              title={
                sector.children !== undefined
                  ? 'Switching to Action discards this submenu and its items'
                  : undefined
              }
              onChange={(e) =>
                updateSectorAt(path, (s) => {
                  if (e.target.value === 'submenu') {
                    if (s.children === undefined) {
                      s.children = [{ label: 'New item' }];
                      delete s.binding;
                    }
                  } else {
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
            <>
              <Row label="Submenu items">
                <span className={styles.readonly}>{sector.children.length}</span>
              </Row>
              {sector.children.length > 0 && (
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => {
                    if (selectedIndex !== null) drillInto(selectedIndex);
                  }}
                >
                  Open submenu →
                </button>
              )}
            </>
          )}
          {sector.children === undefined && (
            <>
              <Row label="Action">
                <input
                  className={styles.input}
                  value={sector.binding?.action ?? ''}
                  placeholder="pluginId/actionName"
                  onChange={(e) =>
                    updateSectorAt(path, (s) => {
                      const action = e.target.value;
                      if (s.binding) s.binding.action = action;
                      else s.binding = { action };
                    })
                  }
                />
              </Row>
              {isExec && (
                <button type="button" className={styles.openButton} onClick={handleBrowse}>
                  Browse for file…
                </button>
              )}
              {sector.binding !== undefined && (
                // Keyed on the selection + remoteRev so the local JSON
                // text remounts on an external adoption, not while typing.
                <ConfigEditor
                  key={`${path.join('.')}-${remoteRev}`}
                  path={path}
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
