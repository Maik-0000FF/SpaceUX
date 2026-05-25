// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';

import { isWorkbenchMenuId, parseWorkbenchMenuId } from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useReadOnlySource } from '../hooks/useReadOnlySource';
import { useAppState } from '../state/app-state';
import { useCatalog } from '../state/catalog';
import { flattenCatalogCommands } from '../state/catalog-filter';
import { useMenuSettings } from '../state/menu-settings';

import styles from './CommandPalette.module.scss';

/**
 * Command palette for the curated FreeCAD mode (#76 D2b): lists the active
 * catalog plugin's commands (from the shared catalog store, grouped by
 * workbench, searchable) and adds one to the current ring on click — as a
 * normal menu item carrying the plugin's run-action + baked icon. So the user
 * builds a personalised pie that renders without the bridge and only needs it
 * to *execute*.
 *
 * Shown only when a loaded plugin exposes a catalog (FreeCAD). When a curated
 * per-workbench pie is the active source (#193), the list is scoped to that
 * workbench so "add a command" pulls from the right one. The raw catalog is
 * sanitised here (icons via isRenderableIcon, command/label required) — it
 * isn't validated at the IPC boundary, unlike the menu provider.
 */
export function CommandPalette() {
  const addItem = useMenuSettings((s) => s.addItem);
  const hasConfig = useMenuSettings((s) => s.config !== null);
  const viewPath = useAppState((s) => s.viewPath);
  const readOnly = useReadOnlySource();

  const plugin = useCatalog((s) => s.plugin);
  const status = useCatalog((s) => s.status);
  const reason = useCatalog((s) => s.reason);
  const catalogGroups = useCatalog((s) => s.groups);
  const ensureLoaded = useCatalog((s) => s.ensureLoaded);
  const loadAll = useCatalog((s) => s.loadAll);
  const refresh = useCatalog((s) => s.refresh);

  // The resolved active source (same signal as useReadOnlySource) — single
  // source of truth for "what's active", robust to a dropped/re-resolved override.
  const activeSource = useDeviceInfo().profileId;
  const [query, setQuery] = useState('');
  // "Currently usable" filter (#217): show only commands enabled in the live
  // FreeCAD state. Turning it on re-fetches the catalog so the `enabled` flags
  // reflect the current state (not the stale load-time snapshot).
  const [enabledOnly, setEnabledOnly] = useState(false);
  const toggleEnabledOnly = (on: boolean): void => {
    setEnabledOnly(on);
    if (on) void refresh();
  };

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  // When a curated per-workbench pie of this plugin is the active source, scope
  // the list to that workbench's key; otherwise show every workbench.
  const scopeKey = useMemo(() => {
    if (!plugin || !isWorkbenchMenuId(activeSource)) return null;
    const parsed = parseWorkbenchMenuId(activeSource);
    return parsed && parsed.pluginId === plugin.id ? parsed.workbenchKey : null;
  }, [plugin, activeSource]);

  // Scope + flatten + filter the raw catalog into the renderable command list
  // (pure logic in flattenCatalogCommands — see there for the rules).
  const groups = useMemo(
    () => flattenCatalogCommands(catalogGroups, { scopeKey, query, enabledOnly }),
    [catalogGroups, scopeKey, query, enabledOnly],
  );

  if (!plugin) return null; // no catalog-capable plugin loaded → no palette

  const add = (command: string, label: string, icon?: string): void => {
    // FreeCAD-catalog convention: the plugin's `run` action takes { command }.
    addItem(viewPath, { label, icon, action: { id: `${plugin.id}/run`, config: { command } } });
  };

  return (
    <section className={styles.palette} aria-label={`${plugin.name} commands`}>
      <header className={styles.header}>
        <span className={styles.title}>{plugin.name} commands</span>
        <label
          className={styles.enabledToggle}
          title="Show only commands currently usable in FreeCAD (refreshes from the live state)"
        >
          <input
            type="checkbox"
            checked={enabledOnly}
            disabled={status === 'loading'}
            onChange={(e) => toggleEnabledOnly(e.target.checked)}
          />
          Usable now
        </label>
        <button
          type="button"
          className={styles.loadAll}
          onClick={() => void loadAll()}
          disabled={status === 'loading'}
          title="Activate every workbench in FreeCAD to list all commands (briefly cycles the GUI)"
        >
          Load all
        </button>
      </header>
      <input
        className={styles.search}
        type="search"
        placeholder="Search commands…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {readOnly && (
        <p className={styles.note}>
          The active pie is provided by a plugin and is read-only — switch the active source to add
          commands.
        </p>
      )}
      {status === 'loading' && <p className={styles.note}>Loading commands…</p>}
      {status === 'error' && (
        <p className={styles.note}>
          No commands: {reason}. Is FreeCAD running with the bridge addon?
        </p>
      )}
      {status === 'ready' && groups.length === 0 && (
        <p className={styles.note}>No matching commands.</p>
      )}
      <div className={styles.groups}>
        {groups.map((g) => (
          <div key={g.key} className={styles.group}>
            <div className={styles.groupName}>{g.name}</div>
            {g.commands.map((c) => (
              <button
                key={c.command}
                type="button"
                className={styles.command}
                disabled={!hasConfig || readOnly}
                title={
                  readOnly
                    ? 'The active pie is read-only (plugin-provided)'
                    : `Add "${c.label}" to the current ring`
                }
                onClick={() => add(c.command, c.label, c.icon)}
              >
                {c.icon ? (
                  <img className={styles.icon} src={c.icon} alt="" />
                ) : (
                  <span className={styles.icon} aria-hidden="true" />
                )}
                <span className={styles.label}>{c.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
