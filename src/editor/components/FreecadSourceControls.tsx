// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';

import {
  PLUGIN_MENU_ID_PREFIX,
  isWorkbenchMenuId,
  makeWorkbenchMenuId,
  parseWorkbenchMenuId,
  workbenchKeyToLabel,
} from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useWorkbenchMenus } from '../hooks/useWorkbenchMenus';
import { useCatalog } from '../state/catalog';

import styles from './FreecadSourceControls.module.scss';

/**
 * FreeCAD pie source switch (#193 PR2c), at the top of the left column. Two
 * modes for the catalog plugin's pie:
 *   - **Dynamic** — the plugin generates the pie live per active workbench
 *     (read-only); selecting it sets the override to `plugin:<id>`.
 *   - **Curated** — the user's own editable per-workbench pie; the dropdown
 *     picks a workbench and sets the override to `wb:<id>:<key>`, seeding the
 *     file from the live catalog the first time (full workbench, then edit
 *     down). Already-curated workbenches are marked.
 *
 * A FreeCAD-specific presenter over `setProfileOverride` — there's still one
 * active-source concept (the generic Profile dropdown shows "FreeCAD pie" while
 * one is active and owns Auto / device profiles). Shown only when a catalog
 * plugin is loaded.
 */
export function FreecadSourceControls() {
  const plugin = useCatalog((s) => s.plugin);
  const groups = useCatalog((s) => s.groups);
  const status = useCatalog((s) => s.status);
  const loadAll = useCatalog((s) => s.loadAll);
  const ensureLoaded = useCatalog((s) => s.ensureLoaded);
  const activeSource = useDeviceInfo().profileId;
  const curatedIds = useWorkbenchMenus();

  // Local: "the user clicked Curated but hasn't picked a workbench yet" — shows
  // the dropdown without seeding/switching until a workbench is chosen.
  const [intentCurated, setIntentCurated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  // The selectable workbenches: catalog groups (display name), merged with any
  // curated-but-not-in-catalog workbench (bridge offline → label from the key).
  const workbenches = useMemo(() => {
    if (!plugin) return [];
    const byKey = new Map<string, { key: string; label: string; curated: boolean }>();
    for (const g of groups) {
      byKey.set(g.key, {
        key: g.key,
        label: g.name,
        curated: curatedIds.includes(makeWorkbenchMenuId(plugin.id, g.key)),
      });
    }
    for (const id of curatedIds) {
      const parsed = parseWorkbenchMenuId(id);
      if (parsed && parsed.pluginId === plugin.id && !byKey.has(parsed.workbenchKey)) {
        byKey.set(parsed.workbenchKey, {
          key: parsed.workbenchKey,
          label: workbenchKeyToLabel(parsed.workbenchKey),
          curated: true,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [plugin, groups, curatedIds]);

  if (!plugin) return null; // no catalog-capable plugin loaded → no control

  const dynamicId = `${PLUGIN_MENU_ID_PREFIX}${plugin.id}`;
  const isDynamic = activeSource === dynamicId;
  const parsedActive = isWorkbenchMenuId(activeSource) ? parseWorkbenchMenuId(activeSource) : null;
  const activeWorkbench =
    parsedActive && parsedActive.pluginId === plugin.id ? parsedActive.workbenchKey : null;
  const showCurated = activeWorkbench !== null || intentCurated;

  const chooseDynamic = (): void => {
    setIntentCurated(false);
    setError(null);
    void window.editor.setProfileOverride(dynamicId);
  };

  const selectWorkbench = async (key: string): Promise<void> => {
    if (key === '') return;
    setError(null);
    const id = makeWorkbenchMenuId(plugin.id, key);
    // Already curated → just activate it; otherwise seed it from the live
    // catalog first (needs the bridge), then activate.
    if (curatedIds.includes(id)) {
      void window.editor.setProfileOverride(id);
      return;
    }
    setBusy(true);
    const res = await window.editor.seedWorkbench(plugin.id, key);
    setBusy(false);
    if (res.ok) void window.editor.setProfileOverride(res.id);
    else setError(res.reason);
  };

  return (
    <section className={styles.controls} aria-label={`${plugin.name} pie source`}>
      <span className={styles.title}>{plugin.name} pie</span>
      <div className={styles.switch} role="group" aria-label="FreeCAD pie mode">
        <button
          type="button"
          className={isDynamic ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
          aria-pressed={isDynamic}
          onClick={chooseDynamic}
          title="Live pie that follows FreeCAD's active workbench (read-only)"
        >
          Dynamic
        </button>
        <button
          type="button"
          className={showCurated ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
          aria-pressed={showCurated}
          onClick={() => {
            setError(null);
            setIntentCurated(true);
          }}
          title="Your own editable pie per workbench"
        >
          Curated
        </button>
      </div>
      {showCurated && (
        <div className={styles.curatedRow}>
          <select
            className={styles.select}
            value={activeWorkbench ?? ''}
            disabled={busy}
            onChange={(e) => void selectWorkbench(e.target.value)}
            title="Pick a workbench to edit its curated pie (● = already curated)"
          >
            <option value="">Select a workbench…</option>
            {workbenches.map((w) => (
              <option key={w.key} value={w.key}>
                {w.curated ? '● ' : ''}
                {w.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.loadAll}
            onClick={() => void loadAll()}
            disabled={status === 'loading' || busy}
            title="Activate every workbench in FreeCAD so all are listed (briefly cycles the GUI)"
          >
            Load all
          </button>
        </div>
      )}
      {busy && <p className={styles.note}>Seeding the workbench…</p>}
      {error !== null && <p className={styles.note}>{error}</p>}
      {showCurated && !busy && workbenches.length === 0 && status !== 'loading' && (
        <p className={styles.note}>
          No workbenches — start FreeCAD with the bridge addon, or use “Load all”.
        </p>
      )}
    </section>
  );
}
