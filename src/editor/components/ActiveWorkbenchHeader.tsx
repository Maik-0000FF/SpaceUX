// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  isWorkbenchMenuId,
  parseWorkbenchMenuId,
  workbenchKeyToLabel,
} from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useCatalog } from '../state/catalog';

import styles from './ActiveWorkbenchHeader.module.scss';

/**
 * Header shown directly above the menu tree (#229) when a curated FreeCAD
 * workbench pie is the active source: the workbench's own icon + name, so it's
 * clear which workbench the tree below belongs to. Renders nothing for any
 * other source (device profile / fallback / dynamic plugin menu), so it only
 * appears when there's a specific workbench to name.
 */
export function ActiveWorkbenchHeader() {
  const plugin = useCatalog((s) => s.plugin);
  const groups = useCatalog((s) => s.groups);
  const activeSource = useDeviceInfo().profileId;

  if (!plugin) return null;
  const parsed = isWorkbenchMenuId(activeSource) ? parseWorkbenchMenuId(activeSource) : null;
  const key = parsed && parsed.pluginId === plugin.id ? parsed.workbenchKey : null;
  if (key === null) return null;

  const group = groups.find((g) => g.key === key);
  const label = group?.name ?? workbenchKeyToLabel(key);
  const icon = group?.icon;

  return (
    <div className={styles.header}>
      {icon && <img className={styles.icon} src={icon} alt="" />}
      <span className={styles.name}>{label}</span>
    </div>
  );
}
