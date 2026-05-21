// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  ACTIVATION_DIRECTIONS,
  BUILTIN_ACTION,
  DEFAULT_ACTIVATION_THRESHOLD,
  MENU_AXES,
  builtinAction,
  type ActivationDirection,
  type MenuAxisName,
} from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { ConfigEditor } from './ConfigEditor';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Menu-level editor for the configurable center field, shown under the
 * other whole-menu settings when no sector is selected.
 *
 * Mirrors the live pie: a label (blank → the ✕ glyph), an optional
 * bound action committed when the center wins, and an optional axis
 * activation that commits the center by a puck gesture instead of the
 * trigger button. "On commit" defaults a freshly-chosen action to the
 * built-in Cancel so the headline use — an explicit, labelled cancel —
 * is one click away; the action field then accepts any plugin action.
 */
export function CenterFieldSettings() {
  const center = useMenuSettings((s) => s.config?.centerField);
  const setCenterLabel = useMenuSettings((s) => s.setCenterLabel);
  const setCenterBinding = useMenuSettings((s) => s.setCenterBinding);
  const setCenterActionConfig = useMenuSettings((s) => s.setCenterActionConfig);
  const setCenterActivation = useMenuSettings((s) => s.setCenterActivation);
  const remoteRev = useMenuSettings((s) => s.remoteRev);

  // "Action mode" is keyed on binding *presence*, not on the action
  // string being non-empty — so clearing the field to retype keeps the
  // section mounted (binding stays as `{ action: '' }`) instead of
  // collapsing back to Dismiss, mirroring the sector editor's Type
  // toggle.
  const hasBinding = center?.binding !== undefined;
  const activation = center?.activation;

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
      <Row label="Activation">
        <select
          className={styles.select}
          value={activation ? 'axis' : 'button'}
          title="Axis activation commits the center by a puck gesture instead of the trigger button"
          onChange={(e) =>
            setCenterActivation(
              e.target.value === 'button'
                ? null
                : { axis: 'tz', direction: 'positive', threshold: DEFAULT_ACTIVATION_THRESHOLD },
            )
          }
        >
          <option value="button">Trigger button only</option>
          <option value="axis">Axis gesture</option>
        </select>
      </Row>
      {activation && (
        <>
          <Row label="Axis">
            <select
              className={styles.select}
              value={activation.axis}
              onChange={(e) =>
                setCenterActivation({ ...activation, axis: e.target.value as MenuAxisName })
              }
            >
              {MENU_AXES.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Direction">
            <select
              className={styles.select}
              value={activation.direction}
              onChange={(e) =>
                setCenterActivation({
                  ...activation,
                  direction: e.target.value as ActivationDirection,
                })
              }
            >
              {ACTIVATION_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Threshold">
            <input
              className={styles.input}
              type="number"
              min={1}
              value={activation.threshold}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0)
                  setCenterActivation({ ...activation, threshold: n });
              }}
            />
          </Row>
        </>
      )}
    </>
  );
}
