// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { PluginCategory, PluginUsageReport } from '@/shared/ipc';
import { PLUGIN_KINDS } from '@/shared/plugin-types';

import { confirm } from '../state/confirm';
import { usePluginsState } from '../state/plugins';
import { notify } from '../state/toasts';

import styles from './PluginManager.module.scss';

/** User-facing section heading for each plugin kind (#220). The on-disk
 *  string ('function' / 'theme' / etc.) is the canonical key; this map is
 *  only for the manager UI. Keep it short — the surrounding context already
 *  says "Plugin manager", so a heading like "Function plugins" reads
 *  redundantly. */
const KIND_HEADING: Record<PluginCategory, string> = {
  function: 'Function',
  theme: 'Theme',
  'nav-style': 'Navigation-style',
  shape: 'Shape',
};

/**
 * Plugin manager (#167): import a downloaded plugin *folder* (it's copied into
 * SpaceUX's managed `extensions/<kind>/` tree), list what's installed, and
 * remove plugins. Users don't point the loader at arbitrary paths; import is
 * the one way in, so the on-disk layout stays canonical.
 *
 * Rendered inline on the Settings page. The list reads from the shared
 * {@link usePluginsState} store so the navigation-style picker (#195) sees
 * the same plugins without polling its own copy: on every successful import
 * or uninstall this component pushes the fresh snapshot main returned into
 * the store, and every subscriber re-renders.
 */
export function PluginManager() {
  const plugins = usePluginsState((s) => s.plugins);
  const errors = usePluginsState((s) => s.errors);
  const ensureLoaded = usePluginsState((s) => s.ensureLoaded);
  const applyPluginsSnapshot = usePluginsState((s) => s.applySnapshot);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const doImport = (): void => {
    setBusy(true);
    window.editor
      .importPlugin()
      .then((r) => {
        if (r.ok === true) {
          applyPluginsSnapshot(r.state);
          notify('success', `Imported ${r.installed.name} (${r.installed.kind}).`);
        } else if (r.ok === false) notify('error', r.reason);
        // r.ok === 'cancelled' → the picker was dismissed; nothing to do.
      })
      .finally(() => setBusy(false));
  };

  const remove = async (kind: PluginCategory, id: string, name: string): Promise<void> => {
    // Scan for references BEFORE opening the confirm so the user sees which
    // menus + the global appearance reference this plugin (#265). nav-style
    // and theme always come back empty today; rendering still shows the
    // base message in that case. The scan is informational only: if it
    // fails (IPC error, transient profile read), fall back to the plain
    // single-line message instead of blocking Remove on a side feature.
    let usages: PluginUsageReport | null = null;
    try {
      usages = await window.editor.scanPluginUsages(id, kind);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[plugin manager] usage scan failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const lines = [`Remove "${name}"? This deletes its installed files.`];
    if (usages !== null && (usages.menus.length > 0 || usages.globalAppearance)) {
      lines.push('', 'Currently used by:');
      if (usages.menus.length > 0) {
        // Cap the list so a config with many profiles doesn't push the
        // confirm buttons offscreen; the count still reflects the total.
        const MAX_MENU_LINES = 6;
        const head = usages.menus.slice(0, MAX_MENU_LINES);
        for (const m of head) lines.push(`• ${m}`);
        if (usages.menus.length > head.length) {
          lines.push(`• …and ${usages.menus.length - head.length} more`);
        }
      }
      if (usages.globalAppearance) {
        lines.push('• Global appearance (will fall back to the host default)');
      }
    }
    const ok = await confirm({
      title: 'Remove plugin?',
      message: lines.join('\n'),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Plugin teardown hook (#267): ask main if the plugin declared a
      // cleanup step (e.g. FreeCAD wants to offer removing its bridge addon
      // from FreeCAD's Mod dir). The hook fires while the plugin is still
      // loaded so closures and module state are alive; the actual perform
      // runs only after the user confirms a second dialog. Skip silently
      // when the hook is unavailable or the query failed — plugin uninstall
      // is the primary action and shouldn't be gated on a side feature.
      let hookMessage: string | null = null;
      try {
        const hook = await window.editor.getPluginUninstallHook(id);
        if (hook.available) hookMessage = hook.message;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[plugin manager] uninstall hook query failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (hookMessage !== null) {
        const hookOk = await confirm({
          title: 'Plugin cleanup',
          message: hookMessage,
          confirmLabel: 'Run cleanup',
          destructive: true,
        });
        if (hookOk) {
          const hookResult = await window.editor.performPluginUninstallHook(id);
          notify(
            hookResult.ok ? 'success' : 'error',
            hookResult.ok ? 'Cleanup done.' : hookResult.reason,
          );
        }
      }
      const r = await window.editor.uninstallPlugin(kind, id);
      applyPluginsSnapshot(r.state);
      notify(r.ok ? 'success' : 'error', r.ok ? `Removed ${name}.` : r.reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={doImport} disabled={busy}>
          Import plugin…
        </button>
      </div>
      {plugins.length === 0 ? (
        <p className={styles.empty}>No plugins installed yet.</p>
      ) : (
        // Section per plugin kind (#220). PLUGIN_KINDS gives the canonical
        // order so themes don't suddenly precede functions if the install
        // sequence happened to vary; empty kinds collapse out so the manager
        // only shows what the user actually has.
        PLUGIN_KINDS.map((kind) => {
          const kindPlugins = plugins.filter((p) => p.kind === kind);
          if (kindPlugins.length === 0) return null;
          return (
            <section key={kind} className={styles.kindSection}>
              <h3 className={styles.subhead}>{KIND_HEADING[kind]}</h3>
              <ul className={styles.list}>
                {kindPlugins.map((p) => (
                  <li key={`${p.kind}/${p.id}`} className={styles.item}>
                    <div className={styles.itemHead}>
                      <span className={styles.itemName}>{p.name}</span>
                      <span className={styles.kindBadge}>{p.kind}</span>
                    </div>
                    <div className={styles.itemMeta}>
                      <span>
                        {p.id} · v{p.version}
                      </span>
                      {p.kind === 'function' && (
                        <span>
                          {p.actionCount} action{p.actionCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {p.kind === 'nav-style' && p.navStylePresets && (
                        <span>
                          {p.navStylePresets.length} preset
                          {p.navStylePresets.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {p.kind === 'shape' && p.shape && <span>{p.shape.label}</span>}
                    </div>
                    {p.removable ? (
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => void remove(p.kind, p.id, p.name)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.removeButton}
                        disabled
                        title="Bundled with the app (loaded from the project or a system folder) — not removable here."
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {errors.length > 0 && (
        <div className={styles.errorsSection}>
          <h3 className={styles.subhead}>Could not load</h3>
          <ul className={styles.list}>
            {errors.map((e) => (
              <li key={e.dir} className={styles.errorItem}>
                <span className={styles.itemMeta}>{e.dir}</span>
                <span className={styles.error}>{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
