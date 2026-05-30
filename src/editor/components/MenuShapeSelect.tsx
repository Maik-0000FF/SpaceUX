// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo } from 'react';

import { resolveShapeModel } from '@/shared/menu';

import { usePieAppearance } from '../hooks/usePieAppearance';
import { useMenuSettings } from '../state/menu-settings';
import { usePluginsState } from '../state/plugins';

import styles from './Properties.module.scss';
import { Row } from './Row';
import { Tooltip } from './Tooltip';

/** Sentinel values for the three-state per-menu override (#107).
 *  `''` (wedge) matches `PieShapeSelect`'s convention; `__inherit__`
 *  contains no slash, so it can't collide with a plugin-contributed
 *  `<pluginId>/<shapeId>` key (the format enforced by `shapeKey`
 *  below and read by `App.tsx`'s inverse split). */
const INHERIT_VALUE = '__inherit__';
const WEDGE_VALUE = '';

function shapeKey(pluginId: string, shapeId: string): string {
  return `${pluginId}/${shapeId}`;
}

/** Per-menu shape-model override picker for the Properties panel
 *  (#107). Layers over the app-level appearance default exposed by
 *  `PieShapeSelect`: choosing "Inherit" removes the per-menu field so
 *  the appearance setting drives this menu; choosing wedge or a
 *  plugin shape forces that for this menu only.
 *
 *  Reads the same plugins store as `PieShapeSelect` so freshly
 *  imported shape plugins show up here without polling. The current
 *  appearance default is shown alongside the "Inherit" label so the
 *  user can see what they're inheriting without leaving the panel. */
export function MenuShapeSelect() {
  const shapeModel = useMenuSettings((s) => s.config?.shapeModel);
  const setShapeModel = useMenuSettings((s) => s.setShapeModel);
  const { appearance } = usePieAppearance();
  const plugins = usePluginsState((s) => s.plugins);
  const ensureLoaded = usePluginsState((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const pluginShapes = useMemo(
    () =>
      plugins.flatMap((p) =>
        p.kind === 'shape' && p.shape
          ? [
              {
                key: shapeKey(p.id, p.shape.id),
                pluginName: p.name,
                label: p.shape.label,
                description: p.shape.description,
              },
            ]
          : [],
      ),
    [plugins],
  );

  // Three-state mapping (see store doc): undefined→inherit, null→wedge,
  // string→that plugin shape. The select value uses sentinels because
  // <select> can't represent null/undefined.
  const value =
    shapeModel === undefined ? INHERIT_VALUE : shapeModel === null ? WEDGE_VALUE : shapeModel;

  // Resolve the inherited default so the "Inherit" option can advertise
  // which shape the menu will actually render. Mirrors what the runtime
  // resolver does for an `undefined` per-menu field.
  const inherited = resolveShapeModel(undefined, appearance.shapeModel);
  const inheritedPlugin = pluginShapes.find((s) => s.key === inherited);
  const inheritedLabel =
    inherited === null ? 'Wedge' : (inheritedPlugin?.label ?? `unknown: ${inherited}`);

  // A string per-menu override that doesn't match any installed plugin
  // (renamed plugin, plugin removed). Surface it as a disabled option
  // so the picker shows the real value instead of silently snapping.
  const isUnknown =
    typeof shapeModel === 'string' && pluginShapes.find((s) => s.key === shapeModel) === undefined;

  const title =
    value === INHERIT_VALUE
      ? `This menu inherits the app shape model (${inheritedLabel}). Override only if a specific menu needs a different shape.`
      : value === WEDGE_VALUE
        ? 'This menu always renders as the built-in wedge slices, regardless of the app shape model.'
        : isUnknown
          ? `Plugin not installed: ${value}. This menu renders as wedge until you install it.`
          : (pluginShapes.find((s) => s.key === value)?.description ??
            'This menu uses the selected plugin shape, regardless of the app shape model.');

  return (
    <Row label="Shape model">
      <Tooltip content={title}>
        <select
          className={styles.select}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (next === INHERIT_VALUE) setShapeModel(undefined);
            else if (next === WEDGE_VALUE) setShapeModel(null);
            else setShapeModel(next);
          }}
        >
          <option value={INHERIT_VALUE}>Inherit (app default: {inheritedLabel})</option>
          <option value={WEDGE_VALUE}>Wedge</option>
          {pluginShapes.length > 0 && (
            <optgroup label="From plugins">
              {pluginShapes.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.pluginName && s.pluginName !== s.label
                    ? `${s.label} · ${s.pluginName}`
                    : s.label}
                </option>
              ))}
            </optgroup>
          )}
          {isUnknown && (
            <option value={value} disabled>
              (unknown: {value})
            </option>
          )}
        </select>
      </Tooltip>
      <span className={styles.sectionNote}>
        Override the app shape model for this menu only. Inherit follows the design bar.
      </span>
    </Row>
  );
}
