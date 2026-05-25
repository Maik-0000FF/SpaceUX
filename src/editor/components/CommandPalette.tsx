// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { isWorkbenchMenuId, parseWorkbenchMenuId } from '@/shared/plugin-types';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useReadOnlySource } from '../hooks/useReadOnlySource';
import { useAppState } from '../state/app-state';
import { useCatalog } from '../state/catalog';
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

  // The resolved active source (same signal as useReadOnlySource) — single
  // source of truth for "what's active", robust to a dropped/re-resolved override.
  const activeSource = useDeviceInfo().profileId;
  const [query, setQuery] = useState('');

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

  // Sanitise + filter the raw catalog: scope to the active workbench (if any),
  // drop commands missing a command/label, keep only renderable icons, and
  // match the search query on the label.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogGroups
      .filter((g) => scopeKey === null || g.key === scopeKey)
      .map((g) => ({
        key: g.key,
        name: g.name,
        // Flatten the toolbars into one searchable list per workbench (the
        // toolbar grouping is for the seeded pie's tree, not the palette).
        // Expand command groups (#208) into their members — the group node
        // itself isn't runnable, its members are the addable commands.
        commands: g.toolbars
          .flatMap((t) => t.commands)
          .flatMap((c) => (c.members && c.members.length ? c.members : [c]))
          .filter(
            (c) =>
              typeof c.command === 'string' && c.command && typeof c.label === 'string' && c.label,
          )
          .filter((c) => q === '' || c.label.toLowerCase().includes(q))
          .map((c) => ({
            command: c.command,
            label: c.label,
            icon: c.icon && isRenderableIcon(c.icon) ? c.icon : undefined,
          })),
      }))
      .filter((g) => g.commands.length > 0);
  }, [catalogGroups, scopeKey, query]);

  if (!plugin) return null; // no catalog-capable plugin loaded → no palette

  const add = (command: string, label: string, icon?: string): void => {
    // FreeCAD-catalog convention: the plugin's `run` action takes { command }.
    addItem(viewPath, { label, icon, action: { id: `${plugin.id}/run`, config: { command } } });
  };

  return (
    <section className={styles.palette} aria-label={`${plugin.name} commands`}>
      <header className={styles.header}>
        <span className={styles.title}>{plugin.name} commands</span>
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
