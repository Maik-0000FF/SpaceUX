// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';

import { isRenderableIcon } from '@/core/icon';
import type { PluginInfo } from '@/shared/ipc';
import type { PluginCatalog } from '@/shared/plugin-types';

import { useReadOnlySource } from '../hooks/useReadOnlySource';
import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';

import styles from './CommandPalette.module.scss';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; reason: string }
  | { kind: 'ready'; catalog: PluginCatalog };

/**
 * Command palette for the curated FreeCAD mode (#76 D2b): lists the active
 * catalog plugin's commands (from the bridge, grouped by workbench, searchable)
 * and adds one to the current ring on click — as a normal menu item carrying
 * the plugin's run-action + baked icon. So the user builds a personalised pie
 * that renders without the bridge and only needs it to *execute*.
 *
 * Shown only when a loaded plugin exposes a catalog (FreeCAD). The raw catalog
 * is sanitised here (icons via isRenderableIcon, command/label required) — it
 * isn't validated at the IPC boundary, unlike the menu provider.
 */
export function CommandPalette() {
  const addItem = useMenuSettings((s) => s.addItem);
  const hasConfig = useMenuSettings((s) => s.config !== null);
  const viewPath = useAppState((s) => s.viewPath);
  // A plugin-provided menu is the active source → the config is a read-only
  // overlay (main returns no writable target, index.ts:1051). Adds would mutate
  // the draft and then fail the write-back with a cryptic banner, so disable
  // them and say why instead. Shared hook = same source of truth as the rest
  // of the editor's read-only affordance (App banner, MenuList, sliders).
  const readOnly = useReadOnlySource();

  const [plugin, setPlugin] = useState<PluginInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [query, setQuery] = useState('');

  // Find the first loaded plugin that offers a catalog (FreeCAD today).
  useEffect(() => {
    let cancelled = false;
    void window.editor.getPlugins().then((state) => {
      if (!cancelled) setPlugin(state.plugins.find((p) => p.hasCatalog) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchCatalog = useCallback(
    (loadAll: boolean) => {
      if (!plugin) return;
      setStatus({ kind: 'loading' });
      void window.editor.getPluginCatalog(plugin.id, loadAll).then((res) => {
        setStatus(
          res.ok ? { kind: 'ready', catalog: res.catalog } : { kind: 'error', reason: res.reason },
        );
      });
    },
    [plugin],
  );

  // Pull the already-loaded commands as soon as a catalog plugin is known.
  useEffect(() => {
    if (plugin) fetchCatalog(false);
  }, [plugin, fetchCatalog]);

  // Sanitise + filter the raw catalog: drop commands missing a command/label,
  // keep only renderable icons, and match the search query on the label.
  const groups = useMemo(() => {
    if (status.kind !== 'ready') return [];
    const q = query.trim().toLowerCase();
    return status.catalog.groups
      .map((g) => ({
        name: g.name,
        commands: g.commands
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
  }, [status, query]);

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
          onClick={() => fetchCatalog(true)}
          disabled={status.kind === 'loading'}
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
      {status.kind === 'loading' && <p className={styles.note}>Loading commands…</p>}
      {status.kind === 'error' && (
        <p className={styles.note}>
          No commands: {status.reason}. Is FreeCAD running with the bridge addon?
        </p>
      )}
      {status.kind === 'ready' && groups.length === 0 && (
        <p className={styles.note}>No matching commands.</p>
      )}
      <div className={styles.groups}>
        {groups.map((g, i) => (
          // Two workbenches can share a display name; the index keeps the key
          // unique (the catalog drops the workbench's stable key in D2a).
          <div key={`${i}-${g.name}`} className={styles.group}>
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
