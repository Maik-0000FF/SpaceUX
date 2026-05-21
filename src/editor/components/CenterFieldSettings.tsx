// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILTIN_ACTION, builtinAction } from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { ConfigEditor } from './ConfigEditor';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Menu-level editor for the configurable center field, shown under the
 * other whole-menu settings when no sector is selected.
 *
 * Mirrors the live pie: a label (blank → the ✕ glyph) and an optional
 * bound action committed when the center wins. "On commit" defaults a
 * freshly-chosen action to the built-in Cancel so the headline use — an
 * explicit, labelled cancel — is one click away; the action field then
 * accepts any plugin action.
 *
 * How the center is *triggered* by an axis gesture now lives in the
 * navigation bindings (issue #105, `navigation.commitCenter`), not here.
 */
export function CenterFieldSettings() {
  const center = useMenuSettings((s) => s.config?.centerField);
  const setCenterLabel = useMenuSettings((s) => s.setCenterLabel);
  const setCenterBinding = useMenuSettings((s) => s.setCenterBinding);
  const setCenterActionConfig = useMenuSettings((s) => s.setCenterActionConfig);
  const remoteRev = useMenuSettings((s) => s.remoteRev);

  // "Action mode" is keyed on binding *presence*, not on the action
  // string being non-empty — so clearing the field to retype keeps the
  // section mounted (binding stays as `{ action: '' }`) instead of
  // collapsing back to Dismiss, mirroring the sector editor's Type
  // toggle.
  const hasBinding = center?.binding !== undefined;

  return (
    <>
      <div className={styles.heading}>Center field</div>
      <Row label="Label">
        <input
          className={styles.input}
          value={center?.label ?? ''}
          placeholder="✕"
          onChange={(e) => setCenterLabel(e.target.value)}
        />
      </Row>
      <Row label="On commit">
        <select
          className={styles.select}
          value={hasBinding ? 'action' : 'dismiss'}
          onChange={(e) =>
            setCenterBinding(
              e.target.value === 'dismiss' ? null : builtinAction(BUILTIN_ACTION.CANCEL),
            )
          }
        >
          <option value="dismiss">Dismiss (cancel)</option>
          <option value="action">Run action…</option>
        </select>
      </Row>
      {hasBinding && (
        <>
          <Row label="Action">
            <input
              className={styles.input}
              value={center?.binding?.action ?? ''}
              placeholder="pluginId/actionName"
              onChange={(e) => setCenterBinding(e.target.value)}
            />
          </Row>
          <ConfigEditor
            // Remount on external adoption (not mid-typing), like the
            // sector config editor.
            key={`center-${remoteRev}`}
            value={center?.binding?.config}
            onChange={(cfg) => setCenterActionConfig(cfg)}
          />
        </>
      )}
    </>
  );
}
