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
import { confirm } from '../state/confirm';
import { notify } from '../state/toasts';

import { FreecadBridgeInstaller } from './FreecadBridgeInstaller';
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

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  // Drop a pending "Curated" intent once the active source leaves FreeCAD (e.g.
  // the user picked Auto / a device profile in the Profile dropdown), so the
  // Curated segment doesn't stay highlighted over a non-FreeCAD source. Only
  // fires on a real source change — clicking Curated doesn't touch activeSource.
  useEffect(() => {
    if (!plugin) return;
    const dynId = `${PLUGIN_MENU_ID_PREFIX}${plugin.id}`;
    const onFreecad =
      activeSource === dynId ||
      (isWorkbenchMenuId(activeSource) &&
        parseWorkbenchMenuId(activeSource)?.pluginId === plugin.id);
    if (!onFreecad) setIntentCurated(false);
  }, [activeSource, plugin]);

  // The selectable workbenches: catalog groups (display name), merged with any
  // curated-but-not-in-catalog workbench (bridge offline → label from the key).
  const workbenches = useMemo(() => {
    if (!plugin) return [];
    const byKey = new Map<
      string,
      { key: string; label: string; curated: boolean; icon?: string }
    >();
    for (const g of groups) {
      byKey.set(g.key, {
        key: g.key,
        label: g.name,
        curated: curatedIds.includes(makeWorkbenchMenuId(plugin.id, g.key)),
        icon: g.icon, // the workbench's own icon (#229), if the bridge resolved one
      });
    }
    for (const id of curatedIds) {
      const parsed = parseWorkbenchMenuId(id);
      if (parsed && parsed.pluginId === plugin.id && !byKey.has(parsed.workbenchKey)) {
        // Curated offline (not in the live catalog) → no icon, label from the key.
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
  // The active curated workbench's catalog entry (icon + name) for the header
  // above the tree (#229). Null in Dynamic mode (no specific workbench here).
  const activeWb =
    activeWorkbench === null ? null : (workbenches.find((w) => w.key === activeWorkbench) ?? null);

  const chooseDynamic = (): void => {
    setIntentCurated(false);
    void window.editor.setProfileOverride(dynamicId);
  };

  const selectWorkbench = async (key: string): Promise<void> => {
    if (key === '') return;
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
    else notify('error', res.reason);
  };

  // Destructive actions on the active curated workbench (#207), each behind an
  // overlay confirm (#223). Re-seed overwrites from the live catalog (a bridge
  // error leaves the file intact); delete removes it (main clears the override).
  // Both propagate via the workbench-menus watcher / profile push.
  const reseed = async (): Promise<void> => {
    if (activeWorkbench === null) return;
    const ok = await confirm({
      title: 'Re-seed pie?',
      message: 'Rebuild this curated pie from the live workbench? This discards your edits.',
      confirmLabel: 'Re-seed',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await window.editor.seedWorkbench(plugin.id, activeWorkbench, true);
    setBusy(false);
    notify(res.ok ? 'success' : 'error', res.ok ? 'Curated pie re-seeded.' : res.reason);
  };

  const removeCurated = async (): Promise<void> => {
    if (activeWorkbench === null) return;
    const ok = await confirm({
      title: 'Delete pie?',
      message: 'Delete this curated pie?',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await window.editor.deleteWorkbench(plugin.id, activeWorkbench);
    setBusy(false);
    notify(res.ok ? 'success' : 'error', res.ok ? 'Curated pie deleted.' : res.reason);
  };

  return (
    <section className={styles.controls} aria-label={`${plugin.name} pie source`}>
      <span className={styles.title}>{plugin.name} pie</span>
      {activeWb && (
        // Header above the tree (#229): which workbench you're editing, with its
        // own icon when the bridge resolved one.
        <div className={styles.activeWb}>
          {activeWb.icon && <img className={styles.activeWbIcon} src={activeWb.icon} alt="" />}
          <span className={styles.activeWbName}>{activeWb.label}</span>
        </div>
      )}
      <div className={styles.switch} role="group" aria-label="FreeCAD pie mode">
        <button
          type="button"
          className={
            isDynamic && !showCurated ? `${styles.segment} ${styles.segmentOn}` : styles.segment
          }
          aria-pressed={isDynamic && !showCurated}
          onClick={chooseDynamic}
          title="Live pie that follows FreeCAD's active workbench (read-only)"
        >
          Dynamic
        </button>
        <button
          type="button"
          className={showCurated ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
          aria-pressed={showCurated}
          onClick={() => setIntentCurated(true)}
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
      {activeWorkbench !== null && (
        <div className={styles.curatedActions}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy}
            onClick={() => void reseed()}
            title="Rebuild this curated pie from the live workbench (discards your edits)"
          >
            Re-seed
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy}
            onClick={() => void removeCurated()}
            title="Delete this curated pie"
          >
            Delete
          </button>
        </div>
      )}
      {busy && <p className={styles.note}>Working…</p>}
      {showCurated && !busy && workbenches.length === 0 && status !== 'loading' && (
        <p className={styles.note}>
          No workbenches — start FreeCAD with the bridge addon, or use “Load all”.
        </p>
      )}
      <FreecadBridgeInstaller pluginId={plugin.id} />
    </section>
  );
}
